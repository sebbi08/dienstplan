import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import {
  employees, entries, facilityHelpoutPairs, knowledgeCategories, knowledgeConfirmations, knowledgeEntries, knowledgeEntryOrder, knowledgeStarterSeeds,
} from '../../server/db/schema'
import { deleteAssessmentData, deleteImmediateData } from '../../server/services/employeeDeletion'
import { createFacility } from '../../server/services/facilities'
import {
  confirmAtTablet, confirmKnowledge, confirmWithAccount, createKnowledgeCategory, createKnowledgeEntry, deleteKnowledgeCategory, deleteKnowledgeEntry,
  globalKnowledgeCategoryNames, confirmationOverview as overview, listKnowledge, moveKnowledgeCategory, orderKnowledgeEntries,
  correctKnowledgeStarterUrls, openKnowledgeCount, readKnowledgeFile, seedPendingKnowledgeStarters, updateKnowledgeCategory, updateKnowledgeEntry,
} from '../../server/services/knowledge'
import { setPin } from '../../server/services/terminal'
import { KNOWLEDGE_STARTER_CATEGORIES, KNOWLEDGE_STARTER_LINKS, KNOWLEDGE_STARTER_SUBCATEGORIES } from '../../shared/domain/knowledge'
import type { PermissionKey } from '../../shared/domain/permissions'
import type { KnowledgeEntryInput, Role } from '../../shared/types/api'
import { addEmployee, addFacility, addHelpoutPair, addUser, createTestDb, errorCode, permissionsOf } from '../helpers/fixtures'

const NOW = new Date('2026-11-23T09:00:00.000Z')
const TODAY = '2026-11-23'
const PDF = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')
const PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0])

/** A link entry in the category, with everything else empty. */
const link = (categoryId: number | undefined, overrides: Partial<KnowledgeEntryInput> = {}): KnowledgeEntryInput => ({
  kind: 'link', title: 'Hygieneplan', description: '', asOf: '', url: 'https://www.example.de/hygiene', body: '',
  needsConfirmation: false, categoryId, ...overrides,
})

