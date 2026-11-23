import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { printTemplateOrder, printTemplates, templateCategories } from '../../server/db/schema'
import { MAX_DOCUMENT_BYTES } from '../../server/lib/fileSignature'
import {
  deleteTemplate, listTemplates, orderTemplates, readTemplateFile, replaceTemplateFile, templateReaderFacility, updateTemplate,
  uploadTemplate, type TemplateActor,
} from '../../server/services/printTemplates'
import { createCategory, deleteCategory } from '../../server/services/templateCategories'
import type { TemplateVisibility } from '../../shared/domain/templateCategories'
import type { Role, SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addUser, createTestDb, errorCode, permissionsOf } from '../helpers/fixtures'

const NOW = new Date('2026-10-21T08:30:00.000Z')
const LATER = new Date('2026-10-22T09:00:00.000Z')

const pdf = (extra = 'content') => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(extra)])
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.from('png')])

const actor = (user: SessionUser): TemplateActor => ({
  id: user.id, role: user.role, permissions: user.permissions, facilityId: user.facilityId!,
})
/** A viewer of the role with the role's default permissions. */
const seer = (role: Role, facilityId: number) => ({ role, permissions: permissionsOf(role), facilityId })

describe('print templates', () => {
  let db: Db
  let other: number
  let leitung: TemplateActor
  let otherLeitung: TemplateActor
  let provider: TemplateActor
  /** Category ids by name, of facility 1 and of the other facility. */
  let cat: Record<string, number>
  let otherCat: Record<string, number>

  /** A category of that name in facility 1, and (unless `onlyFirst`) one in the other facility as well. */
  const category = (name: string, visibility: TemplateVisibility = 'all', onlyFirst = false) => {
    const by = (facilityId: number) => ({ role: 'provider' as const, permissions: permissionsOf('provider'), facilityId })
    cat[name] = createCategory(db, by(1), { name, visibility })
    if (!onlyFirst) otherCat[name] = createCategory(db, by(other), { name, visibility })
    return cat[name]
  }

  beforeEach(() => {
    db = createTestDb()
    other = addFacility(db, 'Krippe')
    leitung = actor(addUser(db, 'leitung', 'admin'))
    otherLeitung = actor(addUser(db, 'leitung2', 'admin', null, other))
    provider = actor(addUser(db, 'traeger', 'provider'))
    // Without the default categories, so the tests name their own.
    db.delete(templateCategories).run()
    cat = {}
    otherCat = {}
    category('Eltern')
    category('Gesundheit')
    category('Personal')
  })

  /** A facility's template in the uploader's facility category, or one for all facilities under the category name. */
  const upload = (
    by: TemplateActor,
    fields: Partial<{ title: string; category: string; scope: 'facility' | 'all'; visibility: TemplateVisibility }> = {},
    data: Buffer = pdf(), filename = 'Elternbrief.pdf',
  ) => {
    const name = fields.category ?? 'Eltern'
    const scope = fields.scope ?? 'facility'
    const filing = scope === 'all'
      ? { categoryName: name, visibility: fields.visibility }
      : { categoryId: (by.facilityId === other ? otherCat : cat)[name]! }
    return uploadTemplate(db, by, { title: fields.title ?? 'Elternbrief', scope, ...filing }, { data, filename }, NOW)
  }
  const titles = (facilityId: number, role: Role = 'admin') =>
    listTemplates(db, seer(role, facilityId)).map(template => template.title)

  describe('upload', () => {
    it('stores a PDF for the own facility with its title, category, size and upload time', () => {
      const id = upload(leitung, { title: '  Elternbrief  ' })
      expect(listTemplates(db, seer('admin', 1))).toEqual([{
        id, title: 'Elternbrief', categoryId: cat.Eltern, category: 'Eltern', subcategoryId: null, subcategory: '', global: false, globalCategoryName: null,
        globalSubcategoryName: null, globalVisibility: null, size: pdf().length, uploadedAt: NOW.toISOString(), updatedAt: NOW.toISOString(), canEdit: true,
        fillable: false,
      }])
      const row = db.select().from(printTemplates).get()!
      expect(row).toMatchObject({ facilityId: 1, mimeType: 'application/pdf', uploadedBy: leitung.id, categoryId: cat.Eltern, category: '' })
      expect(row.data.equals(pdf())).toBe(true)
    })

    it('takes the file name for an empty title', () => {
      upload(leitung, { title: ' ' }, pdf(), 'Anmeldung Ausflug.pdf')
      expect(listTemplates(db, seer('admin', 1))[0]).toMatchObject({ title: 'Anmeldung Ausflug', category: 'Eltern' })
    })

    it('needs a category the uploader sees', () => {
      category('Geheim', 'provider')
      expect(errorCode(() => uploadTemplate(db, leitung, { title: 'X', categoryId: 999, scope: 'facility' },
        { data: pdf(), filename: 'x.pdf' }))).toBe('template_category_invalid')
      expect(errorCode(() => upload(leitung, { category: 'Geheim' }))).toBe('template_category_invalid')
      upload(provider, { category: 'Geheim' })
      expect(titles(1, 'provider')).toEqual(['Elternbrief'])
    })

    it('accepts PDF files only, judged by the first bytes', () => {
      expect(errorCode(() => upload(leitung, {}, png(), 'brief.pdf'))).toBe('print_template_type_invalid')
      expect(errorCode(() => upload(leitung, {}, Buffer.from('Hallo'), 'brief.pdf'))).toBe('print_template_type_invalid')
      expect(db.select().from(printTemplates).all()).toEqual([])
    })

    it('refuses files larger than the document limit', () => {
      const big = Buffer.concat([pdf(), Buffer.alloc(MAX_DOCUMENT_BYTES)])
      expect(errorCode(() => upload(leitung, {}, big))).toBe('document_too_large')
      expect(upload(leitung, {}, Buffer.concat([pdf(''), Buffer.alloc(MAX_DOCUMENT_BYTES - pdf('').length)]))).toBeGreaterThan(0)
    })

    it('lets the Leitung upload for its own facility only', () => {
      expect(errorCode(() => upload(leitung, { scope: 'all' }))).toBe('forbidden')
      upload(otherLeitung, { title: 'Krippenbrief' })
      expect(db.select({ facilityId: printTemplates.facilityId }).from(printTemplates).all()).toEqual([{ facilityId: other }])
    })

    it('lets the Träger upload for all facilities or for the facility they work in', () => {
      upload(provider, { title: 'Für alle', scope: 'all' })
      upload(provider, { title: 'Nur hier', scope: 'facility' })
      expect(db.select({ title: printTemplates.title, facilityId: printTemplates.facilityId }).from(printTemplates).all())
        .toEqual([{ title: 'Für alle', facilityId: null }, { title: 'Nur hier', facilityId: 1 }])
    })

    it('refuses Mitarbeiter accounts', () => {
      const staff = addUser(db, 'anna', 'observer', addEmployee(db, 'Anna'))
      expect(errorCode(() => upload(actor(staff)))).toBe('forbidden')
    })
  })

  describe('list', () => {
    it('shows the own and the global templates, never those of another facility, by category order and upload order', () => {
      upload(leitung, { title: 'Zahnarzt', category: 'Gesundheit' })
      upload(leitung, { title: 'Ausflug', category: 'Eltern' })
      upload(otherLeitung, { title: 'Krippenbrief', category: 'Eltern' })
      upload(provider, { title: 'Urlaubsantrag', category: 'Personal', scope: 'all' })
      upload(leitung, { title: 'Allergien', category: 'Gesundheit' })
      expect(listTemplates(db, seer('admin', 1)).map(template => [template.category, template.title, template.global]))
        .toEqual([
          ['Eltern', 'Ausflug', false], ['Gesundheit', 'Zahnarzt', false], ['Gesundheit', 'Allergien', false],
          ['Personal', 'Urlaubsantrag', true],
        ])
      expect(titles(other)).toEqual(['Krippenbrief', 'Urlaubsantrag'])
    })

    it('marks as editable what the viewer may change: the Leitung not the global ones, the tablet and Mitarbeiter nothing', () => {
      upload(leitung, { title: 'Eigene' })
      upload(provider, { title: 'Global', scope: 'all' })
      const editable = (role: Role) =>
        listTemplates(db, seer(role, 1)).map(template => [template.title, template.canEdit])
      expect(editable('admin')).toEqual([['Eigene', true], ['Global', false]])
      expect(editable('provider')).toEqual([['Eigene', true], ['Global', true]])
      expect(editable('terminal')).toEqual([['Eigene', false], ['Global', false]])
      expect(editable('observer')).toEqual([['Eigene', false], ['Global', false]])
    })

    it('shows each viewer only the templates in categories of their level', () => {
      category('Leitung', 'managers')
      category('Träger', 'provider')
      upload(provider, { title: 'Für alle', category: 'Eltern' })
      upload(provider, { title: 'Für Leitungen', category: 'Leitung', scope: 'all' })
      upload(provider, { title: 'Für den Träger', category: 'Träger' })
      expect(titles(1, 'provider')).toEqual(['Für alle', 'Für Leitungen', 'Für den Träger'])
      expect(titles(1, 'admin')).toEqual(['Für alle', 'Für Leitungen'])
      expect(titles(1, 'observer')).toEqual(['Für alle'])
      expect(titles(1, 'terminal')).toEqual(['Für alle'])
    })
  })

  describe('order (▲/▼ within a sub-tab)', () => {
    /** The titles of one sub-tab of the facility as the role sees it (null = „Vom Träger“). */
    const tab = (facilityId: number, categoryId: number | null, role: Role = 'admin') => listTemplates(db, seer(role, facilityId))
      .filter(template => template.categoryId === categoryId).map(template => template.title)
    const idOf = (title: string, facilityId = 1) =>
      listTemplates(db, seer('provider', facilityId)).find(template => template.title === title)!.id
    const order = (by: TemplateActor, categoryId: number | null, titles: string[]) =>
      orderTemplates(db, by, categoryId, titles.map(title => idOf(title, by.facilityId)))

    it('keeps templates of before (no order yet) alphabetical, after those with an order', () => {
      upload(leitung, { title: 'Zahnarzt' })
      upload(leitung, { title: 'Ausflug' })
      upload(leitung, { title: 'Mittag' })
      db.delete(printTemplateOrder).run()
      expect(tab(1, cat.Eltern!)).toEqual(['Ausflug', 'Mittag', 'Zahnarzt'])
      db.insert(printTemplateOrder).values({ facilityId: 1, templateId: idOf('Zahnarzt'), sortOrder: 0 }).run()
      expect(tab(1, cat.Eltern!)).toEqual(['Zahnarzt', 'Ausflug', 'Mittag'])
    })

    it('puts a new upload at the end of its category, also behind templates of before', () => {
      upload(leitung, { title: 'Zahnarzt' })
      upload(leitung, { title: 'Ausflug' })
      db.delete(printTemplateOrder).run()
      upload(leitung, { title: 'Abholung' })
      expect(tab(1, cat.Eltern!)).toEqual(['Ausflug', 'Zahnarzt', 'Abholung'])
      upload(provider, { title: 'Aaa für alle', scope: 'all' })
      expect(tab(1, cat.Eltern!)).toEqual(['Ausflug', 'Zahnarzt', 'Abholung', 'Aaa für alle'])
      upload(otherLeitung, { title: 'Zzz Krippe' })
      upload(provider, { title: 'Bbb für alle', scope: 'all' })
      expect(tab(other, otherCat.Eltern!)).toEqual(['Aaa für alle', 'Zzz Krippe', 'Bbb für alle'])
    })

    it('stores the order per facility: a template for all facilities in a different place in each', () => {
      upload(leitung, { title: 'Eigener Brief' })
      upload(otherLeitung, { title: 'Krippenbrief' })
      upload(provider, { title: 'Für alle', scope: 'all' })
      order(leitung, cat.Eltern!, ['Für alle', 'Eigener Brief'])
      expect(tab(1, cat.Eltern!)).toEqual(['Für alle', 'Eigener Brief'])
      expect(tab(other, otherCat.Eltern!)).toEqual(['Krippenbrief', 'Für alle'])
      // Mitarbeiter and the tablet see the same order.
      expect(tab(1, cat.Eltern!, 'observer')).toEqual(['Für alle', 'Eigener Brief'])
      expect(tab(1, cat.Eltern!, 'terminal')).toEqual(['Für alle', 'Eigener Brief'])
      order(otherLeitung, otherCat.Eltern!, ['Krippenbrief', 'Für alle'])
      expect(tab(other, otherCat.Eltern!)).toEqual(['Krippenbrief', 'Für alle'])
      expect(tab(1, cat.Eltern!)).toEqual(['Für alle', 'Eigener Brief'])
    })

    it('orders „Vom Träger“ as well (by category name and title until ordered)', () => {
      upload(provider, { title: 'Speiseplan', category: 'Küche', scope: 'all' })
      upload(provider, { title: 'Anfahrt', category: 'Wege', scope: 'all' })
      db.delete(printTemplateOrder).run()
      expect(tab(1, null)).toEqual(['Speiseplan', 'Anfahrt'])
      order(leitung, null, ['Anfahrt', 'Speiseplan'])
      expect(tab(1, null)).toEqual(['Anfahrt', 'Speiseplan'])
      expect(tab(other, null)).toEqual(['Speiseplan', 'Anfahrt'])
    })

    it('refuses an order that is not exactly the visible templates of the sub-tab, each once (400 invalid_order)', () => {
      const a = upload(leitung, { title: 'A' })
      const b = upload(leitung, { title: 'B' })
      const elsewhere = upload(leitung, { title: 'Gesund', category: 'Gesundheit' })
      const foreign = upload(otherLeitung, { title: 'Krippe' })
      for (const ids of [[a], [a, b, b], [a, b, foreign], [a, b, elsewhere], [b, foreign], [a, b, 9999], []]) {
        expect(errorCode(() => orderTemplates(db, leitung, cat.Eltern!, ids)), JSON.stringify(ids)).toBe('invalid_order')
      }
      expect(errorCode(() => orderTemplates(db, leitung, otherCat.Eltern!, [foreign]))).toBe('template_category_not_found')
      expect(errorCode(() => orderTemplates(db, otherLeitung, cat.Eltern!, [a, b]))).toBe('template_category_not_found')
      expect(tab(1, cat.Eltern!)).toEqual(['A', 'B'])
      orderTemplates(db, leitung, cat.Eltern!, [b, a])
      expect(tab(1, cat.Eltern!)).toEqual(['B', 'A'])
    })

    it('leaves a template the editor does not see where it is, and refuses to order it', () => {
      upload(provider, { title: 'A' })
      upload(provider, { title: 'Nur Träger', scope: 'all', visibility: 'provider' })
      upload(provider, { title: 'C' })
      expect(tab(1, cat.Eltern!, 'provider')).toEqual(['A', 'Nur Träger', 'C'])
      expect(tab(1, cat.Eltern!)).toEqual(['A', 'C'])
      expect(errorCode(() => order(leitung, cat.Eltern!, ['C', 'Nur Träger', 'A']))).toBe('invalid_order')
      order(leitung, cat.Eltern!, ['C', 'A'])
      expect(tab(1, cat.Eltern!)).toEqual(['C', 'A'])
      expect(tab(1, cat.Eltern!, 'provider')).toEqual(['C', 'Nur Träger', 'A'])
      // A category the editor does not see at all: 404.
      category('Geheim', 'provider')
      upload(provider, { title: 'Geheim', category: 'Geheim' })
      expect(errorCode(() => orderTemplates(db, leitung, cat.Geheim!, [idOf('Geheim')]))).toBe('template_category_not_found')
    })

    it('lets the Leitung order the Träger\'s templates in its facility; Mitarbeiter may not order', () => {
      upload(leitung, { title: 'Eigener Brief' })
      upload(provider, { title: 'Für alle', scope: 'all' })
      order(leitung, cat.Eltern!, ['Für alle', 'Eigener Brief'])
      expect(tab(1, cat.Eltern!)).toEqual(['Für alle', 'Eigener Brief'])
      const staff = actor(addUser(db, 'anna', 'observer', addEmployee(db, 'Anna')))
      expect(errorCode(() => order(staff, cat.Eltern!, ['Eigener Brief', 'Für alle']))).toBe('forbidden')
    })

    it('puts a template moved to another category at the end there; a new title alone keeps the place', () => {
      upload(leitung, { title: 'Zahnarzt', category: 'Gesundheit' })
      upload(leitung, { title: 'Allergien', category: 'Gesundheit' })
      db.delete(printTemplateOrder).run()
      const moved = upload(leitung, { title: 'Aaa Brief' })
      upload(leitung, { title: 'Bbb Brief' })
      updateTemplate(db, leitung, moved, { title: 'Aaa Brief', categoryId: cat.Gesundheit! }, LATER)
      expect(tab(1, cat.Gesundheit!)).toEqual(['Allergien', 'Zahnarzt', 'Aaa Brief'])
      expect(tab(1, cat.Eltern!)).toEqual(['Bbb Brief'])
      order(leitung, cat.Gesundheit!, ['Aaa Brief', 'Allergien', 'Zahnarzt'])
      updateTemplate(db, leitung, moved, { title: 'Aaa Brief neu', categoryId: cat.Gesundheit! }, LATER)
      expect(tab(1, cat.Gesundheit!)).toEqual(['Aaa Brief neu', 'Allergien', 'Zahnarzt'])
    })

    it('puts a template for all facilities filed under another name at the end there, in every facility', () => {
      upload(leitung, { title: 'Zahnarzt', category: 'Gesundheit' })
      upload(otherLeitung, { title: 'Krippe gesund', category: 'Gesundheit' })
      const id = upload(provider, { title: 'Aaa für alle', category: 'Eltern', scope: 'all' })
      updateTemplate(db, provider, id, { title: 'Aaa für alle', categoryName: 'gesundheit' }, LATER)
      expect(tab(1, cat.Gesundheit!)).toEqual(['Zahnarzt', 'Aaa für alle'])
      expect(tab(other, otherCat.Gesundheit!)).toEqual(['Krippe gesund', 'Aaa für alle'])
      // Only another visibility or spelling of the name: the place stays.
      order(leitung, cat.Gesundheit!, ['Aaa für alle', 'Zahnarzt'])
      updateTemplate(db, provider, id, { title: 'Aaa für alle', categoryName: 'Gesundheit', visibility: 'managers' }, LATER)
      expect(tab(1, cat.Gesundheit!)).toEqual(['Aaa für alle', 'Zahnarzt'])
    })

    it('forgets the order with the template', () => {
      const id = upload(provider, { title: 'Für alle', scope: 'all' })
      expect(db.select().from(printTemplateOrder).all()).toHaveLength(2)
      deleteTemplate(db, provider, id)
      expect(db.select().from(printTemplateOrder).all()).toEqual([])
    })
  })

  describe('who may read', () => {
    it('lets Leitung, Träger, the tablet and Mitarbeiter in with their facility', () => {
      expect(templateReaderFacility(addUser(db, 'l3', 'admin', null, other))).toBe(other)
      expect(templateReaderFacility(addUser(db, 't1', 'provider'))).toBe(1)
      expect(templateReaderFacility(addUser(db, 'tablet', 'terminal'))).toBe(1)
      expect(templateReaderFacility(addUser(db, 'anna', 'observer', addEmployee(db, 'Anna')))).toBe(1)
    })

    it('refuses an account without a facility', () => {
      const tablet = { ...addUser(db, 'tablet2', 'terminal'), facilityId: null }
      expect(errorCode(() => templateReaderFacility(tablet))).toBe('no_facility')
    })
  })

  describe('file', () => {
    const viewer = (facilityId: number, role: Role = 'admin') => seer(role, facilityId)

    it('serves the own and the global templates as PDF named after the title', () => {
      const own = upload(leitung, { title: 'Einverständnis Ausflug' })
      const global = upload(provider, { title: 'Urlaubsantrag Ü', scope: 'all' })
      expect(readTemplateFile(db, viewer(1), own)).toEqual({ data: pdf(), mimeType: 'application/pdf', fileName: 'Einverstaendnis-Ausflug.pdf' })
      expect(readTemplateFile(db, viewer(other), global).fileName).toBe('Urlaubsantrag-Ue.pdf')
      expect(readTemplateFile(db, viewer(1, 'observer'), own).data.equals(pdf())).toBe(true)
    })

    it('hides the templates of another facility', () => {
      const id = upload(otherLeitung)
      expect(errorCode(() => readTemplateFile(db, viewer(1), id))).toBe('print_template_not_found')
      expect(errorCode(() => readTemplateFile(db, viewer(1), 999))).toBe('print_template_not_found')
    })

    it('hides the templates of a category above the viewer\'s level (404)', () => {
      category('Leitung', 'managers')
      category('Träger', 'provider')
      const managers = upload(provider, { title: 'L', category: 'Leitung' })
      const traeger = upload(provider, { title: 'T', category: 'Träger' })
      for (const role of ['observer', 'terminal'] as const) {
        expect(errorCode(() => readTemplateFile(db, viewer(1, role), managers)), role).toBe('print_template_not_found')
        expect(errorCode(() => readTemplateFile(db, viewer(1, role), traeger)), role).toBe('print_template_not_found')
      }
      expect(readTemplateFile(db, viewer(1), managers).fileName).toBe('L.pdf')
      expect(errorCode(() => readTemplateFile(db, viewer(1), traeger))).toBe('print_template_not_found')
      expect(readTemplateFile(db, viewer(1, 'provider'), traeger).fileName).toBe('T.pdf')
    })
  })

  describe('change', () => {
    it('renames and moves to another category', () => {
      const id = upload(leitung)
      updateTemplate(db, leitung, id, { title: ' Elternbrief Herbst ', categoryId: cat.Personal! }, LATER)
      expect(listTemplates(db, seer('admin', 1))[0]).toMatchObject({
        id, title: 'Elternbrief Herbst', category: 'Personal', categoryId: cat.Personal, uploadedAt: NOW.toISOString(),
        updatedAt: LATER.toISOString(),
      })
      expect(errorCode(() => updateTemplate(db, leitung, id, { title: '  ', categoryId: cat.Eltern! }))).toBe('print_template_title_required')
      expect(errorCode(() => updateTemplate(db, leitung, id, { title: 'X', categoryId: 999 }))).toBe('template_category_invalid')
    })

    it('keeps the Leitung from moving a template into, or touching one in, a category of the Träger', () => {
      category('Träger', 'provider')
      const own = upload(leitung)
      expect(errorCode(() => updateTemplate(db, leitung, own, { title: 'X', categoryId: cat.Träger! }))).toBe('template_category_invalid')
      const hidden = upload(provider, { category: 'Träger' })
      expect(errorCode(() => updateTemplate(db, leitung, hidden, { title: 'X', categoryId: cat.Eltern! }))).toBe('print_template_not_found')
      expect(errorCode(() => replaceTemplateFile(db, leitung, hidden, { data: pdf(), filename: 'x.pdf' }))).toBe('print_template_not_found')
      expect(errorCode(() => deleteTemplate(db, leitung, hidden))).toBe('print_template_not_found')
    })

    it('replaces the file and keeps the id', () => {
      const id = upload(leitung)
      replaceTemplateFile(db, leitung, id, { data: pdf('version 2'), filename: 'neu.pdf' }, LATER)
      expect(listTemplates(db, seer('admin', 1)).map(template => [template.id, template.size, template.updatedAt]))
        .toEqual([[id, pdf('version 2').length, LATER.toISOString()]])
      expect(readTemplateFile(db, seer('admin', 1), id).data.equals(pdf('version 2'))).toBe(true)
      expect(errorCode(() => replaceTemplateFile(db, leitung, id, { data: png(), filename: 'x.pdf' }))).toBe('print_template_type_invalid')
      expect(errorCode(() => replaceTemplateFile(db, leitung, id, {
        data: Buffer.concat([pdf(), Buffer.alloc(MAX_DOCUMENT_BYTES)]), filename: 'x.pdf',
      }))).toBe('document_too_large')
    })

    it('deletes the template', () => {
      const id = upload(leitung)
      const kept = upload(leitung, { title: 'Bleibt' })
      deleteTemplate(db, leitung, id)
      expect(titles(1)).toEqual(['Bleibt'])
      expect(errorCode(() => readTemplateFile(db, seer('admin', 1), id))).toBe('print_template_not_found')
      expect(readTemplateFile(db, seer('admin', 1), kept).data.length).toBeGreaterThan(0)
    })

    it('keeps the Träger\'s global templates away from the Leitung (403), but lets the Träger change them', () => {
      const id = upload(provider, { scope: 'all' })
      expect(errorCode(() => updateTemplate(db, leitung, id, { title: 'X', categoryId: cat.Eltern! }))).toBe('forbidden')
      expect(errorCode(() => replaceTemplateFile(db, leitung, id, { data: pdf('x'), filename: 'x.pdf' }))).toBe('forbidden')
      expect(errorCode(() => deleteTemplate(db, leitung, id))).toBe('forbidden')
      updateTemplate(db, provider, id, { title: 'Neu', categoryName: 'Personal' })
      expect(listTemplates(db, seer('admin', other))).toMatchObject([{ id, title: 'Neu', categoryId: otherCat.Personal, category: 'Personal' }])
      deleteTemplate(db, provider, id)
      expect(titles(1)).toEqual([])
    })

    it('treats the template of another facility as missing', () => {
      const id = upload(otherLeitung)
      expect(errorCode(() => updateTemplate(db, leitung, id, { title: 'X', categoryId: cat.Eltern! }))).toBe('print_template_not_found')
      expect(errorCode(() => replaceTemplateFile(db, leitung, id, { data: pdf(), filename: 'x.pdf' }))).toBe('print_template_not_found')
      expect(errorCode(() => deleteTemplate(db, leitung, id))).toBe('print_template_not_found')
      expect(titles(other)).toEqual(['Elternbrief'])
    })

    it('refuses Mitarbeiter accounts', () => {
      const id = upload(leitung)
      const staff = actor(addUser(db, 'anna', 'observer', addEmployee(db, 'Anna')))
      expect(errorCode(() => updateTemplate(db, staff, id, { title: 'X', categoryId: cat.Eltern! }))).toBe('forbidden')
      expect(errorCode(() => deleteTemplate(db, staff, id))).toBe('forbidden')
    })
  })

  describe('templates for all facilities', () => {
    const placed = (facilityId: number, role: Role = 'admin') => listTemplates(db, seer(role, facilityId))
      .map(template => [template.title, template.categoryId, template.category])

    it('stores the category by name and shows it in each facility\'s category of that name, regardless of case', () => {
      const id = upload(provider, { title: 'Urlaubsantrag', category: ' personal ', scope: 'all' })
      expect(db.select().from(printTemplates).get()).toMatchObject({ facilityId: null, categoryId: null, categoryName: 'personal', visibility: 'all' })
      expect(placed(1)).toEqual([['Urlaubsantrag', cat.Personal, 'Personal']])
      expect(placed(other)).toEqual([['Urlaubsantrag', otherCat.Personal, 'Personal']])
      expect(listTemplates(db, seer('provider', 1))[0]).toMatchObject({ id, global: true, globalCategoryName: 'personal', globalVisibility: 'all' })
    })

    it('shows it under „Vom Träger“ (no category, last) where the facility has no category of that name', () => {
      category('Küche', 'all', true)
      upload(provider, { title: 'Speiseplan', category: 'Küche', scope: 'all' })
      upload(otherLeitung, { title: 'Ausflug', category: 'Eltern' })
      expect(placed(1)).toEqual([['Speiseplan', cat.Küche, 'Küche']])
      expect(placed(other)).toEqual([['Ausflug', otherCat.Eltern, 'Eltern'], ['Speiseplan', null, 'Küche']])
    })

    it('needs a category name; the visibility is the Träger\'s choice and the stricter of it and the category\'s applies', () => {
      expect(errorCode(() => upload(provider, { category: '  ', scope: 'all' }))).toBe('template_category_name_required')
      category('Intern', 'managers')
      upload(provider, { title: 'Für Leitungen', category: 'Eltern', scope: 'all', visibility: 'managers' })
      upload(provider, { title: 'In interner Kategorie', category: 'Intern', scope: 'all', visibility: 'all' })
      upload(provider, { title: 'Nur Träger, Vom Träger', category: 'Nirgends', scope: 'all', visibility: 'provider' })
      upload(provider, { title: 'Alle, Vom Träger', category: 'Nirgends', scope: 'all' })
      expect(titles(1, 'observer')).toEqual(['Alle, Vom Träger'])
      expect(titles(1, 'terminal')).toEqual(['Alle, Vom Träger'])
      expect(titles(1, 'admin')).toEqual(['Für Leitungen', 'In interner Kategorie', 'Alle, Vom Träger'])
      // „Vom Träger“ in upload order (each new one at the end).
      expect(titles(1, 'provider')).toEqual(['Für Leitungen', 'In interner Kategorie', 'Nur Träger, Vom Träger', 'Alle, Vom Träger'])
      const hidden = listTemplates(db, seer('provider', 1)).find(template => template.title === 'Für Leitungen')!.id
      expect(errorCode(() => readTemplateFile(db, seer('observer', other), hidden))).toBe('print_template_not_found')
      expect(readTemplateFile(db, seer('admin', other), hidden).fileName).toBe('Fuer-Leitungen.pdf')
    })

    it('lets only the Träger file it elsewhere: another name or visibility (kept when not sent)', () => {
      const id = upload(provider, { title: 'Urlaubsantrag', category: 'Personal', scope: 'all', visibility: 'managers' })
      expect(errorCode(() => updateTemplate(db, leitung, id, { title: 'X', categoryName: 'Eltern' }))).toBe('forbidden')
      updateTemplate(db, provider, id, { title: 'Urlaubsantrag', categoryName: 'Eltern' }, LATER)
      expect(db.select().from(printTemplates).get()).toMatchObject({ categoryName: 'Eltern', visibility: 'managers', categoryId: null })
      updateTemplate(db, provider, id, { title: 'Urlaubsantrag', categoryName: 'Eltern', visibility: 'all' }, LATER)
      expect(placed(1, 'observer')).toEqual([['Urlaubsantrag', cat.Eltern, 'Eltern']])
      expect(errorCode(() => updateTemplate(db, provider, id, { title: 'X', categoryName: ' ' }))).toBe('template_category_name_required')
    })

    it('moves to „Vom Träger“ when the facility deletes its category of that name', () => {
      category('Küche', 'all', true)
      upload(provider, { title: 'Speiseplan', category: 'Küche', scope: 'all' })
      deleteCategory(db, { role: 'admin', permissions: permissionsOf('admin'), facilityId: 1 }, cat.Küche!)
      expect(placed(1)).toEqual([['Speiseplan', null, 'Küche']])
    })
  })

  describe('subcategories', () => {
    /** A subcategory of that name under the named category, in facility 1 and (unless `onlyFirst`) in the other facility. */
    const subcategory = (parent: string, name: string, visibility: TemplateVisibility = 'all', onlyFirst = false) => {
      const by = (facilityId: number) => ({ role: 'provider' as const, permissions: permissionsOf('provider'), facilityId })
      cat[`${parent}/${name}`] = createCategory(db, by(1), { name, visibility, parentId: cat[parent]! })
      if (!onlyFirst) otherCat[`${parent}/${name}`] = createCategory(db, by(other), { name, visibility, parentId: otherCat[parent]! })
      return cat[`${parent}/${name}`]!
    }
    /** Where each template shows for the role: „Kategorie/Unterkategorie“ (or the category alone, „-“ for „Vom Träger“). */
    const spots = (facilityId: number, role: Role = 'admin') => listTemplates(db, seer(role, facilityId))
      .map(template => [template.title, template.categoryId === null ? `-${template.subcategory ? `/${template.subcategory}` : ''}` : template.subcategory ? `${template.category}/${template.subcategory}` : template.category])
    /** The titles of one list (a subcategory, or the templates directly in a category) as the role sees it. */
    const list = (facilityId: number, groupId: number, role: Role = 'admin') => listTemplates(db, seer(role, facilityId))
      .filter(template => (template.subcategoryId ?? template.categoryId) === groupId).map(template => template.title)
    const idOf = (title: string) => listTemplates(db, seer('provider', 1)).find(template => template.title === title)!.id
    const into = (by: TemplateActor, title: string, categoryId: number) =>
      uploadTemplate(db, by, { title, categoryId, scope: 'facility' }, { data: pdf(), filename: 'x.pdf' }, NOW)
    const forAll = (title: string, categoryName: string, subcategoryName?: string, visibility?: TemplateVisibility) =>
      uploadTemplate(db, provider, { title, categoryName, subcategoryName, visibility, scope: 'all' }, { data: pdf(), filename: 'x.pdf' }, NOW)

    it('files a facility\'s template in a subcategory and lists the category\'s own templates first, then each subcategory in its order', () => {
      const ausfluege = subcategory('Eltern', 'Ausflüge')
      const briefe = subcategory('Eltern', 'Briefe')
      into(leitung, 'Brief', briefe)
      into(leitung, 'Wandertag', ausfluege)
      upload(leitung, { title: 'Direkt' })
      expect(spots(1)).toEqual([['Direkt', 'Eltern'], ['Wandertag', 'Eltern/Ausflüge'], ['Brief', 'Eltern/Briefe']])
      const listed = listTemplates(db, seer('admin', 1)).find(template => template.title === 'Brief')!
      expect(listed).toMatchObject({ categoryId: cat.Eltern, category: 'Eltern', subcategoryId: briefe, subcategory: 'Briefe' })
      expect(errorCode(() => into(otherLeitung, 'Fremd', briefe))).toBe('template_category_invalid')
    })

    it('shows a subcategory\'s templates only to those who see the subcategory and its category (Mitarbeiter, tablet)', () => {
      const leitungen = subcategory('Eltern', 'Leitungen', 'managers')
      category('Intern', 'managers')
      const offen = subcategory('Intern', 'Offen')
      into(provider, 'Für alle', cat.Eltern!)
      into(provider, 'Für Leitungen', leitungen)
      into(provider, 'Im internen', offen)
      expect(spots(1, 'admin').map(([title]) => title)).toEqual(['Für alle', 'Für Leitungen', 'Im internen'])
      expect(spots(1, 'observer').map(([title]) => title)).toEqual(['Für alle'])
      expect(spots(1, 'terminal').map(([title]) => title)).toEqual(['Für alle'])
      expect(errorCode(() => readTemplateFile(db, seer('observer', 1), idOf('Im internen')))).toBe('print_template_not_found')
      // A Leitung cannot file into a subcategory of the Träger's category.
      category('Träger', 'provider')
      const traegerSub = subcategory('Träger', 'Offen')
      expect(errorCode(() => into(leitung, 'X', traegerSub))).toBe('template_category_invalid')
    })

    it('shows a template for all facilities by its path: in the subcategory, else directly in the category, else „Vom Träger“', () => {
      subcategory('Eltern', 'Briefe', 'all', true)
      forAll('Pfad', 'eltern', 'BRIEFE')
      forAll('Ohne Unterkategorie', 'Eltern')
      forAll('Unbekannte Unterkategorie', 'Eltern', 'Ausflüge')
      forAll('Unbekannte Kategorie', 'Küche', 'Pläne')
      expect(spots(1)).toEqual([
        ['Ohne Unterkategorie', 'Eltern'], ['Unbekannte Unterkategorie', 'Eltern'], ['Pfad', 'Eltern/Briefe'], ['Unbekannte Kategorie', '-/Pläne'],
      ])
      // The other facility has no subcategory „Briefe“: the template shows directly in „Eltern“.
      expect(spots(other).find(([title]) => title === 'Pfad')).toEqual(['Pfad', 'Eltern'])
      expect(listTemplates(db, seer('provider', 1)).find(template => template.title === 'Pfad'))
        .toMatchObject({ globalCategoryName: 'eltern', globalSubcategoryName: 'BRIEFE' })
    })

    it('applies the strictest of the template\'s, the category\'s and the subcategory\'s visibility to a template for all facilities', () => {
      subcategory('Eltern', 'Leitungen', 'managers')
      forAll('Für alle', 'Eltern', 'Leitungen')
      expect(spots(1, 'observer')).toEqual([])
      expect(spots(1, 'admin')).toEqual([['Für alle', 'Eltern/Leitungen']])
      forAll('Nur Träger', 'Eltern', 'Leitungen', 'provider')
      expect(spots(1, 'admin').map(([title]) => title)).toEqual(['Für alle'])
    })

    it('orders within a subcategory and within the category\'s own list, each on its own', () => {
      const briefe = subcategory('Eltern', 'Briefe')
      into(leitung, 'A', briefe)
      into(leitung, 'B', briefe)
      upload(leitung, { title: 'Direkt 1' })
      upload(leitung, { title: 'Direkt 2' })
      forAll('Für alle', 'Eltern', 'Briefe')
      expect(list(1, briefe)).toEqual(['A', 'B', 'Für alle'])
      orderTemplates(db, leitung, briefe, [idOf('Für alle'), idOf('B'), idOf('A')])
      expect(list(1, briefe)).toEqual(['Für alle', 'B', 'A'])
      expect(list(1, cat.Eltern!)).toEqual(['Direkt 1', 'Direkt 2'])
      // The category's own list holds only the templates directly in it.
      expect(errorCode(() => orderTemplates(db, leitung, cat.Eltern!, [idOf('Direkt 2'), idOf('Direkt 1'), idOf('A')]))).toBe('invalid_order')
      expect(errorCode(() => orderTemplates(db, leitung, briefe, [idOf('A'), idOf('B')]))).toBe('invalid_order')
      orderTemplates(db, leitung, cat.Eltern!, [idOf('Direkt 2'), idOf('Direkt 1')])
      expect(spots(1).map(([title]) => title)).toEqual(['Direkt 2', 'Direkt 1', 'Für alle', 'B', 'A'])
      // Another facility's subcategory, or one the editor does not see: 404.
      expect(errorCode(() => orderTemplates(db, leitung, otherCat['Eltern/Briefe']!, []))).toBe('template_category_not_found')
      const geheim = subcategory('Eltern', 'Geheim', 'provider')
      expect(errorCode(() => orderTemplates(db, leitung, geheim, []))).toBe('template_category_not_found')
    })

    it('puts a template moved into another subcategory (or out of one) at the end there', () => {
      const briefe = subcategory('Eltern', 'Briefe')
      const ausfluege = subcategory('Eltern', 'Ausflüge')
      into(leitung, 'Zettel', ausfluege)
      const moved = into(leitung, 'Aaa', briefe)
      upload(leitung, { title: 'Direkt' })
      updateTemplate(db, leitung, moved, { title: 'Aaa', categoryId: ausfluege }, LATER)
      expect(list(1, ausfluege)).toEqual(['Zettel', 'Aaa'])
      updateTemplate(db, leitung, moved, { title: 'Aaa', categoryId: cat.Eltern! }, LATER)
      expect(list(1, cat.Eltern!)).toEqual(['Direkt', 'Aaa'])
      // A template for all facilities filed under another subcategory name goes to the end there, too.
      const global = forAll('Aaa für alle', 'Eltern')
      into(leitung, 'Brief', briefe)
      updateTemplate(db, provider, global, { title: 'Aaa für alle', categoryName: 'Eltern', subcategoryName: 'Briefe' }, LATER)
      expect(list(1, briefe)).toEqual(['Brief', 'Aaa für alle'])
      expect(list(1, cat.Eltern!)).toEqual(['Direkt', 'Aaa'])
    })

    it('moves a template for all facilities into the category when the facility deletes the subcategory of its path', () => {
      const briefe = subcategory('Eltern', 'Briefe', 'all', true)
      forAll('Für alle', 'Eltern', 'Briefe')
      expect(spots(1)).toEqual([['Für alle', 'Eltern/Briefe']])
      deleteCategory(db, { role: 'admin', permissions: permissionsOf('admin'), facilityId: 1 }, briefe)
      expect(spots(1)).toEqual([['Für alle', 'Eltern']])
    })
  })
})
