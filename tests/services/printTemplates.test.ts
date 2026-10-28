import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { printTemplates } from '../../server/db/schema'
import { MAX_DOCUMENT_BYTES } from '../../server/lib/fileSignature'
import {
  deleteTemplate, listTemplates, readTemplateFile, replaceTemplateFile, templateReaderFacility, updateTemplate, uploadTemplate,
  type TemplateActor,
} from '../../server/services/printTemplates'
import { createCategory } from '../../server/services/templateCategories'
import type { TemplateVisibility } from '../../shared/domain/templateCategories'
import type { Role, SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addUser, createTestDb, errorCode } from '../helpers/fixtures'

const NOW = new Date('2026-10-21T08:30:00.000Z')
const LATER = new Date('2026-10-22T09:00:00.000Z')

const pdf = (extra = 'content') => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(extra)])
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.from('png')])

const actor = (user: SessionUser): TemplateActor => ({ id: user.id, role: user.role, facilityId: user.facilityId! })

describe('print templates', () => {
  let db: Db
  let other: number
  let leitung: TemplateActor
  let otherLeitung: TemplateActor
  let provider: TemplateActor
  /** Category ids by name. */
  let cat: Record<string, number>

  const category = (name: string, visibility: TemplateVisibility = 'all') => {
    cat[name] = createCategory(db, { role: 'provider' }, { name, visibility })
    return cat[name]
  }

  beforeEach(() => {
    db = createTestDb()
    other = addFacility(db, 'Krippe')
    leitung = actor(addUser(db, 'leitung', 'admin'))
    otherLeitung = actor(addUser(db, 'leitung2', 'admin', null, other))
    provider = actor(addUser(db, 'traeger', 'provider'))
    cat = {}
    category('Eltern')
    category('Gesundheit')
    category('Personal')
  })

  const upload = (
    by: TemplateActor, fields: Partial<{ title: string; category: string; scope: 'facility' | 'all' }> = {},
    data: Buffer = pdf(), filename = 'Elternbrief.pdf',
  ) => uploadTemplate(db, by, {
    title: fields.title ?? 'Elternbrief', categoryId: cat[fields.category ?? 'Eltern']!, scope: fields.scope ?? 'facility',
  }, { data, filename }, NOW)
  const titles = (facilityId: number, role: Role = 'admin') =>
    listTemplates(db, { role, facilityId }).map(template => template.title)

  describe('upload', () => {
    it('stores a PDF for the own facility with its title, category, size and upload time', () => {
      const id = upload(leitung, { title: '  Elternbrief  ' })
      expect(listTemplates(db, { role: 'admin', facilityId: 1 })).toEqual([{
        id, title: 'Elternbrief', categoryId: cat.Eltern, category: 'Eltern', global: false, size: pdf().length,
        uploadedAt: NOW.toISOString(), updatedAt: NOW.toISOString(), canEdit: true,
      }])
      const row = db.select().from(printTemplates).get()!
      expect(row).toMatchObject({ facilityId: 1, mimeType: 'application/pdf', uploadedBy: leitung.id, categoryId: cat.Eltern, category: '' })
      expect(row.data.equals(pdf())).toBe(true)
    })

    it('takes the file name for an empty title', () => {
      upload(leitung, { title: ' ' }, pdf(), 'Anmeldung Ausflug.pdf')
      expect(listTemplates(db, { role: 'admin', facilityId: 1 })[0]).toMatchObject({ title: 'Anmeldung Ausflug', category: 'Eltern' })
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
    it('shows the own and the global templates, never those of another facility, by category order and title', () => {
      upload(leitung, { title: 'Zahnarzt', category: 'Gesundheit' })
      upload(leitung, { title: 'Ausflug', category: 'Eltern' })
      upload(otherLeitung, { title: 'Krippenbrief', category: 'Eltern' })
      upload(provider, { title: 'Urlaubsantrag', category: 'Personal', scope: 'all' })
      upload(leitung, { title: 'Allergien', category: 'Gesundheit' })
      expect(listTemplates(db, { role: 'admin', facilityId: 1 }).map(template => [template.category, template.title, template.global]))
        .toEqual([
          ['Eltern', 'Ausflug', false], ['Gesundheit', 'Allergien', false], ['Gesundheit', 'Zahnarzt', false],
          ['Personal', 'Urlaubsantrag', true],
        ])
      expect(titles(other)).toEqual(['Krippenbrief', 'Urlaubsantrag'])
    })

    it('marks as editable what the viewer may change: the Leitung not the global ones, the tablet and Mitarbeiter nothing', () => {
      upload(leitung, { title: 'Eigene' })
      upload(provider, { title: 'Global', scope: 'all' })
      const editable = (role: Role) =>
        listTemplates(db, { role, facilityId: 1 }).map(template => [template.title, template.canEdit])
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
    const viewer = (facilityId: number, role: Role = 'admin') => ({ role, facilityId })

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
      expect(listTemplates(db, { role: 'admin', facilityId: 1 })[0]).toMatchObject({
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
      expect(listTemplates(db, { role: 'admin', facilityId: 1 }).map(template => [template.id, template.size, template.updatedAt]))
        .toEqual([[id, pdf('version 2').length, LATER.toISOString()]])
      expect(readTemplateFile(db, { role: 'admin', facilityId: 1 }, id).data.equals(pdf('version 2'))).toBe(true)
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
      expect(errorCode(() => readTemplateFile(db, { role: 'admin', facilityId: 1 }, id))).toBe('print_template_not_found')
      expect(readTemplateFile(db, { role: 'admin', facilityId: 1 }, kept).data.length).toBeGreaterThan(0)
    })

    it('keeps the Träger\'s global templates away from the Leitung (403), but lets the Träger change them', () => {
      const id = upload(provider, { scope: 'all' })
      expect(errorCode(() => updateTemplate(db, leitung, id, { title: 'X', categoryId: cat.Eltern! }))).toBe('forbidden')
      expect(errorCode(() => replaceTemplateFile(db, leitung, id, { data: pdf('x'), filename: 'x.pdf' }))).toBe('forbidden')
      expect(errorCode(() => deleteTemplate(db, leitung, id))).toBe('forbidden')
      updateTemplate(db, provider, id, { title: 'Neu', categoryId: cat.Personal! })
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
})
