import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { knowledgeCategories, knowledgeConfirmations, knowledgeEntries, knowledgeStarterSeeds } from '../../server/db/schema'
import { deleteImmediateData } from '../../server/services/employeeDeletion'
import { createFacility } from '../../server/services/facilities'
import {
  confirmAtTablet, confirmWithAccount, createKnowledgeCategory, createKnowledgeEntry, deleteKnowledgeCategory, deleteKnowledgeEntry,
  globalKnowledgeCategoryNames, confirmationOverview as overview, listKnowledge, moveKnowledgeCategory, moveKnowledgeEntry,
  openKnowledgeCount, readKnowledgeFile, seedPendingKnowledgeStarters, updateKnowledgeCategory, updateKnowledgeEntry,
} from '../../server/services/knowledge'
import { setPin } from '../../server/services/terminal'
import { KNOWLEDGE_STARTER_CATEGORIES, KNOWLEDGE_STARTER_LINKS } from '../../shared/domain/knowledge'
import type { PermissionKey } from '../../shared/domain/permissions'
import type { KnowledgeEntryInput, Role } from '../../shared/types/api'
import { addEmployee, addFacility, addUser, createTestDb, errorCode, permissionsOf } from '../helpers/fixtures'

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
  const categoryNames = (viewer: Parameters<typeof listKnowledge>[1]) => listKnowledge(db, viewer).categories.map(category => category.name)
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
      expect(globalKnowledgeCategoryNames(db, provider)).toContain('Qualität')
      expect(errorCode(() => globalKnowledgeCategoryNames(db, leitung))).toBe('forbidden')
    })

    it('keeps each facility to its own entries and categories', () => {
      const krippe = addFacility(db, 'Krippe')
      const other = createKnowledgeEntry(db, as('admin', krippe), link(categoryId('Hygiene & Gesundheit', krippe), { title: 'Krippe' }), null, NOW)
      expect(titles(leitung)).not.toContain('Krippe')
      expect(errorCode(() => updateKnowledgeEntry(db, leitung, other, link(categoryId('Hygiene & Gesundheit')), null, NOW))).toBe('knowledge_entry_not_found')
      expect(errorCode(() => deleteKnowledgeEntry(db, leitung, other))).toBe('knowledge_entry_not_found')
      expect(errorCode(() => confirmWithAccount(db, { ...staff, employeeId: addEmployee(db, 'Tina') }, other, NOW))).toBe('knowledge_entry_not_found')
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

    it('stores PDFs only, up to 10 MB, judged by their first bytes', () => {
      const hygiene = categoryId('Hygiene & Gesundheit')
      const file = (data: Buffer) => () => createKnowledgeEntry(db, leitung, { ...link(hygiene), kind: 'file', url: '' }, { data }, NOW)
      expect(errorCode(file(PNG))).toBe('knowledge_file_type_invalid')
      expect(errorCode(file(Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)])))).toBe('document_too_large')
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

    it('orders the facility\'s own entries with ▲/▼, the Träger\'s entries after them by title', () => {
      const hygiene = categoryId('Hygiene & Gesundheit')
      const a = createKnowledgeEntry(db, leitung, link(hygiene, { title: 'A' }), null, NOW)
      const b = createKnowledgeEntry(db, leitung, link(hygiene, { title: 'B' }), null, NOW)
      const c = createKnowledgeEntry(db, leitung, link(hygiene, { title: 'C' }), null, NOW)
      const global = createKnowledgeEntry(db, provider, link(undefined, { scope: 'all', categoryName: 'Hygiene & Gesundheit', title: '0 Träger' }), null, NOW)
      moveKnowledgeEntry(db, leitung, c, 'up')
      moveKnowledgeEntry(db, leitung, a, 'up')
      expect(titles(staff)).toEqual(['A', 'C', 'B', '0 Träger'])
      moveKnowledgeEntry(db, leitung, b, 'down')
      expect(titles(staff)).toEqual(['A', 'C', 'B', '0 Träger'])
      expect(errorCode(() => moveKnowledgeEntry(db, provider, global, 'up'))).toBe('knowledge_entry_not_movable')
      // A new entry goes to the end of the facility's own ones.
      createKnowledgeEntry(db, leitung, link(hygiene, { title: 'D' }), null, NOW)
      expect(titles(staff)).toEqual(['A', 'C', 'B', 'D', '0 Träger'])
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
      expect(confirmWithAccount(db, tinaAccount(), entry, NOW)).toEqual({ name: 'Tina Test', confirmedAt: NOW.toISOString(), version: 1 })
      expect(listKnowledge(db, tinaAccount())).toMatchObject({ openCount: 0 })
      expect(openKnowledgeCount(db, tinaAccount())).toBe(0)
      expect(listKnowledge(db, tinaAccount()).entries[0]!.myConfirmation).toEqual({ state: 'confirmed', confirmedAt: NOW.toISOString() })
      // Without a linked employee there is nobody to confirm for.
      expect(listKnowledge(db, staff).entries[0]!.myConfirmation).toBeNull()
      expect(errorCode(() => confirmWithAccount(db, staff, entry, NOW))).toBe('knowledge_no_employee')
      expect(errorCode(() => confirmWithAccount(db, tablet, entry, NOW))).toBe('knowledge_no_employee')
      // An entry that asks nobody cannot be confirmed.
      const plain = createKnowledgeEntry(db, leitung, link(categoryId('Kinderschutz'), { title: 'Ohne' }), null, NOW)
      expect(errorCode(() => confirmWithAccount(db, tinaAccount(), plain, NOW))).toBe('knowledge_confirmation_not_needed')
      expect(listKnowledge(db, tinaAccount()).entries.find(item => item.id === plain)!.myConfirmation!.state).toBe('none')
    })

    it('lets the person at the tablet confirm for themselves with the PIN', () => {
      expect(listKnowledge(db, tablet)).toMatchObject({ confirmVia: 'tablet', openCount: 0 })
      expect(errorCode(() => confirmAtTablet(db, { facilityId: 1 }, entry, ben, '000000', NOW))).toBe('pin_invalid')
      // Tina has no PIN, so she is not on the tablet's list (no attempt counted).
      expect(errorCode(() => confirmAtTablet(db, { facilityId: 1 }, entry, tina, '135790', NOW))).toBe('employee_not_found')
      expect(confirmAtTablet(db, { facilityId: 1 }, entry, ben, '135790', NOW)).toMatchObject({ name: 'Ben Beispiel', version: 1 })
      expect(db.select().from(knowledgeConfirmations).all()).toEqual([
        { entryId: entry, employeeId: ben, entryVersion: 1, confirmedAt: NOW.toISOString(), via: 'tablet' },
      ])
      // The tablet only shows entries visible to all.
      const managers = createKnowledgeCategory(db, leitung, { name: 'Leitung', visibility: 'managers' })
      const hidden = createKnowledgeEntry(db, leitung, link(managers, { needsConfirmation: true }), null, NOW)
      expect(errorCode(() => confirmAtTablet(db, { facilityId: 1 }, hidden, ben, '135790', NOW))).toBe('knowledge_entry_not_found')
    })

    it('asks again after a change of the content, keeping the earlier confirmation as „frühere Fassung“', () => {
      confirmWithAccount(db, tinaAccount(), entry, NOW)
      const input = link(categoryId('Kinderschutz'), { title: 'Kinderschutzkonzept 2027', needsConfirmation: true, asOf: '2026-12-01' })
      // Title and „Stand vom“ alone: no new version.
      updateKnowledgeEntry(db, leitung, entry, input, null, NOW)
      expect(listKnowledge(db, tinaAccount()).entries[0]).toMatchObject({ version: 1, myConfirmation: { state: 'confirmed' } })
      updateKnowledgeEntry(db, leitung, entry, { ...input, url: 'https://www.example.de/neu' }, null, NOW)
      expect(listKnowledge(db, tinaAccount()).entries[0]).toMatchObject({
        version: 2, myConfirmation: { state: 'outdated', confirmedAt: NOW.toISOString() },
      })
      expect(listKnowledge(db, tinaAccount()).openCount).toBe(1)
      const later = new Date('2026-11-24T08:00:00.000Z')
      confirmWithAccount(db, tinaAccount(), entry, later)
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
      for (const employeeId of [left, helper]) {
        db.insert(knowledgeConfirmations).values({ entryId: entry, employeeId, entryVersion: 1, confirmedAt: NOW.toISOString(), via: 'tablet' }).run()
      }
      confirmWithAccount(db, tinaAccount(), entry, NOW)
      confirmAtTablet(db, { facilityId: 1 }, entry, ben, '135790', NOW)
      updateKnowledgeEntry(db, leitung, entry, link(categoryId('Kinderschutz'), { needsConfirmation: true, url: 'https://www.example.de/v2' }), null, NOW)
      confirmWithAccount(db, tinaAccount(), entry, NOW)
      const result = overview(db, leitung, entry, TODAY)
      expect(result.entry).toMatchObject({ id: entry, version: 2, category: 'Kinderschutz' })
      expect(result.people.map(person => [person.name, person.state, person.via, person.expected])).toEqual([
        ['Lea Leitung', 'open', null, true],
        ['Alma Alt', 'outdated', 'tablet', false],
        ['Ben Beispiel', 'outdated', 'tablet', true],
        ['Tina Test', 'confirmed', 'account', true],
      ])
      // A category for Leitung and Träger counts only those who see it (by the role of their account).
      updateKnowledgeCategory(db, leitung, categoryId('Kinderschutz'), { name: 'Kinderschutz', visibility: 'managers' })
      expect(overview(db, leitung, entry, TODAY).people.filter(person => person.expected).map(person => person.name)).toEqual(['Lea Leitung'])
      // Only for knowledge.manage.
      expect(errorCode(() => overview(db, tinaAccount(), entry, TODAY))).toBe('forbidden')
    })

    it('goes with the employee\'s immediate data and with the entry', () => {
      confirmWithAccount(db, tinaAccount(), entry, NOW)
      confirmAtTablet(db, { facilityId: 1 }, entry, ben, '135790', NOW)
      db.transaction(tx => deleteImmediateData(tx, tina))
      expect(db.select().from(knowledgeConfirmations).all().map(row => row.employeeId)).toEqual([ben])
      deleteKnowledgeEntry(db, leitung, entry)
      expect(db.select().from(knowledgeConfirmations).all()).toEqual([])
    })
  })
})