describe('„Wissen“ (knowledge library)', () => {
  let db: Db
  /** An actor of the role with the role's default permissions, in facility 1 unless named. */
  const as = (role: Role, facilityId = 1, employeeId: number | null = null, id = 1) =>
    ({ id, role, permissions: permissionsOf(role), employeeId, facilityId })
  const provider = as('provider')
  const leitung = as('admin', 1, null, 2)
  const staff = as('observer')
  /** The facility's tablet: no permission of its own. */
  const tablet = { id: 3, role: 'terminal' as Role, permissions: new Set<PermissionKey>(), employeeId: null, facilityId: 1 }
  const categoryId = (name: string, facilityId = 1) =>
    db.select().from(knowledgeCategories).where(and(eq(knowledgeCategories.facilityId, facilityId), eq(knowledgeCategories.name, name))).get()!.id
  const titles = (viewer: Parameters<typeof listKnowledge>[1]) => listKnowledge(db, viewer).entries.map(entry => entry.title)
  /** The names of the categories (without the subcategories). */
  const categoryNames = (viewer: Parameters<typeof listKnowledge>[1]) =>
    listKnowledge(db, viewer).categories.filter(category => category.parentId === null).map(category => category.name)
  /** Drops the starter links of facility 1, so each test sees only its own entries. */
  const clearStarters = () => db.delete(knowledgeEntries).run()

  beforeEach(() => {
    db = createTestDb()
    addUser(db, 'traeger', 'provider')
    addUser(db, 'leitung', 'admin')
    addUser(db, 'tablet', 'terminal')
  })

  describe('starters', () => {
    it('gives every facility the example categories with the official links, Baden-Württemberg ones only there', () => {
      expect(categoryNames(leitung)).toEqual(['Orientierungsplan', 'Aufsichtspflicht', 'Kinderschutz', 'Hygiene & Gesundheit', 'Gesetze & Vorgaben'])
      const entries = listKnowledge(db, staff).entries
      expect(entries.map(entry => entry.title)).toEqual(KNOWLEDGE_STARTER_LINKS.map(starter => starter.title))
      expect(entries.every(entry => entry.kind === 'link' && entry.url.startsWith('https://') && !entry.global)).toBe(true)
      expect(entries.find(entry => entry.title.startsWith('§ 8a'))!.categoryId).toBe(categoryId('Kinderschutz'))
      // A new facility in Bavaria: the categories, but no Orientierungsplan BW and no KiTaG BW.
      const bavaria = createFacility(db, 'Kita München', 'BY', TODAY).id
      expect(categoryNames(as('admin', bavaria))).toEqual(KNOWLEDGE_STARTER_CATEGORIES.map(category => category.name))
      expect(titles(as('admin', bavaria))).toEqual(KNOWLEDGE_STARTER_LINKS.filter(starter => !starter.states).map(starter => starter.title))
      const freiburg = addFacility(db, 'Kita Freiburg')
      expect(titles(as('admin', freiburg))).toHaveLength(KNOWLEDGE_STARTER_LINKS.length)
    })

    it('never brings back a deleted starter link or category, but adds a starter new in a later version', () => {
      const ifsg = listKnowledge(db, leitung).entries.find(entry => entry.title.startsWith('§ 34 IfSG'))!
      deleteKnowledgeEntry(db, leitung, ifsg.id)
      deleteKnowledgeEntry(db, leitung, listKnowledge(db, leitung).entries.find(entry => entry.title.startsWith('§ 832'))!.id)
      deleteKnowledgeCategory(db, leitung, categoryId('Aufsichtspflicht'))
      expect(seedPendingKnowledgeStarters(db, NOW)).toBe(0)
      expect(titles(leitung)).not.toContain(ifsg.title)
      expect(categoryNames(leitung)).not.toContain('Aufsichtspflicht')
      // A starter the facility has not been given yet (as if new in this version) arrives at the next start.
      db.delete(knowledgeStarterSeeds).where(eq(knowledgeStarterSeeds.starterKey, 'link:ifsg-34')).run()
      expect(seedPendingKnowledgeStarters(db, NOW)).toBe(1)
      expect(titles(leitung)).toContain(ifsg.title)
      // One whose category is gone is recorded without being created.
      db.delete(knowledgeStarterSeeds).where(eq(knowledgeStarterSeeds.starterKey, 'link:bgb-832')).run()
      seedPendingKnowledgeStarters(db, NOW)
      expect(titles(leitung).some(title => title.startsWith('§ 832'))).toBe(false)
      expect(seedPendingKnowledgeStarters(db, NOW)).toBe(0)
    })

    it('points a starter link still on its former address to the current one, leaving edited links and copies alone', () => {
      const kitag = KNOWLEDGE_STARTER_LINKS.find(link => link.key === 'link:kitag-bw')!
      const former = kitag.formerUrls![0]!
      expect(kitag.url).toBe('https://www.landesrecht-bw.de/perma?a=KiTaG_BW')
      const krippe = addFacility(db, 'Krippe')
      const kitagOf = (facilityId: number) => db.select().from(knowledgeEntries)
        .where(and(eq(knowledgeEntries.facilityId, facilityId), eq(knowledgeEntries.starterKey, 'link:kitag-bw'))).get()!
      // As an earlier version seeded them: facility 1 unchanged, the Krippe's link edited by hand.
      db.update(knowledgeEntries).set({ url: former }).where(eq(knowledgeEntries.id, kitagOf(1).id)).run()
      db.update(knowledgeEntries).set({ url: 'https://www.example.de/kitag' }).where(eq(knowledgeEntries.id, kitagOf(krippe).id)).run()
      // A copy of the old address without the starter key (typed in by hand) is not a starter.
      const copy = createKnowledgeEntry(db, leitung, link(categoryId('Kinderschutz'), { url: former }), null, NOW)
      const before = kitagOf(1)
      expect(correctKnowledgeStarterUrls(db)).toBe(1)
      expect(kitagOf(1)).toEqual({ ...before, url: kitag.url })
      expect(kitagOf(krippe).url).toBe('https://www.example.de/kitag')
      expect(db.select({ url: knowledgeEntries.url }).from(knowledgeEntries).where(eq(knowledgeEntries.id, copy)).get()!.url).toBe(former)
      // Run again (at every start) it changes nothing; the startup step runs it.
      expect(correctKnowledgeStarterUrls(db)).toBe(0)
      db.update(knowledgeEntries).set({ url: former }).where(eq(knowledgeEntries.id, kitagOf(1).id)).run()
      seedPendingKnowledgeStarters(db, NOW)
      expect(kitagOf(1).url).toBe(kitag.url)
    })
  })

  describe('visibility', () => {
    beforeEach(clearStarters)

    it('shows Mitarbeiter and the tablet only categories visible to all, the Leitung also hers, the Träger everything', () => {
      const team = createKnowledgeCategory(db, leitung, { name: 'Leitungsordner', visibility: 'managers' })
      const own = createKnowledgeCategory(db, provider, { name: 'Trägerordner', visibility: 'provider' })
      createKnowledgeEntry(db, leitung, link(categoryId('Kinderschutz'), { title: 'Für alle' }), null, NOW)
      createKnowledgeEntry(db, leitung, link(team, { title: 'Für die Leitung' }), null, NOW)
      createKnowledgeEntry(db, provider, link(own, { title: 'Für den Träger' }), null, NOW)
      expect(titles(staff)).toEqual(['Für alle'])
      expect(titles(tablet)).toEqual(['Für alle'])
      expect(titles(leitung)).toEqual(['Für alle', 'Für die Leitung'])
      expect(titles(provider)).toEqual(['Für alle', 'Für die Leitung', 'Für den Träger'])
      expect(categoryNames(staff)).not.toContain('Leitungsordner')
      expect(categoryNames(leitung)).not.toContain('Trägerordner')
      // A Leitung cannot give a category the Träger's visibility, nor see the Träger's category.
      expect(errorCode(() => createKnowledgeCategory(db, leitung, { name: 'Geheim', visibility: 'provider' }))).toBe('forbidden')
      expect(errorCode(() => updateKnowledgeCategory(db, leitung, own, { name: 'X', visibility: 'all' }))).toBe('knowledge_category_not_found')
    })

    it('files entries for all facilities by category name or under „Vom Träger“, with the stricter visibility', () => {
      const krippe = addFacility(db, 'Krippe')
      db.delete(knowledgeEntries).run()
      const global = { scope: 'all' as const, categoryId: undefined }
      createKnowledgeEntry(db, provider, link(undefined, { ...global, title: 'Kinderschutzkonzept', categoryName: 'kinderschutz' }), null, NOW)
      createKnowledgeEntry(db, provider, link(undefined, { ...global, title: 'Leitfaden Träger', categoryName: 'Qualität' }), null, NOW)
      createKnowledgeEntry(db, provider, link(undefined, { ...global, title: 'Nur Leitung', categoryName: 'Kinderschutz', visibility: 'managers' }), null, NOW)
      const listed = listKnowledge(db, as('admin', krippe)).entries
      expect(listed.map(entry => [entry.title, entry.categoryId])).toEqual([
        ['Kinderschutzkonzept', categoryId('Kinderschutz', krippe)], ['Nur Leitung', categoryId('Kinderschutz', krippe)],
        ['Leitfaden Träger', null],
      ])
      expect(listed.every(entry => entry.global && !entry.canEdit)).toBe(true)
      expect(titles(as('observer', krippe))).toEqual(['Kinderschutzkonzept', 'Leitfaden Träger'])
      // A category for the managers holds back an entry for all facilities filed under its name.
      updateKnowledgeCategory(db, as('admin', krippe), categoryId('Kinderschutz', krippe), { name: 'Kinderschutz', visibility: 'managers' })
      expect(titles(as('observer', krippe))).toEqual(['Leitfaden Träger'])
      expect(globalKnowledgeCategoryNames(db, provider).map(entry => entry.name)).toContain('Qualität')
      expect(errorCode(() => globalKnowledgeCategoryNames(db, leitung))).toBe('forbidden')
    })

    it('keeps each facility to its own entries and categories', () => {
      const krippe = addFacility(db, 'Krippe')
      const other = createKnowledgeEntry(db, as('admin', krippe), link(categoryId('Hygiene & Gesundheit', krippe), { title: 'Krippe' }), null, NOW)
      expect(titles(leitung)).not.toContain('Krippe')
      expect(errorCode(() => updateKnowledgeEntry(db, leitung, other, link(categoryId('Hygiene & Gesundheit')), null, NOW))).toBe('knowledge_entry_not_found')
      expect(errorCode(() => deleteKnowledgeEntry(db, leitung, other))).toBe('knowledge_entry_not_found')
      expect(errorCode(() => confirmWithAccount(db, { ...staff, employeeId: addEmployee(db, 'Tina') }, other, 1, NOW))).toBe('knowledge_entry_not_found')
      expect(errorCode(() => deleteKnowledgeCategory(db, leitung, categoryId('Hygiene & Gesundheit', krippe)))).toBe('knowledge_category_not_found')
      // Filing into another facility's category is refused.
      expect(errorCode(() => createKnowledgeEntry(db, leitung, link(categoryId('Hygiene & Gesundheit', krippe)), null, NOW))).toBe('knowledge_category_invalid')
    })
  })

  describe('maintaining', () => {
    beforeEach(clearStarters)

    it('leaves maintaining to knowledge.manage and entries for all facilities to the Träger', () => {
      const hygiene = categoryId('Hygiene & Gesundheit')
      expect(errorCode(() => createKnowledgeEntry(db, staff, link(hygiene), null, NOW))).toBe('forbidden')
      expect(errorCode(() => createKnowledgeCategory(db, staff, { name: 'X', visibility: 'all' }))).toBe('forbidden')
      expect(errorCode(() => createKnowledgeEntry(db, leitung, link(undefined, { scope: 'all', categoryName: 'X' }), null, NOW))).toBe('forbidden')
      const global = createKnowledgeEntry(db, provider, link(undefined, { scope: 'all', categoryName: 'Hygiene & Gesundheit' }), null, NOW)
      expect(errorCode(() => deleteKnowledgeEntry(db, leitung, global))).toBe('forbidden')
      expect(listKnowledge(db, staff)).toMatchObject({ canManage: false, canManageGlobal: false, confirmVia: null })
      expect(listKnowledge(db, leitung)).toMatchObject({ canManage: true, canManageGlobal: false })
      expect(listKnowledge(db, provider)).toMatchObject({ canManage: true, canManageGlobal: true })
    })

    it('takes links with http or https only', () => {
      const hygiene = categoryId('Hygiene & Gesundheit')
      for (const url of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,<script>alert(1)</script>', 'ftp://x.de/a', '', 'www.x .de', `https://x.de/${'a'.repeat(500)}`]) {
        expect(errorCode(() => createKnowledgeEntry(db, leitung, link(hygiene, { url }), null, NOW)), url).toBe('knowledge_url_invalid')
      }
      const id = createKnowledgeEntry(db, leitung, link(hygiene, { url: ' www.rki.de/ratgeber ' }), null, NOW)
      expect(listKnowledge(db, staff).entries.find(entry => entry.id === id)!.url).toBe('https://www.rki.de/ratgeber')
    })

    it('checks title, description and „Stand vom“', () => {
      const hygiene = categoryId('Hygiene & Gesundheit')
      expect(errorCode(() => createKnowledgeEntry(db, leitung, link(hygiene, { title: '  ' }), null, NOW))).toBe('knowledge_title_required')
      expect(errorCode(() => createKnowledgeEntry(db, leitung, link(hygiene, { title: 'x'.repeat(121) }), null, NOW))).toBe('knowledge_title_too_long')
      expect(errorCode(() => createKnowledgeEntry(db, leitung, link(hygiene, { description: 'x'.repeat(501) }), null, NOW))).toBe('knowledge_description_too_long')
      expect(errorCode(() => createKnowledgeEntry(db, leitung, link(hygiene, { asOf: '2026-02-30' }), null, NOW))).toBe('knowledge_as_of_invalid')
      const id = createKnowledgeEntry(db, leitung, link(hygiene, { asOf: '2026-09-01', description: ' Stand der Hygiene ' }), null, NOW)
      expect(listKnowledge(db, staff).entries[0]).toMatchObject({ id, asOf: '2026-09-01', description: 'Stand der Hygiene' })
    })

    it('stores PDFs only, up to 30 MB, judged by their first bytes', () => {
      const hygiene = categoryId('Hygiene & Gesundheit')
      const file = (data: Buffer) => () => createKnowledgeEntry(db, leitung, { ...link(hygiene), kind: 'file', url: '' }, { data }, NOW)
      expect(errorCode(file(PNG))).toBe('knowledge_file_type_invalid')
      const limit = 30 * 1024 * 1024
      expect(errorCode(file(Buffer.concat([PDF, Buffer.alloc(limit + 1 - PDF.length)])))).toBe('document_too_large')
      expect(file(Buffer.concat([PDF, Buffer.alloc(limit - PDF.length)]))()).toBeGreaterThan(0)
      db.delete(knowledgeEntries).run()
      expect(errorCode(() => createKnowledgeEntry(db, leitung, { ...link(hygiene), kind: 'file' }, null, NOW))).toBe('file_required')
      const id = file(PDF)()
      const entry = listKnowledge(db, staff).entries[0]!
      expect(entry).toMatchObject({ id, kind: 'file', url: '', fileSize: PDF.length })
      expect(readKnowledgeFile(db, tablet, id)).toEqual({ data: PDF, mimeType: 'application/pdf', fileName: 'Hygieneplan.pdf' })
      // A link has no file to read.
      const other = createKnowledgeEntry(db, leitung, link(hygiene), null, NOW)
      expect(errorCode(() => readKnowledgeFile(db, staff, other))).toBe('knowledge_entry_not_found')
    })

    it('sanitizes the text of a text entry like the free-text answers', () => {
      const hygiene = categoryId('Hygiene & Gesundheit')
      const text = (body: string) => ({ ...link(hygiene), kind: 'text' as const, url: '', body })
      const id = createKnowledgeEntry(db, leitung, text('<p onclick="x()">Hände <b>waschen</b><script>alert(1)</script></p><img src=x onerror=alert(1)><a href="javascript:x">Link</a>'), null, NOW)
      expect(listKnowledge(db, staff).entries[0]).toMatchObject({ id, body: '<p>Hände <strong>waschen</strong></p><p>Link</p>', url: '' })
      updateKnowledgeEntry(db, leitung, id, text('Zeile 1\nZeile <2>'), null, NOW)
      expect(listKnowledge(db, staff).entries[0]!.body).toBe('<p>Zeile 1</p><p>Zeile &lt;2&gt;</p>')
      expect(errorCode(() => createKnowledgeEntry(db, leitung, text('<p> </p>'), null, NOW))).toBe('knowledge_body_required')
      expect(errorCode(() => createKnowledgeEntry(db, leitung, text(`<p>${'x'.repeat(4001)}</p>`), null, NOW))).toBe('knowledge_body_too_long')
      expect(errorCode(() => createKnowledgeEntry(db, leitung, text(`<p>${'<b></b>'.repeat(6000)}x</p>`), null, NOW))).toBe('knowledge_body_too_long')
    })

    it('orders every entry of a list with ▲/▼, the Träger\'s too, per facility; new ones go to the end', () => {
      const krippe = addFacility(db, 'Krippe')
      db.delete(knowledgeEntries).run()
      const hygiene = categoryId('Hygiene & Gesundheit')
      const a = createKnowledgeEntry(db, leitung, link(hygiene, { title: 'A' }), null, NOW)
      const b = createKnowledgeEntry(db, leitung, link(hygiene, { title: 'B' }), null, NOW)
      const global = createKnowledgeEntry(db, provider, link(undefined, { scope: 'all', categoryName: 'Hygiene & Gesundheit', title: '0 Träger' }), null, NOW)
      const ids = () => listKnowledge(db, leitung).entries.map(entry => entry.id)
      // A new entry, the Träger's as well, goes to the end of its list in every facility it shows in.
      expect(ids()).toEqual([a, b, global])
      orderKnowledgeEntries(db, leitung, hygiene, [global, b, a])
      expect(titles(staff)).toEqual(['0 Träger', 'B', 'A'])
      // The Träger's entry keeps its own place in the other facility (this order is the facility's alone).
      const krippeOwn = createKnowledgeEntry(db, as('admin', krippe), link(categoryId('Hygiene & Gesundheit', krippe), { title: 'K' }), null, NOW)
      expect(listKnowledge(db, as('admin', krippe)).entries.map(entry => entry.id)).toEqual([global, krippeOwn])
      orderKnowledgeEntries(db, as('admin', krippe), categoryId('Hygiene & Gesundheit', krippe), [krippeOwn, global])
      expect(titles(staff)).toEqual(['0 Träger', 'B', 'A'])
      const d = createKnowledgeEntry(db, leitung, link(hygiene, { title: 'D' }), null, NOW)
      expect(ids()).toEqual([global, b, a, d])
      // Exactly the list's entries the editor sees, each once.
      for (const wrong of [[global, b, a], [global, b, a, d, d], [global, b, a, krippeOwn], [global, b, a, d, 999]]) {
        expect(errorCode(() => orderKnowledgeEntries(db, leitung, hygiene, wrong)), JSON.stringify(wrong)).toBe('invalid_order')
      }
      // Another facility's category and a Mitarbeiter are refused; the order is the facility's (rows per facility).
      expect(errorCode(() => orderKnowledgeEntries(db, leitung, categoryId('Hygiene & Gesundheit', krippe), [krippeOwn, global]))).toBe('knowledge_category_not_found')
      expect(errorCode(() => orderKnowledgeEntries(db, staff, hygiene, [global, b, a, d]))).toBe('forbidden')
      expect(db.select().from(knowledgeEntryOrder).where(eq(knowledgeEntryOrder.entryId, global)).all().map(row => [row.facilityId, row.sortOrder]).sort())
        .toEqual([[1, 0], [krippe, 1]])
    })

    it('keeps hidden entries in place when the Leitung orders a list, and orders „Vom Träger“', () => {
      db.delete(knowledgeEntries).run()
      const hygiene = categoryId('Hygiene & Gesundheit')
      const a = createKnowledgeEntry(db, leitung, link(hygiene, { title: 'A' }), null, NOW)
      const hidden = createKnowledgeEntry(db, provider, link(undefined, { scope: 'all', categoryName: 'Hygiene & Gesundheit', title: 'Nur Träger', visibility: 'provider' }), null, NOW)
      const b = createKnowledgeEntry(db, leitung, link(hygiene, { title: 'B' }), null, NOW)
      expect(listKnowledge(db, provider).entries.map(entry => entry.id)).toEqual([a, hidden, b])
      // The Leitung does not see the Träger's own entry: ordering her two leaves it on its place.
      expect(errorCode(() => orderKnowledgeEntries(db, leitung, hygiene, [b, hidden, a]))).toBe('invalid_order')
      orderKnowledgeEntries(db, leitung, hygiene, [b, a])
      expect(listKnowledge(db, provider).entries.map(entry => entry.id)).toEqual([b, hidden, a])
      // „Vom Träger“ (null): entries of the Träger without a category of their name here.
      const x = createKnowledgeEntry(db, provider, link(undefined, { scope: 'all', categoryName: 'Qualität', title: 'X' }), null, NOW)
      const y = createKnowledgeEntry(db, provider, link(undefined, { scope: 'all', categoryName: 'Qualität', title: 'Y' }), null, NOW)
      orderKnowledgeEntries(db, leitung, null, [y, x])
      expect(titles(staff).slice(-2)).toEqual(['Y', 'X'])
    })

    it('deletes a category only while the facility has no entry in it; the Träger\'s entries move to „Vom Träger“', () => {
      const hygiene = categoryId('Hygiene & Gesundheit')
      const own = createKnowledgeEntry(db, leitung, link(hygiene), null, NOW)
      createKnowledgeEntry(db, provider, link(undefined, { scope: 'all', categoryName: 'hygiene & gesundheit', title: 'Global' }), null, NOW)
      expect(errorCode(() => deleteKnowledgeCategory(db, leitung, hygiene))).toBe('knowledge_category_not_empty')
      deleteKnowledgeEntry(db, leitung, own)
      deleteKnowledgeCategory(db, leitung, hygiene)
      expect(listKnowledge(db, staff).entries.map(entry => [entry.title, entry.categoryId])).toEqual([['Global', null]])
      // Names stay unique regardless of case; the order changes with ▲/▼.
      expect(errorCode(() => createKnowledgeCategory(db, leitung, { name: 'KINDERSCHUTZ', visibility: 'all' }))).toBe('knowledge_category_name_taken')
      moveKnowledgeCategory(db, leitung, categoryId('Kinderschutz'), 'up')
      expect(categoryNames(leitung).slice(0, 3)).toEqual(['Orientierungsplan', 'Kinderschutz', 'Aufsichtspflicht'])
    })
  })

  describe('„Gelesen und verstanden“', () => {
    let tina: number
    let ben: number
    let lea: number
    let entry: number
    const tinaAccount = () => ({ ...as('observer'), employeeId: tina })

    beforeEach(() => {
      clearStarters()
      tina = addEmployee(db, 'Tina Test')
      ben = addEmployee(db, 'Ben Beispiel')
      lea = addEmployee(db, 'Lea Leitung')
      addUser(db, 'lea', 'admin', lea)
      setPin(db, 1, ben, '135790')
      entry = createKnowledgeEntry(db, leitung, link(categoryId('Kinderschutz'), { title: 'Kinderschutzkonzept', needsConfirmation: true }), null, NOW)
    })

    it('lets a person confirm with the own account (its linked employee) and shows „Bestätigt am“', () => {
      expect(listKnowledge(db, tinaAccount())).toMatchObject({ confirmVia: 'account', openCount: 1 })
      expect(openKnowledgeCount(db, tinaAccount())).toBe(1)
      expect(openKnowledgeCount(db, staff)).toBe(0)
      expect(openKnowledgeCount(db, tablet)).toBe(0)
      expect(listKnowledge(db, tinaAccount()).entries[0]!.myConfirmation).toEqual({ state: 'open', confirmedAt: null })
      expect(confirmWithAccount(db, tinaAccount(), entry, 1, NOW)).toEqual({ name: 'Tina Test', confirmedAt: NOW.toISOString(), version: 1 })
      expect(listKnowledge(db, tinaAccount())).toMatchObject({ openCount: 0 })
      expect(openKnowledgeCount(db, tinaAccount())).toBe(0)
      expect(listKnowledge(db, tinaAccount()).entries[0]!.myConfirmation).toEqual({ state: 'confirmed', confirmedAt: NOW.toISOString() })
      // Without a linked employee there is nobody to confirm for.
      expect(listKnowledge(db, staff).entries[0]!.myConfirmation).toBeNull()
      expect(errorCode(() => confirmWithAccount(db, staff, entry, 1, NOW))).toBe('knowledge_no_employee')
      expect(errorCode(() => confirmWithAccount(db, tablet, entry, 1, NOW))).toBe('knowledge_no_employee')
      // An entry that asks nobody cannot be confirmed.
      const plain = createKnowledgeEntry(db, leitung, link(categoryId('Kinderschutz'), { title: 'Ohne' }), null, NOW)
      expect(errorCode(() => confirmWithAccount(db, tinaAccount(), plain, 1, NOW))).toBe('knowledge_confirmation_not_needed')
      expect(listKnowledge(db, tinaAccount()).entries.find(item => item.id === plain)!.myConfirmation!.state).toBe('none')
    })

    it('lets the person at the tablet confirm for themselves with the PIN', () => {
      expect(listKnowledge(db, tablet)).toMatchObject({ confirmVia: 'tablet', openCount: 0 })
      expect(errorCode(() => confirmAtTablet(db, { facilityId: 1 }, entry, 1, ben, '000000', NOW))).toBe('pin_invalid')
      // Tina has no PIN, so she is not on the tablet's list (no attempt counted).
      expect(errorCode(() => confirmAtTablet(db, { facilityId: 1 }, entry, 1, tina, '135790', NOW))).toBe('employee_not_found')
      expect(confirmAtTablet(db, { facilityId: 1 }, entry, 1, ben, '135790', NOW)).toMatchObject({ name: 'Ben Beispiel', version: 1 })
      expect(db.select().from(knowledgeConfirmations).all()).toEqual([
        { entryId: entry, employeeId: ben, entryVersion: 1, confirmedAt: NOW.toISOString(), via: 'tablet' },
      ])
      // The tablet only shows entries visible to all.
      const managers = createKnowledgeCategory(db, leitung, { name: 'Leitung', visibility: 'managers' })
      const hidden = createKnowledgeEntry(db, leitung, link(managers, { needsConfirmation: true }), null, NOW)
      expect(errorCode(() => confirmAtTablet(db, { facilityId: 1 }, hidden, 1, ben, '135790', NOW))).toBe('knowledge_entry_not_found')
    })

    it('asks again after a change of the content, keeping the earlier confirmation as „frühere Fassung“', () => {
      confirmWithAccount(db, tinaAccount(), entry, 1, NOW)
      const input = link(categoryId('Kinderschutz'), { title: 'Kinderschutzkonzept 2027', needsConfirmation: true, asOf: '2026-12-01' })
      // Title and „Stand vom“ alone: no new version (and the version keeps its date).
      const edited = new Date('2026-11-23T10:00:00.000Z')
      updateKnowledgeEntry(db, leitung, entry, input, null, edited)
      expect(listKnowledge(db, tinaAccount()).entries[0]).toMatchObject({ version: 1, versionAt: NOW.toISOString(), myConfirmation: { state: 'confirmed' } })
      const changed = new Date('2026-11-23T11:00:00.000Z')
      updateKnowledgeEntry(db, leitung, entry, { ...input, url: 'https://www.example.de/neu' }, null, changed)
      expect(listKnowledge(db, tinaAccount()).entries[0]).toMatchObject({
        version: 2, versionAt: changed.toISOString(), updatedAt: changed.toISOString(), myConfirmation: { state: 'outdated', confirmedAt: NOW.toISOString() },
      })
      expect(listKnowledge(db, tinaAccount()).openCount).toBe(1)
      const later = new Date('2026-11-24T08:00:00.000Z')
      confirmWithAccount(db, tinaAccount(), entry, 2, later)
      expect(listKnowledge(db, tinaAccount()).entries[0]!.myConfirmation).toEqual({ state: 'confirmed', confirmedAt: later.toISOString() })
      // A new PDF and another text count as a change too.
      updateKnowledgeEntry(db, leitung, entry, { ...input, kind: 'file' }, { data: PDF }, NOW)
      updateKnowledgeEntry(db, leitung, entry, { ...input, kind: 'file' }, null, NOW)
      expect(listKnowledge(db, tinaAccount()).entries[0]!.version).toBe(3)
      updateKnowledgeEntry(db, leitung, entry, { ...input, kind: 'text', body: '<p>Neu</p>' }, null, NOW)
      updateKnowledgeEntry(db, leitung, entry, { ...input, kind: 'text', body: '<p>Neu</p>' }, null, NOW)
      expect(listKnowledge(db, tinaAccount()).entries[0]!.version).toBe(4)
    })

    it('shows the managers who confirmed and who of the active staff has not yet', () => {
      const left = addEmployee(db, 'Alma Alt', { leftOn: '2026-06-30' })
      const krippe = addFacility(db, 'Krippe')
      const helper = addEmployee(db, 'Hans Helfer', { facilityId: krippe })
      // Planned here once (a help-out entry, the facilities paired): a helper of this facility.
      addHelpoutPair(db, 1, krippe)
      db.insert(entries).values({ employeeId: helper, date: '2026-11-02', kind: 'shift', helpFacilityId: 1, updatedAt: NOW.toISOString() }).run()
      // Someone of the Krippe who confirmed (the entry was for them before) does not show here.
      const stranger = addEmployee(db, 'Kai Krippe', { facilityId: krippe })
      db.insert(knowledgeConfirmations).values({ entryId: entry, employeeId: stranger, entryVersion: 1, confirmedAt: NOW.toISOString(), via: 'tablet' }).run()
      for (const employeeId of [left, helper]) {
        db.insert(knowledgeConfirmations).values({ entryId: entry, employeeId, entryVersion: 1, confirmedAt: NOW.toISOString(), via: 'tablet' }).run()
      }
      confirmWithAccount(db, tinaAccount(), entry, 1, NOW)
      confirmAtTablet(db, { facilityId: 1 }, entry, 1, ben, '135790', NOW)
      updateKnowledgeEntry(db, leitung, entry, link(categoryId('Kinderschutz'), { needsConfirmation: true, url: 'https://www.example.de/v2' }), null, NOW)
      confirmWithAccount(db, tinaAccount(), entry, 2, NOW)
      const result = overview(db, leitung, entry, TODAY)
      expect(result.entry).toMatchObject({ id: entry, version: 2, versionAt: NOW.toISOString(), category: 'Kinderschutz' })
      // A helper of another facility who confirmed the facility's own entry (at its tablet) shows too, not expected.
      expect(result.people.map(person => [person.name, person.state, person.via, person.expected])).toEqual([
        ['Lea Leitung', 'open', null, true],
        ['Alma Alt', 'outdated', 'tablet', false],
        ['Ben Beispiel', 'outdated', 'tablet', true],
        ['Hans Helfer', 'outdated', 'tablet', false],
        ['Tina Test', 'confirmed', 'account', true],
      ])
      // A category for Leitung and Träger counts only those who see it (by the role of their account).
      updateKnowledgeCategory(db, leitung, categoryId('Kinderschutz'), { name: 'Kinderschutz', visibility: 'managers' })
      expect(overview(db, leitung, entry, TODAY).people.filter(person => person.expected).map(person => person.name)).toEqual(['Lea Leitung'])
      // Only for knowledge.manage.
      expect(errorCode(() => overview(db, tinaAccount(), entry, TODAY))).toBe('forbidden')
    })

    it('shows a helper\'s confirmation only while their facility is paired and they were planned here within a year', () => {
      const krippe = addFacility(db, 'Krippe')
      const hort = addFacility(db, 'Hort')
      const recent = addEmployee(db, 'Hans Helfer', { facilityId: krippe })
      const longAgo = addEmployee(db, 'Olga Alt', { facilityId: krippe })
      const unpaired = addEmployee(db, 'Udo Hort', { facilityId: hort })
      const planned = (employeeId: number, date: string) =>
        db.insert(entries).values({ employeeId, date, kind: 'shift', helpFacilityId: 1, updatedAt: NOW.toISOString() }).run()
      planned(recent, '2026-02-02')
      planned(longAgo, '2025-11-20')
      planned(unpaired, '2026-11-02')
      for (const employeeId of [recent, longAgo, unpaired]) {
        db.insert(knowledgeConfirmations).values({ entryId: entry, employeeId, entryVersion: 1, confirmedAt: NOW.toISOString(), via: 'account' }).run()
      }
      const helpers = () => overview(db, leitung, entry, TODAY).people.filter(person => !person.expected).map(person => person.name)
      // Without the pair none of them (planned before pairs existed, or never allowed).
      expect(helpers()).toEqual([])
      addHelpoutPair(db, 1, krippe)
      expect(helpers()).toEqual(['Hans Helfer'])
      // Planned again within the year: back in.
      planned(longAgo, '2026-12-01')
      expect(helpers()).toEqual(['Hans Helfer', 'Olga Alt'])
      // The Träger ends the pair: gone again.
      db.delete(facilityHelpoutPairs).run()
      expect(helpers()).toEqual([])
    })

    it('shows an entry for all facilities to each facility with its own staff only', () => {
      const krippe = addFacility(db, 'Krippe')
      const kai = addEmployee(db, 'Kai Krippe', { facilityId: krippe })
      const global = createKnowledgeEntry(db, provider, link(undefined, { scope: 'all', categoryName: 'Kinderschutz', title: 'Leitbild', needsConfirmation: true }), null, NOW)
      confirmWithAccount(db, tinaAccount(), global, 1, NOW)
      confirmWithAccount(db, { ...as('observer', krippe), employeeId: kai }, global, 1, NOW)
      const names = (facilityId: number) => overview(db, as('admin', facilityId), global, TODAY).people.map(person => [person.name, person.state])
      expect(names(1)).toEqual([['Ben Beispiel', 'open'], ['Lea Leitung', 'open'], ['Tina Test', 'confirmed']])
      expect(names(krippe)).toEqual([['Kai Krippe', 'confirmed']])
      expect(overview(db, as('admin', krippe), global, TODAY).facilityName).toBe('Krippe')
    })

    it('refuses a version the reader was not shown, at the tablet before the PIN is looked at', () => {
      updateKnowledgeEntry(db, leitung, entry, link(categoryId('Kinderschutz'), { needsConfirmation: true, url: 'https://www.example.de/v2' }), null, NOW)
      expect(errorCode(() => confirmWithAccount(db, tinaAccount(), entry, 1, NOW))).toBe('knowledge_entry_changed')
      expect(errorCode(() => confirmAtTablet(db, { facilityId: 1 }, entry, 1, ben, '000000', NOW))).toBe('knowledge_entry_changed')
      expect(db.select({ failed: employees.pinFailed }).from(employees).where(eq(employees.id, ben)).get()).toEqual({ failed: 0 })
      expect(db.select().from(knowledgeConfirmations).all()).toEqual([])
      expect(confirmWithAccount(db, tinaAccount(), entry, 2, NOW).version).toBe(2)
    })

    it('confirms an account for its own employee whatever person it names; the tablet needs person and PIN', () => {
      expect(confirmKnowledge(db, tinaAccount(), entry, { version: 1, employeeId: ben, pin: '135790' }, NOW).name).toBe('Tina Test')
      expect(db.select().from(knowledgeConfirmations).all().map(row => [row.employeeId, row.via])).toEqual([[tina, 'account']])
      expect(errorCode(() => confirmKnowledge(db, tablet, entry, { version: 1, employeeId: ben }, NOW))).toBe('invalid_input')
      expect(confirmKnowledge(db, tablet, entry, { version: 1, employeeId: ben, pin: '135790' }, NOW).name).toBe('Ben Beispiel')
    })

    it('locks the PIN after five wrong tries, as at stamping', () => {
      for (let attempt = 1; attempt < 5; attempt++) {
        expect(errorCode(() => confirmAtTablet(db, { facilityId: 1 }, entry, 1, ben, '000000', NOW))).toBe('pin_invalid')
      }
      expect(errorCode(() => confirmAtTablet(db, { facilityId: 1 }, entry, 1, ben, '000000', NOW))).toBe('pin_locked')
      // While locked even the right PIN is refused.
      expect(errorCode(() => confirmAtTablet(db, { facilityId: 1 }, entry, 1, ben, '135790', NOW))).toBe('pin_locked')
      expect(db.select().from(knowledgeConfirmations).all()).toEqual([])
    })

    it('goes with the employee\'s assessment data (Beurteilungen und Zeugnisse) and with the entry', () => {
      confirmWithAccount(db, tinaAccount(), entry, 1, NOW)
      confirmAtTablet(db, { facilityId: 1 }, entry, 1, ben, '135790', NOW)
      // Not with the immediate data: a proof of instruction, kept like the trainings.
      db.transaction(tx => deleteImmediateData(tx, tina))
      expect(db.select().from(knowledgeConfirmations).all()).toHaveLength(2)
      db.transaction(tx => deleteAssessmentData(tx, tina))
      expect(db.select().from(knowledgeConfirmations).all().map(row => row.employeeId)).toEqual([ben])
      deleteKnowledgeEntry(db, leitung, entry)
      expect(db.select().from(knowledgeConfirmations).all()).toEqual([])
    })
  })

  describe('subcategories', () => {
    const tree = (viewer: Parameters<typeof listKnowledge>[1]) => listKnowledge(db, viewer).categories
      .map(category => (category.parentId === null ? category.name : `  ${category.name}`))
    const subId = (parent: string, name: string, facilityId = 1) => db.select().from(knowledgeCategories)
      .where(and(eq(knowledgeCategories.parentId, categoryId(parent, facilityId)), eq(knowledgeCategories.name, name))).get()!.id
    /** Where each entry shows for the viewer: „Kategorie/Unterkategorie“ (or the category alone, „-“ for „Vom Träger“). */
    const spots = (viewer: Parameters<typeof listKnowledge>[1]) => {
      const { categories, entries } = listKnowledge(db, viewer)
      const name = (id: number | null) => categories.find(category => category.id === id)?.name
      return entries.map(entry => [entry.title, entry.categoryId === null ? '-' : [name(entry.categoryId), name(entry.subcategoryId)].filter(Boolean).join('/')])
    }

    it('gives a new facility „Gesetze & Vorgaben“ with „Bund“ (and in Baden-Württemberg „Baden-Württemberg“), the laws filed there', () => {
      expect(tree(leitung).slice(-3)).toEqual(['Gesetze & Vorgaben', '  Bund', '  Baden-Württemberg'])
      expect(spots(leitung).filter(([, spot]) => String(spot).startsWith('Gesetze'))).toEqual([
        ['§ 45 SGB VIII – Erlaubnis für den Betrieb einer Einrichtung', 'Gesetze & Vorgaben/Bund'],
        ['§ 47 SGB VIII – Melde- und Dokumentationspflichten', 'Gesetze & Vorgaben/Bund'],
        ['Kindertagesbetreuungsgesetz Baden-Württemberg (KiTaG)', 'Gesetze & Vorgaben/Baden-Württemberg'],
      ])
      // Every other category starts without subcategories; a facility in Bavaria gets „Bund“ only.
      expect(tree(leitung).filter(name => name.startsWith(' '))).toEqual(['  Bund', '  Baden-Württemberg'])
      const bavaria = createFacility(db, 'Kita München', 'BY', TODAY).id
      expect(tree(as('admin', bavaria)).slice(-2)).toEqual(['Gesetze & Vorgaben', '  Bund'])
      expect(KNOWLEDGE_STARTER_SUBCATEGORIES.map(starter => starter.key)).toEqual(['subcategory:gesetze-bund', 'subcategory:gesetze-bw'])
      // Recorded: a deleted starter subcategory does not come back.
      clearStarters()
      deleteKnowledgeCategory(db, leitung, subId('Gesetze & Vorgaben', 'Bund'))
      expect(seedPendingKnowledgeStarters(db, NOW)).toBe(0)
      expect(tree(leitung).slice(-2)).toEqual(['Gesetze & Vorgaben', '  Baden-Württemberg'])
    })

    it('files a starter link directly in its category when the facility has no such subcategory', () => {
      clearStarters()
      db.delete(knowledgeStarterSeeds).where(eq(knowledgeStarterSeeds.starterKey, 'link:sgb8-45')).run()
      deleteKnowledgeCategory(db, leitung, subId('Gesetze & Vorgaben', 'Bund'))
      seedPendingKnowledgeStarters(db, NOW)
      expect(spots(leitung)).toEqual([['§ 45 SGB VIII – Erlaubnis für den Betrieb einer Einrichtung', 'Gesetze & Vorgaben']])
    })

    it('keeps one level only, names unique per category, and deletes a category only without subcategories', () => {
      clearStarters()
      const hygiene = categoryId('Hygiene & Gesundheit')
      const plaene = createKnowledgeCategory(db, leitung, { name: 'Pläne', visibility: 'all', parentId: hygiene })
      expect(errorCode(() => createKnowledgeCategory(db, leitung, { name: 'Enkel', visibility: 'all', parentId: plaene }))).toBe('knowledge_category_parent_invalid')
      const krippe = addFacility(db, 'Krippe')
      expect(errorCode(() => createKnowledgeCategory(db, as('admin', krippe), { name: 'X', visibility: 'all', parentId: hygiene })))
        .toBe('knowledge_category_parent_invalid')
      expect(errorCode(() => createKnowledgeCategory(db, leitung, { name: ' PLÄNE ', visibility: 'all', parentId: hygiene }))).toBe('knowledge_category_name_taken')
      // The same name under another category (or at the top) is fine.
      createKnowledgeCategory(db, leitung, { name: 'Pläne', visibility: 'all', parentId: categoryId('Kinderschutz') })
      createKnowledgeCategory(db, leitung, { name: 'Bund', visibility: 'all' })
      expect(errorCode(() => createKnowledgeCategory(db, staff, { name: 'Y', visibility: 'all', parentId: hygiene }))).toBe('forbidden')
      createKnowledgeEntry(db, leitung, link(plaene, { title: 'Hygieneplan' }), null, NOW)
      expect(errorCode(() => deleteKnowledgeCategory(db, leitung, hygiene))).toBe('knowledge_category_has_subcategories')
      expect(errorCode(() => deleteKnowledgeCategory(db, leitung, plaene))).toBe('knowledge_category_not_empty')
      const counts = listKnowledge(db, leitung).categories.find(category => category.id === plaene)!
      expect(counts).toMatchObject({ parentId: hygiene, entryCount: 1, ownCount: 1 })
    })

    it('moves a subcategory among those of its category only', () => {
      clearStarters()
      const bw = subId('Gesetze & Vorgaben', 'Baden-Württemberg')
      moveKnowledgeCategory(db, leitung, bw, 'up')
      expect(tree(leitung).slice(-3)).toEqual(['Gesetze & Vorgaben', '  Baden-Württemberg', '  Bund'])
      moveKnowledgeCategory(db, leitung, bw, 'up')
      expect(tree(leitung).slice(-3)).toEqual(['Gesetze & Vorgaben', '  Baden-Württemberg', '  Bund'])
      updateKnowledgeCategory(db, leitung, bw, { name: 'Land', visibility: 'managers' })
      expect(tree(leitung).slice(-3)).toEqual(['Gesetze & Vorgaben', '  Land', '  Bund'])
    })

    it('shows Mitarbeiter and the tablet a subcategory and its entries only when they see it and its category', () => {
      clearStarters()
      const bund = subId('Gesetze & Vorgaben', 'Bund')
      const bw = subId('Gesetze & Vorgaben', 'Baden-Württemberg')
      updateKnowledgeCategory(db, leitung, bw, { name: 'Baden-Württemberg', visibility: 'managers' })
      // Mitarbeiter see that „Gesetze & Vorgaben“ holds a subcategory they do not see, without its name.
      expect(listKnowledge(db, staff).categories.find(category => category.id === categoryId('Gesetze & Vorgaben'))!.hiddenSubcategories).toBe(1)
      expect(listKnowledge(db, leitung).categories.find(category => category.id === categoryId('Gesetze & Vorgaben'))!.hiddenSubcategories).toBe(0)
      createKnowledgeEntry(db, leitung, link(bund, { title: 'Im Bund' }), null, NOW)
      createKnowledgeEntry(db, leitung, link(bw, { title: 'Im Land' }), null, NOW)
      expect(titles(staff)).toEqual(['Im Bund'])
      expect(titles(tablet)).toEqual(['Im Bund'])
      expect(tree(staff)).not.toContain('  Baden-Württemberg')
      expect(titles(leitung)).toEqual(['Im Bund', 'Im Land'])
      // The category for the managers hides its subcategories too, even one visible to all.
      updateKnowledgeCategory(db, leitung, categoryId('Gesetze & Vorgaben'), { name: 'Gesetze & Vorgaben', visibility: 'managers' })
      expect(titles(staff)).toEqual([])
      expect(tree(staff)).not.toContain('  Bund')
      expect(errorCode(() => confirmWithAccount(db, { ...staff, employeeId: 1 }, listKnowledge(db, leitung).entries[0]!.id, 1, NOW)))
        .toBe('knowledge_entry_not_found')
    })

    it('files entries for all facilities by path, in the subcategory, else directly in the category, else under „Vom Träger“', () => {
      clearStarters()
      const global = { scope: 'all' as const, categoryId: undefined }
      createKnowledgeEntry(db, provider, link(undefined, { ...global, title: 'Pfad', categoryName: 'gesetze & vorgaben', subcategoryName: 'BUND' }), null, NOW)
      createKnowledgeEntry(db, provider, link(undefined, { ...global, title: 'Ohne', categoryName: 'Gesetze & Vorgaben' }), null, NOW)
      createKnowledgeEntry(db, provider, link(undefined, { ...global, title: 'Unbekannt', categoryName: 'Gesetze & Vorgaben', subcategoryName: 'EU' }), null, NOW)
      createKnowledgeEntry(db, provider, link(undefined, { ...global, title: 'Fremd', categoryName: 'Qualität', subcategoryName: 'Bund' }), null, NOW)
      createKnowledgeEntry(db, provider, link(undefined, {
        ...global, title: 'Streng', categoryName: 'Gesetze & Vorgaben', subcategoryName: 'Bund', visibility: 'managers',
      }), null, NOW)
      expect(spots(leitung)).toEqual([
        ['Ohne', 'Gesetze & Vorgaben'], ['Unbekannt', 'Gesetze & Vorgaben'], ['Pfad', 'Gesetze & Vorgaben/Bund'],
        ['Streng', 'Gesetze & Vorgaben/Bund'], ['Fremd', '-'],
      ])
      expect(titles(staff)).toEqual(['Ohne', 'Unbekannt', 'Pfad', 'Fremd'])
      expect(listKnowledge(db, provider).entries.find(entry => entry.title === 'Pfad'))
        .toMatchObject({ globalCategoryName: 'gesetze & vorgaben', globalSubcategoryName: 'BUND' })
      expect(globalKnowledgeCategoryNames(db, provider).find(entry => entry.name === 'Gesetze & Vorgaben'))
        .toEqual({ name: 'Gesetze & Vorgaben', subcategories: ['Baden-Württemberg', 'Bund', 'EU'] })
      // The category path in the overview of who confirmed.
      const pfad = listKnowledge(db, provider).entries.find(entry => entry.title === 'Pfad')!.id
      updateKnowledgeEntry(db, provider, pfad, link(undefined, {
        title: 'Pfad', categoryName: 'Gesetze & Vorgaben', subcategoryName: 'Bund', needsConfirmation: true,
      }), null, NOW)
      expect(overview(db, leitung, pfad, TODAY).entry.category).toBe('Gesetze & Vorgaben › Bund')
    })

    it('orders the own entries within a subcategory; one moved to another subcategory goes to the end there', () => {
      clearStarters()
      const bund = subId('Gesetze & Vorgaben', 'Bund')
      const bw = subId('Gesetze & Vorgaben', 'Baden-Württemberg')
      const a = createKnowledgeEntry(db, leitung, link(bund, { title: 'A' }), null, NOW)
      createKnowledgeEntry(db, leitung, link(bund, { title: 'B' }), null, NOW)
      createKnowledgeEntry(db, leitung, link(bw, { title: 'Land' }), null, NOW)
      createKnowledgeEntry(db, leitung, link(categoryId('Gesetze & Vorgaben'), { title: 'Direkt' }), null, NOW)
      orderKnowledgeEntries(db, leitung, bund, [listKnowledge(db, leitung).entries.find(entry => entry.title === 'B')!.id, a])
      expect(titles(leitung)).toEqual(['Direkt', 'B', 'A', 'Land'])
      // A list is one subcategory: the entries directly in the category or in another subcategory do not belong to it.
      expect(errorCode(() => orderKnowledgeEntries(db, leitung, bund, [a]))).toBe('invalid_order')
      updateKnowledgeEntry(db, leitung, a, link(bw, { title: 'A' }), null, NOW)
      expect(titles(leitung)).toEqual(['Direkt', 'B', 'Land', 'A'])
      expect(listKnowledge(db, leitung).entries.find(entry => entry.id === a)).toMatchObject({ categoryId: categoryId('Gesetze & Vorgaben'), subcategoryId: bw })
    })
  })
})
