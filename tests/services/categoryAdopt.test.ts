import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { and, asc, eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { contactCategories, contacts, knowledgeCategories, knowledgeEntries, printTemplateOrder, printTemplates, templateCategories } from '../../server/db/schema'
import { missingCategories } from '../../server/services/categoryAdopt'
import { createContact, listContacts, updateContact } from '../../server/services/contacts'
import { createKnowledgeEntry, listKnowledge, updateKnowledgeEntry } from '../../server/services/knowledge'
import { listTemplates, updateTemplate, uploadTemplate } from '../../server/services/printTemplates'
import type { ContactInput, DocumentScope, KnowledgeEntryInput, Role } from '../../shared/types/api'
import { addFacility, addUser, createTestDb, errorCode, permissionsOf } from '../helpers/fixtures'

const NOW = new Date('2026-11-24T09:00:00.000Z')
const PDF = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')

/**
 * Saving an item of the Träger for several or all facilities asks whether its category (and subcategory) should be
 * created where it is missing (server/services/categoryAdopt.ts), for Vorlagen, „Wissen“ and Kontakte.
 */
describe('creating the category in the other facilities', () => {
  let db: Db
  let krippe: number
  let hort: number
  const as = (role: Role, facilityId = 1) => ({ id: 1, role, permissions: permissionsOf(role), facilityId, homeGroupId: null, employeeId: null })
  const provider = (facilityId = 1) => as('provider', facilityId)
  const leitung = () => as('admin')
  const ask = (kind: 'template' | 'knowledge' | 'contact', scope: DocumentScope, categoryName: string, subcategoryName?: string, facilityIds?: number[]) =>
    missingCategories(db, kind, provider(), { scope, facilityIds, categoryName, subcategoryName }).facilities.map(facility => facility.id)

  beforeEach(() => {
    db = createTestDb()
    addUser(db, 'traeger', 'provider')
    krippe = addFacility(db, 'Krippe')
    hort = addFacility(db, 'Hort')
  })

  describe('Vorlagen', () => {
    const categories = (facilityId: number) => db.select().from(templateCategories).where(eq(templateCategories.facilityId, facilityId))
      .orderBy(asc(templateCategories.sortOrder), asc(templateCategories.id)).all()
    const named = (facilityId: number, name: string, parentId: number | null = null) =>
      categories(facilityId).find(row => row.parentId === parentId && row.name.toLowerCase() === name.toLowerCase())
    const upload = (title: string, extra: { scope?: DocumentScope; facilityIds?: number[]; subcategoryName?: string; categoryName?: string; createCategories?: boolean } = {}) =>
      uploadTemplate(db, provider(), {
        title, scope: extra.scope ?? 'all', categoryName: extra.categoryName ?? 'elternbriefe', subcategoryName: extra.subcategoryName ?? 'Herbst',
        facilityIds: extra.facilityIds, visibility: 'all', createCategories: extra.createCategories,
      }, { data: PDF, filename: 'x.pdf' }, NOW)
    const placed = (facilityId: number, id: number) => listTemplates(db, provider(facilityId)).find(item => item.id === id)!

    let source: number
    beforeEach(() => {
      // Facility 1 has „Elternbriefe › Herbst“ (for Leitung and Träger / the Träger alone); the Krippe „ELTERNBRIEFE“ without
      // the subcategory; the Hort neither.
      source = db.insert(templateCategories).values({ facilityId: 1, name: 'Elternbriefe', sortOrder: 50, visibility: 'managers' }).returning().get().id
      db.insert(templateCategories).values({ facilityId: 1, parentId: source, name: 'Herbst', sortOrder: 0, visibility: 'provider' }).run()
      db.insert(templateCategories).values({ facilityId: krippe, name: 'ELTERNBRIEFE', sortOrder: 50 }).run()
    })

    it('lists exactly the facilities that lack the category or, given one, the subcategory (regardless of case)', () => {
      expect(ask('template', 'all', 'elternbriefe', 'HERBST')).toEqual([krippe, hort])
      expect(ask('template', 'all', ' Elternbriefe ')).toEqual([hort])
      expect(ask('template', 'selected', 'Elternbriefe', 'Herbst', [1, hort])).toEqual([hort])
      expect(ask('template', 'selected', 'Elternbriefe', 'Herbst', [hort])).toEqual([])
      expect(ask('template', 'facility', 'Elternbriefe', 'Herbst')).toEqual([])
      expect(ask('template', 'all', '  ')).toEqual([])
      expect(errorCode(() => missingCategories(db, 'template', leitung(), { scope: 'all', categoryName: 'X' }))).toBe('forbidden')
    })

    it('„Ja“: creates them with the source\'s visibility at the end, without duplicates, and the template shows there at the end', () => {
      const other = upload('Vorher', { categoryName: 'ELTERNBRIEFE', subcategoryName: '' })
      const lastTop = Math.max(...categories(hort).filter(row => row.parentId === null).map(row => row.sortOrder))
      const id = upload('Brief', { createCategories: true })
      // The Krippe keeps its „ELTERNBRIEFE“ and gets „Herbst“ under it; the Hort gets both at the end.
      expect(categories(krippe).filter(row => row.name.toLowerCase() === 'elternbriefe')).toHaveLength(1)
      const krippeTop = named(krippe, 'Elternbriefe')!
      expect(named(krippe, 'Herbst', krippeTop.id)).toMatchObject({ visibility: 'provider', sortOrder: 0 })
      const hortTop = named(hort, 'Elternbriefe')!
      expect(hortTop).toMatchObject({ name: 'elternbriefe', visibility: 'managers', sortOrder: lastTop + 1 })
      expect(named(hort, 'Herbst', hortTop.id)).toMatchObject({ visibility: 'provider', sortOrder: 0 })
      expect(placed(hort, id)).toMatchObject({ categoryId: hortTop.id, subcategory: 'Herbst' })
      expect(placed(krippe, id)).toMatchObject({ categoryId: krippeTop.id, subcategory: 'Herbst' })
      // The one of before moved from „Vom Träger“ into the new category of the Hort.
      expect(placed(hort, other)).toMatchObject({ categoryId: hortTop.id, subcategoryId: null })
      expect(db.select().from(printTemplateOrder).where(and(eq(printTemplateOrder.facilityId, hort), eq(printTemplateOrder.templateId, id))).get())
        .toBeDefined()
      // Asked again: nothing is missing, nothing doubles.
      const count = db.select().from(templateCategories).all().length
      upload('Zweiter', { createCategories: true })
      expect(db.select().from(templateCategories).all()).toHaveLength(count)
      expect(ask('template', 'all', 'Elternbriefe', 'Herbst')).toEqual([])
    })

    it('„Nein“: saved as before, under „Vom Träger“ where missing; a change can still ask for them', () => {
      const count = db.select().from(templateCategories).all().length
      const id = upload('Brief')
      expect(db.select().from(templateCategories).all()).toHaveLength(count)
      expect(placed(hort, id)).toMatchObject({ categoryId: null, category: 'elternbriefe', subcategory: 'Herbst' })
      updateTemplate(db, provider(), id, { title: 'Brief', categoryName: 'elternbriefe', subcategoryName: 'Herbst', visibility: 'all', createCategories: true }, NOW)
      expect(placed(hort, id)).toMatchObject({ categoryId: named(hort, 'Elternbriefe')!.id, subcategory: 'Herbst' })
      // Only in the facilities of its „Gilt für“: a template for the Hort alone adds nothing to the Krippe.
      const single = upload('Nur Hort', { scope: 'selected', facilityIds: [hort], categoryName: 'Hortbriefe', subcategoryName: '', createCategories: true })
      expect(named(krippe, 'Hortbriefe')).toBeUndefined()
      expect(placed(hort, single).categoryId).toBe(named(hort, 'Hortbriefe')!.id)
    })

    it('creates nothing when the save fails, and refuses the request from the Leitung', () => {
      db.run(sql.raw(`CREATE TEMP TRIGGER no_hort BEFORE INSERT ON template_categories WHEN NEW.facility_id = ${hort} BEGIN SELECT RAISE(ABORT, 'nein'); END`))
      const templates = db.select().from(printTemplates).all().length
      expect(() => upload('Brief', { createCategories: true })).toThrow(/nein/)
      expect(db.select().from(printTemplates).all()).toHaveLength(templates)
      expect(named(krippe, 'Herbst', named(krippe, 'Elternbriefe')!.id)).toBeUndefined()
      db.run(sql.raw('DROP TRIGGER no_hort'))
      const own = categories(1)[0]!.id
      expect(errorCode(() => uploadTemplate(db, leitung(), { title: 'X', scope: 'facility', categoryId: own, createCategories: true }, { data: PDF, filename: 'x.pdf' }, NOW)))
        .toBe('forbidden')
      const id = uploadTemplate(db, leitung(), { title: 'X', scope: 'facility', categoryId: own }, { data: PDF, filename: 'x.pdf' }, NOW)
      expect(errorCode(() => updateTemplate(db, leitung(), id, { title: 'X', categoryId: own, createCategories: true }, NOW))).toBe('forbidden')
    })
  })

  describe('„Wissen“', () => {
    const categories = (facilityId: number) => db.select().from(knowledgeCategories).where(eq(knowledgeCategories.facilityId, facilityId))
      .orderBy(asc(knowledgeCategories.sortOrder), asc(knowledgeCategories.id)).all()
    const named = (facilityId: number, name: string, parentId: number | null = null) =>
      categories(facilityId).find(row => row.parentId === parentId && row.name.toLowerCase() === name.toLowerCase())
    const input = (extra: Partial<KnowledgeEntryInput> = {}): KnowledgeEntryInput => ({
      kind: 'text', title: 'Hygieneplan', description: '', asOf: '', url: '', body: '<p>Text</p>', needsConfirmation: false,
      scope: 'all', categoryName: 'Hygiene', subcategoryName: 'Küche', ...extra,
    })
    const placed = (facilityId: number, id: number) => listKnowledge(db, provider(facilityId)).entries.find(entry => entry.id === id)!

    it('lists, creates (with the source\'s visibility, at the end, no duplicates) and leaves „Nein“ as before', () => {
      const source = db.insert(knowledgeCategories).values({ facilityId: 1, name: 'Hygiene', sortOrder: 90, visibility: 'managers' }).returning().get().id
      db.insert(knowledgeCategories).values({ facilityId: krippe, name: 'hygiene', sortOrder: 90 }).run()
      db.insert(knowledgeCategories).values({ facilityId: krippe, parentId: db.select().from(knowledgeCategories)
        .where(and(eq(knowledgeCategories.facilityId, krippe), eq(knowledgeCategories.name, 'hygiene'))).get()!.id, name: 'KÜCHE', sortOrder: 0 }).run()
      expect(ask('knowledge', 'all', 'HYGIENE', 'küche')).toEqual([1, hort])
      expect(ask('knowledge', 'selected', 'Hygiene', '', [1, krippe])).toEqual([])
      expect(errorCode(() => missingCategories(db, 'knowledge', leitung(), { scope: 'all', categoryName: 'X' }))).toBe('forbidden')
      // „Nein“.
      const before = db.select().from(knowledgeCategories).all().length
      const plain = createKnowledgeEntry(db, provider(), input({ title: 'Ohne' }), null, NOW)
      expect(db.select().from(knowledgeCategories).all()).toHaveLength(before)
      expect(placed(hort, plain).categoryId).toBeNull()
      // „Ja“: the subcategory in facility 1, both in the Hort (visibility of facility 1's „Hygiene“), nothing new in the Krippe.
      const lastTop = Math.max(...categories(hort).filter(row => row.parentId === null).map(row => row.sortOrder))
      const id = createKnowledgeEntry(db, provider(), input({ createCategories: true }), null, NOW)
      expect(named(1, 'Küche', source)).toMatchObject({ visibility: 'all' })
      const hortTop = named(hort, 'Hygiene')!
      expect(hortTop).toMatchObject({ visibility: 'managers', sortOrder: lastTop + 1 })
      expect(placed(hort, id)).toMatchObject({ categoryId: hortTop.id, subcategoryId: named(hort, 'Küche', hortTop.id)!.id })
      expect(categories(krippe).filter(row => row.name.toLowerCase() === 'küche')).toHaveLength(1)
      // A change asks for them too; the entry of before now shows there.
      updateKnowledgeEntry(db, provider(), plain, input({ title: 'Ohne', createCategories: true }), null, NOW)
      expect(placed(hort, plain).categoryId).toBe(hortTop.id)
      expect(db.select().from(knowledgeCategories).where(eq(knowledgeCategories.facilityId, hort)).all()
        .filter(row => row.name.toLowerCase() === 'hygiene')).toHaveLength(1)
    })

    it('creates nothing when the save fails, and refuses the request from the Leitung', () => {
      db.run(sql.raw(`CREATE TEMP TRIGGER no_hort BEFORE INSERT ON knowledge_categories WHEN NEW.facility_id = ${hort} BEGIN SELECT RAISE(ABORT, 'nein'); END`))
      const entries = db.select().from(knowledgeEntries).all().length
      expect(() => createKnowledgeEntry(db, provider(), input({ createCategories: true }), null, NOW)).toThrow(/nein/)
      expect(db.select().from(knowledgeEntries).all()).toHaveLength(entries)
      expect(named(1, 'Hygiene')).toBeUndefined()
      db.run(sql.raw('DROP TRIGGER no_hort'))
      const own = categories(1)[0]!.id
      expect(errorCode(() => createKnowledgeEntry(db, leitung(), input({ scope: 'facility', categoryId: own, createCategories: true }), null, NOW)))
        .toBe('forbidden')
    })
  })

  describe('Kontakte', () => {
    const categories = (facilityId: number) => db.select().from(contactCategories).where(eq(contactCategories.facilityId, facilityId))
      .orderBy(asc(contactCategories.sortOrder), asc(contactCategories.id)).all()
    const contact = (extra: Partial<ContactInput> = {}): ContactInput => ({
      organisation: 'Kreisjugendamt', person: '', role: '', phone: '', mobile: '', email: '', street: '', postalCode: '', city: '',
      website: '', note: '', visibleToStaff: false, scope: 'all', categoryName: 'Ämter', ...extra,
    })
    const placed = (facilityId: number, id: number) => listContacts(db, provider(facilityId)).contacts.find(entry => entry.id === id)!

    it('lists, creates at the end without duplicates, and leaves „Nein“ as before', () => {
      db.insert(contactCategories).values({ facilityId: krippe, name: 'ÄMTER', sortOrder: 99 }).run()
      expect(ask('contact', 'all', 'ämter', 'egal')).toEqual([1, hort])
      expect(ask('contact', 'selected', 'Ämter', undefined, [krippe, hort])).toEqual([hort])
      expect(errorCode(() => missingCategories(db, 'contact', leitung(), { scope: 'all', categoryName: 'X' }))).toBe('forbidden')
      const plain = createContact(db, provider(), contact({ organisation: 'Ohne' }), NOW)
      expect(categories(hort).some(row => row.name === 'Ämter')).toBe(false)
      expect(placed(hort, plain).categoryId).toBeNull()
      const lastHort = Math.max(...categories(hort).map(row => row.sortOrder))
      const id = createContact(db, provider(), contact({ createCategories: true }), NOW)
      const hortCategory = categories(hort).find(row => row.name === 'Ämter')!
      expect(hortCategory.sortOrder).toBe(lastHort + 1)
      expect(categories(krippe).filter(row => row.name.toLowerCase() === 'ämter')).toHaveLength(1)
      expect([placed(1, id).categoryId, placed(hort, id).categoryId, placed(hort, plain).categoryId])
        .toEqual([categories(1).find(row => row.name === 'Ämter')!.id, hortCategory.id, hortCategory.id])
      updateContact(db, provider(), plain, contact({ organisation: 'Ohne', createCategories: true }), NOW)
      expect(categories(hort).filter(row => row.name === 'Ämter')).toHaveLength(1)
    })

    it('creates nothing when the save fails, and refuses the request from the Leitung', () => {
      db.run(sql.raw(`CREATE TEMP TRIGGER no_hort BEFORE INSERT ON contact_categories WHEN NEW.facility_id = ${hort} BEGIN SELECT RAISE(ABORT, 'nein'); END`))
      expect(() => createContact(db, provider(), contact({ createCategories: true }), NOW)).toThrow(/nein/)
      expect(db.select().from(contacts).all()).toHaveLength(0)
      expect(categories(1).some(row => row.name === 'Ämter')).toBe(false)
      db.run(sql.raw('DROP TRIGGER no_hort'))
      const own = categories(1)[0]!.id
      expect(errorCode(() => createContact(db, leitung(), contact({ scope: 'facility', categoryId: own, createCategories: true }), NOW))).toBe('forbidden')
      const id = createContact(db, leitung(), contact({ scope: 'facility', categoryId: own }), NOW)
      expect(errorCode(() => updateContact(db, leitung(), id, contact({ scope: 'facility', categoryId: own, createCategories: true }), NOW))).toBe('forbidden')
    })
  })

  it('asks through one route per kind, the Träger\'s across all facilities', () => {
    for (const [route, right] of [
      ['print-templates/missing-categories.post.ts', 'printTemplates.global'], ['knowledge/missing-categories.post.ts', 'knowledge.global'],
      ['contacts/missing-categories.post.ts', 'contacts.global'],
    ]) {
      expect(readFileSync(join(process.cwd(), 'server', 'api', route!), 'utf8'), route).toContain(`requirePermission(event, '${right}', { facility: 'none' })`)
    }
  })
})
