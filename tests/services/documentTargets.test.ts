import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { and, eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import {
  entries, facilities, knowledgeCategories, knowledgeConfirmations, knowledgeEntries, knowledgeEntryTargets, printTemplateOrder, printTemplateTargets,
  printTemplates, templateCategories,
} from '../../server/db/schema'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { readerHomeGroup, targetOptions } from '../../server/services/documentTargets'
import { deleteGroup } from '../../server/services/groups'
import {
  confirmAtTablet, confirmWithAccount, confirmationOverview, createKnowledgeEntry, deleteKnowledgeEntry, listKnowledge, openKnowledgeCount,
  readKnowledgeFile, updateKnowledgeEntry,
} from '../../server/services/knowledge'
import { listTemplates, readTemplateFile, updateTemplate, uploadTemplate, type TemplateActor } from '../../server/services/printTemplates'
import { unlockChildren } from '../../server/services/tabletUnlock'
import { listCategories } from '../../server/services/templateCategories'
import { setPin } from '../../server/services/terminal'
import type { PermissionKey } from '../../shared/domain/permissions'
import type { DocumentGroupTarget, DocumentScope, KnowledgeEntryInput, Role } from '../../shared/types/api'
import { addEmployee, addFacility, addGroup, addUser, createTestDb, errorCode, permissionsOf } from '../helpers/fixtures'

const NOW = new Date('2026-11-23T09:00:00.000Z')
const TODAY = '2026-11-23'
const PDF = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')

/**
 * „Gilt für“ of Vorlagen and „Wissen“: facilities and groups (shared/domain/documentTargets.ts), with the visibility
 * matrix for both kinds of items.
 */
describe('„Gilt für“: facilities and groups of Vorlagen and „Wissen“', () => {
  let db: Db
  let krippe: number
  let baeren: number
  let fuechse: number
  let eulen: number
  let maeuse: number
  let inBaeren: number
  let inFuechse: number
  let noGroup: number
  let helper: number
  let templateCategory: number
  let knowledgeCategory: number

  /** A viewer of the role in the facility (default permissions), with a home group. */
  const as = (role: Role, homeGroupId: number | null = null, facilityId = 1, employeeId: number | null = null) =>
    ({ id: 1, role, permissions: role === 'terminal' ? new Set<PermissionKey>() : permissionsOf(role), facilityId, homeGroupId, employeeId })
  const provider = (facilityId = 1) => as('provider', null, facilityId)
  const leitung = (facilityId = 1) => as('admin', null, facilityId)
  /** The audiences of the matrix in facility 1. */
  const matrix = () => ({
    'Mitarbeiter Bären': as('observer', baeren),
    'Mitarbeiter Füchse': as('observer', fuechse),
    'ohne Stammgruppe': as('observer', null),
    'Aushilfe (Mäuse, Krippe)': as('observer', maeuse),
    'Leitung': leitung(),
    'Träger': provider(),
    'Tablet gesperrt': as('terminal', null),
    'Tablet entsperrt (Bären)': as('terminal', baeren),
    // Decision: a Gruppenleitung counts like Mitarbeiter (only the home group, no bypass).
    'Gruppenleitung Füchse': as('group_lead', fuechse),
    'Gruppenleitung Bären': as('group_lead', baeren),
  })
  const SEES_LIMITED = ['Mitarbeiter Bären', 'Leitung', 'Träger', 'Tablet entsperrt (Bären)', 'Gruppenleitung Bären']

  beforeEach(() => {
    db = createTestDb()
    addUser(db, 'traeger', 'provider')
    krippe = addFacility(db, 'Krippe')
    baeren = addGroup(db, 1, 'Bären')
    fuechse = addGroup(db, 1, 'Füchse')
    eulen = addGroup(db, 1, 'Eulen')
    maeuse = addGroup(db, krippe, 'Mäuse')
    inBaeren = addEmployee(db, 'Bea Bär', { groupId: baeren })
    inFuechse = addEmployee(db, 'Finn Fuchs', { groupId: fuechse })
    noGroup = addEmployee(db, 'Nora Ohne')
    helper = addEmployee(db, 'Hilde Hilfe', { facilityId: krippe, groupId: maeuse })
    db.delete(knowledgeEntries).run()
    templateCategory = db.select().from(templateCategories).where(and(eq(templateCategories.facilityId, 1), eq(templateCategories.name, 'Eltern'))).get()!.id
    knowledgeCategory = db.select().from(knowledgeCategories)
      .where(and(eq(knowledgeCategories.facilityId, 1), eq(knowledgeCategories.name, 'Kinderschutz'))).get()!.id
  })

  const actor = (viewer: ReturnType<typeof as>): TemplateActor => viewer
  /** A template of the actor's facility (default) or of the Träger, with „Gilt für“. */
  const template = (
    by: ReturnType<typeof as>, title: string,
    options: { scope?: DocumentScope; facilityIds?: number[]; groupTargets?: DocumentGroupTarget[]; categoryName?: string } = {},
  ) => uploadTemplate(db, actor(by), {
    title, scope: options.scope ?? 'facility', categoryId: options.scope && options.scope !== 'facility' ? undefined : templateCategory,
    categoryName: options.categoryName ?? 'Eltern', facilityIds: options.facilityIds, groupTargets: options.groupTargets,
  }, { data: PDF, filename: 'x.pdf' }, NOW)
  const templateTitles = (viewer: ReturnType<typeof as>) => listTemplates(db, viewer).map(item => item.title)
  /** A text entry (with confirmation) of the actor's facility (default) or of the Träger, with „Gilt für“. */
  const entry = (by: ReturnType<typeof as>, title: string, extra: Partial<KnowledgeEntryInput> = {}) => createKnowledgeEntry(db, { ...by, id: 1 }, {
    kind: 'text', title, description: '', asOf: '', url: '', body: '<p>Geheimer Text</p>', needsConfirmation: true,
    categoryId: extra.scope && extra.scope !== 'facility' ? undefined : knowledgeCategory, categoryName: 'Kinderschutz', ...extra,
  }, null, NOW)
  const entryTitles = (viewer: ReturnType<typeof as>) => listKnowledge(db, viewer).entries.map(item => item.title)

  describe('the visibility matrix', () => {
    it('shows a Vorlage limited to Bären only to the Bären, Leitung, Träger and the tablet unlocked by a Bär – list and file', () => {
      const limited = template(leitung(), 'Nur Bären', { groupTargets: [{ facilityId: 1, groupIds: [baeren] }] })
      template(leitung(), 'Für alle Gruppen')
      for (const [who, viewer] of Object.entries(matrix())) {
        const sees = SEES_LIMITED.includes(who)
        expect(templateTitles(viewer), who).toEqual(sees ? ['Nur Bären', 'Für alle Gruppen'] : ['Für alle Gruppen'])
        if (sees) expect(readTemplateFile(db, viewer, limited).fileName, who).toBe('Nur-Baeren.pdf')
        else expect(errorCode(() => readTemplateFile(db, viewer, limited)), who).toBe('print_template_not_found')
      }
    })

    it('shows an entry of „Wissen“ limited to Bären the same way – list (with the text), file and confirmation', () => {
      const limited = entry(leitung(), 'Nur Bären', { groupTargets: [{ facilityId: 1, groupIds: [baeren] }] })
      const file = createKnowledgeEntry(db, { ...leitung(), id: 1 }, {
        kind: 'file', title: 'PDF Bären', description: '', asOf: '', url: '', body: '', needsConfirmation: false, categoryId: knowledgeCategory,
        scope: 'facility', groupTargets: [{ facilityId: 1, groupIds: [baeren] }],
      }, { data: PDF }, NOW)
      createKnowledgeEntry(db, { ...leitung(), id: 1 }, {
        kind: 'link', title: 'Link Bären', description: '', asOf: '', url: 'https://www.example.de/baeren', body: '', needsConfirmation: false,
        categoryId: knowledgeCategory, scope: 'facility', groupTargets: [{ facilityId: 1, groupIds: [baeren] }],
      }, null, NOW)
      entry(leitung(), 'Für alle Gruppen')
      for (const [who, viewer] of Object.entries(matrix())) {
        const sees = SEES_LIMITED.includes(who)
        expect(entryTitles(viewer), who).toEqual(sees ? ['Nur Bären', 'PDF Bären', 'Link Bären', 'Für alle Gruppen'] : ['Für alle Gruppen'])
        expect(listKnowledge(db, viewer).entries.some(item => item.url.includes('baeren')), who).toBe(sees)
        const bodies = listKnowledge(db, viewer).entries.map(item => item.body)
        expect(bodies.filter(body => body.includes('Geheimer')).length, who).toBe(sees ? 2 : 1)
        if (sees) expect(readKnowledgeFile(db, viewer, file).fileName, who).toBe('PDF-Baeren.pdf')
        else expect(errorCode(() => readKnowledgeFile(db, viewer, file)), who).toBe('knowledge_entry_not_found')
      }
      // Confirming: a Fuchs with the own account cannot, a Bär can.
      expect(errorCode(() => confirmWithAccount(db, { ...as('observer', fuechse), employeeId: inFuechse }, limited, 1, NOW))).toBe('knowledge_entry_not_found')
      expect(confirmWithAccount(db, { ...as('observer', baeren), employeeId: inBaeren }, limited, 1, NOW).name).toBe('Bea Bär')
      // At the tablet the person who confirms counts: a clear answer for those outside the groups, the Bär confirms.
      setPin(db, 1, inFuechse, '135790')
      setPin(db, 1, noGroup, '246801')
      setPin(db, 1, inBaeren, '112233')
      expect(errorCode(() => confirmAtTablet(db, { facilityId: 1 }, limited, 1, inFuechse, '135790', NOW))).toBe('knowledge_not_for_person')
      expect(errorCode(() => confirmAtTablet(db, { facilityId: 1 }, limited, 1, noGroup, '246801', NOW))).toBe('knowledge_not_for_person')
      expect(confirmAtTablet(db, { facilityId: 1 }, limited, 1, inBaeren, '112233', NOW)).toMatchObject({ name: 'Bea Bär', version: 1 })
      expect(errorCode(() => confirmAtTablet(db, { facilityId: 1 }, 9999, 1, inBaeren, '112233', NOW))).toBe('knowledge_entry_not_found')
    })

    it('takes the tablet\'s home group from the person who unlocked it, none while locked; an account from its employee', () => {
      setTimeTrackingFrom(db, 1, '2026-10-01')
      const tablet = addUser(db, 'tablet', 'terminal')
      setPin(db, 1, inBaeren, '123456')
      expect(readerHomeGroup(db, tablet, undefined, NOW)).toBeNull()
      const { token } = unlockChildren(db, { id: tablet.id, facilityId: 1 }, inBaeren, '123456', NOW)
      expect(readerHomeGroup(db, tablet, token, NOW)).toBe(baeren)
      expect(readerHomeGroup(db, tablet, 'falsch', NOW)).toBeNull()
      const account = addUser(db, 'finn', 'observer', inFuechse)
      expect(readerHomeGroup(db, account, undefined, NOW)).toBe(fuechse)
      expect(readerHomeGroup(db, addUser(db, 'nora', 'observer', noGroup), undefined, NOW)).toBeNull()
    })

    it('applies the item\'s own visibility to a facility\'s own item as well (the stricter of item and category)', () => {
      const id = template(leitung(), 'Leitung intern')
      updateTemplate(db, actor(leitung()), id, { title: 'Leitung intern', categoryId: templateCategory, visibility: 'managers' }, NOW)
      expect(templateTitles(as('observer', baeren))).toEqual([])
      expect(templateTitles(leitung())).toEqual(['Leitung intern'])
      expect(errorCode(() => updateTemplate(db, actor(leitung()), id, { title: 'X', categoryId: templateCategory, visibility: 'provider' }, NOW))).toBe('forbidden')
    })
  })

  describe('facilities', () => {
    it('shows an item of the Träger only in the facilities chosen, or in all (also a new one)', () => {
      template(provider(), 'Nur Krippe', { scope: 'selected', facilityIds: [krippe] })
      template(provider(), 'Überall', { scope: 'all' })
      entry(provider(), 'Wissen Krippe', { scope: 'selected', facilityIds: [krippe] })
      expect(templateTitles(provider())).toEqual(['Überall'])
      expect(templateTitles(provider(krippe))).toEqual(['Nur Krippe', 'Überall'])
      expect(entryTitles(provider())).toEqual([])
      expect(entryTitles(as('observer', maeuse, krippe))).toEqual(['Wissen Krippe'])
      const neu = addFacility(db, 'Neue Kita')
      expect(templateTitles(provider(neu))).toEqual(['Überall'])
      // The hints for Leitung and Träger.
      const krippeTemplate = listTemplates(db, leitung(krippe)).find(item => item.title === 'Nur Krippe')!
      expect(krippeTemplate.targets).toMatchObject({ scope: 'selected', facilityIds: [krippe], facilityNames: ['Krippe'], groupNames: null })
      expect(listTemplates(db, as('observer', maeuse, krippe))[0]!.targets).toBeNull()
    })

    it('limits groups per facility: an item for all facilities can be for Bären in facility 1 and for all groups elsewhere', () => {
      template(provider(), 'Bären hier, alle dort', { scope: 'all', groupTargets: [{ facilityId: 1, groupIds: [baeren] }] })
      expect(templateTitles(as('observer', fuechse))).toEqual([])
      expect(templateTitles(as('observer', baeren))).toEqual(['Bären hier, alle dort'])
      expect(templateTitles(as('observer', maeuse, krippe))).toEqual(['Bären hier, alle dort'])
      expect(listTemplates(db, leitung()).at(0)!.targets).toMatchObject({ scope: 'all', groupNames: ['Bären'] })
    })

    it('counts the Träger\'s templates in a category only where they are for the facility', () => {
      template(provider(), 'Nur Krippe', { scope: 'selected', facilityIds: [krippe] })
      template(provider(), 'Überall', { scope: 'all' })
      expect(listCategories(db, leitung()).find(category => category.id === templateCategory)!.globalCount).toBe(1)
    })
  })

  describe('rules', () => {
    it('leaves facilities beyond the own one to the Träger; facilities and groups must exist and fit', () => {
      expect(errorCode(() => template(leitung(), 'X', { scope: 'all' }))).toBe('forbidden')
      expect(errorCode(() => template(leitung(), 'X', { scope: 'selected', facilityIds: [1] }))).toBe('forbidden')
      expect(errorCode(() => entry(leitung(), 'X', { scope: 'all' }))).toBe('forbidden')
      for (const groupTargets of [
        [{ facilityId: krippe, groupIds: [maeuse] }], // a facility not in the scope
        [{ facilityId: 1, groupIds: [maeuse] }], // another facility's group
        [{ facilityId: 1, groupIds: [] }], // no group
        [{ facilityId: 1, groupIds: [9999] }],
      ]) {
        expect(errorCode(() => template(leitung(), 'X', { groupTargets })), JSON.stringify(groupTargets)).toBe('document_targets_invalid')
      }
      for (const facilityIds of [[], [9999], [krippe, krippe]]) {
        expect(errorCode(() => template(provider(), 'X', { scope: 'selected', facilityIds })), JSON.stringify(facilityIds)).toBe('document_targets_invalid')
      }
      expect(errorCode(() => template(provider(), 'X', { scope: 'selected', facilityIds: [1], groupTargets: [{ facilityId: krippe, groupIds: [maeuse] }] })))
        .toBe('document_targets_invalid')
    })

    it('offers the Träger every facility with its groups, everyone else the own facility', () => {
      expect(targetOptions(db, 1, true).facilities.map(facility => [facility.name, facility.groups.map(group => group.name)]))
        .toEqual(expect.arrayContaining([['Krippe', ['Mäuse']]]))
      expect(targetOptions(db, 1, false).facilities.map(facility => facility.id)).toEqual([1])
      expect(targetOptions(db, 1, false).facilities[0]!.groups.map(group => group.name)).toEqual(expect.arrayContaining(['Bären', 'Füchse', 'Eulen']))
    })
  })

  describe('changing „Gilt für“ afterwards', () => {
    it('lets the Leitung change the groups of the own item; the facility stays and the Träger alone widens it', () => {
      const id = template(leitung(), 'Brief')
      updateTemplate(db, actor(leitung()), id, { title: 'Brief', categoryId: templateCategory, scope: 'facility', groupTargets: [{ facilityId: 1, groupIds: [fuechse] }] }, NOW)
      expect(templateTitles(as('observer', baeren))).toEqual([])
      expect(templateTitles(as('observer', fuechse))).toEqual(['Brief'])
      expect(errorCode(() => updateTemplate(db, actor(leitung()), id, { title: 'Brief', scope: 'all', categoryName: 'Eltern' }, NOW))).toBe('forbidden')
      // Without a scope it stays as it is.
      updateTemplate(db, actor(leitung()), id, { title: 'Brief neu', categoryId: templateCategory }, NOW)
      expect(templateTitles(as('observer', fuechse))).toEqual(['Brief neu'])
    })

    it('moves a template between facilities: own → chosen facilities (by name) and back; order at the end, lost places forgotten', () => {
      const id = template(leitung(), 'Wandert')
      const other = template(provider(), 'Schon in der Krippe', { scope: 'selected', facilityIds: [krippe] })
      updateTemplate(db, actor(provider()), id, { title: 'Wandert', scope: 'selected', facilityIds: [krippe], categoryName: 'Eltern' }, NOW)
      expect(templateTitles(provider())).toEqual([])
      expect(templateTitles(provider(krippe))).toEqual(['Schon in der Krippe', 'Wandert'])
      expect(db.select().from(printTemplates).where(eq(printTemplates.id, id)).get()).toMatchObject({ facilityId: null, categoryId: null, categoryName: 'Eltern' })
      const orderIn = (facilityId: number) => db.select({ templateId: printTemplateOrder.templateId }).from(printTemplateOrder)
        .where(eq(printTemplateOrder.facilityId, facilityId)).orderBy(printTemplateOrder.sortOrder).all().map(row => row.templateId)
      expect(orderIn(1)).not.toContain(id)
      expect(orderIn(krippe)).toEqual([other, id])
      // To all facilities, then back to facility 1's own (a category of it).
      // Changed where it shows: in the Krippe now.
      updateTemplate(db, actor(provider(krippe)), id, { title: 'Wandert', scope: 'all', categoryName: 'Eltern' }, NOW)
      expect(templateTitles(provider())).toEqual(['Wandert'])
      updateTemplate(db, actor(provider()), id, { title: 'Wandert', scope: 'facility', categoryId: templateCategory }, NOW)
      expect(templateTitles(provider(krippe))).toEqual(['Schon in der Krippe'])
      expect(orderIn(krippe)).toEqual([other])
      expect(db.select().from(printTemplates).where(eq(printTemplates.id, id)).get()).toMatchObject({ facilityId: 1, categoryId: templateCategory })
    })

    it('keeps confirmations and the version when „Gilt für“ changes; those out of scope are no longer expected', () => {
      const id = entry(leitung(), 'Konzept')
      confirmWithAccount(db, { ...as('observer', fuechse), employeeId: inFuechse }, id, 1, NOW)
      const expected = () => confirmationOverview(db, { ...leitung(), id: 1 }, id, TODAY).people
        .map(person => [person.name, person.state, person.expected])
      expect(expected()).toEqual(expect.arrayContaining([['Bea Bär', 'open', true], ['Finn Fuchs', 'confirmed', true], ['Nora Ohne', 'open', true]]))
      updateKnowledgeEntry(db, { ...leitung(), id: 1 }, id, {
        kind: 'text', title: 'Konzept', description: '', asOf: '', url: '', body: '<p>Geheimer Text</p>', needsConfirmation: true,
        categoryId: knowledgeCategory, scope: 'facility', groupTargets: [{ facilityId: 1, groupIds: [baeren] }],
      }, null, NOW)
      expect(db.select({ version: knowledgeEntries.version }).from(knowledgeEntries).where(eq(knowledgeEntries.id, id)).get()!.version).toBe(1)
      expect(db.select().from(knowledgeConfirmations).all()).toHaveLength(1)
      const people = expected()
      expect(people).toEqual(expect.arrayContaining([['Bea Bär', 'open', true], ['Finn Fuchs', 'confirmed', false]]))
      expect(people.map(([name]) => name)).not.toContain('Nora Ohne')
      expect(people.map(([name]) => name)).not.toContain('Hilde Hilfe')
    })
  })

  describe('a group deleted', () => {
    it('drops the group from „Gilt für“; with none left only Leitung and Träger see the item, with the hint', () => {
      const id = template(leitung(), 'Eulen-Brief', { groupTargets: [{ facilityId: 1, groupIds: [eulen] }] })
      entry(leitung(), 'Eulen-Wissen', { groupTargets: [{ facilityId: 1, groupIds: [eulen, baeren] }] })
      deleteGroup(db, 1, eulen, TODAY)
      expect(templateTitles(as('observer', baeren))).toEqual([])
      expect(templateTitles(leitung())).toEqual(['Eulen-Brief'])
      expect(listTemplates(db, leitung()).find(item => item.id === id)!.targets).toMatchObject({ groupNames: [] })
      // The entry still has the Bären.
      expect(entryTitles(as('observer', baeren))).toEqual(['Eulen-Wissen'])
      expect(listKnowledge(db, leitung()).entries[0]!.targets).toMatchObject({ groupNames: ['Bären'] })
    })
  })

  describe('review round 1', () => {
    it('counts the open confirmations of an entry limited to groups only for those it is for (the menu badge)', () => {
      entry(leitung(), 'Nur Bären', { groupTargets: [{ facilityId: 1, groupIds: [baeren] }] })
      expect(openKnowledgeCount(db, { ...as('observer', baeren), employeeId: inBaeren })).toBe(1)
      expect(openKnowledgeCount(db, { ...as('observer', fuechse), employeeId: inFuechse })).toBe(0)
    })

    it('limits groups per facility for entries of several facilities too, and keeps other facilities\' names out of the overview', () => {
      const krippeLeitung = { ...leitung(krippe), id: 1 }
      const both = entry(provider(), 'Für beide', {
        scope: 'selected', facilityIds: [1, krippe], groupTargets: [{ facilityId: krippe, groupIds: [maeuse] }],
      })
      expect(entryTitles(as('observer', fuechse))).toEqual(['Für beide'])
      expect(entryTitles(as('observer', null, krippe))).toEqual([])
      expect(entryTitles(as('observer', maeuse, krippe))).toEqual(['Für beide'])
      // Hilde (Krippe) confirms; then the Träger makes it facility 1's own entry: her name stays out of facility 1's overview.
      confirmWithAccount(db, { ...as('observer', maeuse, krippe), employeeId: helper }, both, 1, NOW)
      expect(confirmationOverview(db, krippeLeitung, both, TODAY).people.map(person => person.name)).toContain('Hilde Hilfe')
      updateKnowledgeEntry(db, { ...provider(), id: 1 }, both, {
        kind: 'text', title: 'Für beide', description: '', asOf: '', url: '', body: '<p>Geheimer Text</p>', needsConfirmation: true,
        categoryId: knowledgeCategory, scope: 'facility',
      }, null, NOW)
      expect(db.select().from(knowledgeEntries).where(eq(knowledgeEntries.id, both)).get()).toMatchObject({ facilityId: 1, allFacilities: false })
      expect(entryTitles(as('observer', maeuse, krippe))).toEqual([])
      const names = confirmationOverview(db, { ...leitung(), id: 1 }, both, TODAY).people.map(person => person.name)
      expect(names).not.toContain('Hilde Hilfe')
      expect(db.select().from(knowledgeConfirmations).all()).toHaveLength(1)
      // And back to the chosen facilities, filed by name.
      updateKnowledgeEntry(db, { ...provider(), id: 1 }, both, {
        kind: 'text', title: 'Für beide', description: '', asOf: '', url: '', body: '<p>Geheimer Text</p>', needsConfirmation: true,
        categoryName: 'Kinderschutz', scope: 'selected', facilityIds: [krippe],
      }, null, NOW)
      expect(entryTitles(provider())).toEqual([])
      expect(entryTitles(as('observer', maeuse, krippe))).toEqual(['Für beide'])
    })

    it('keeps the Träger\'s items away from the Leitung (403) and gives the Leitung only its own facility\'s part of „Gilt für“', () => {
      const id = template(provider(), 'Träger-Vorlage', {
        scope: 'selected', facilityIds: [1, krippe], groupTargets: [{ facilityId: krippe, groupIds: [maeuse] }, { facilityId: 1, groupIds: [baeren] }],
      })
      expect(errorCode(() => updateTemplate(db, actor(leitung()), id, { title: 'X', categoryName: 'Eltern' }, NOW))).toBe('forbidden')
      const forLeitung = listTemplates(db, leitung()).find(item => item.id === id)!
      expect(forLeitung.targets).toMatchObject({ scope: 'selected', facilityIds: [1], facilityNames: expect.arrayContaining(['Krippe']) })
      expect(forLeitung.targets!.groupTargets).toEqual([{ facilityId: 1, groupIds: [baeren] }])
      expect(forLeitung.allFacilities).toBe(false)
      const forTraeger = listTemplates(db, provider()).find(item => item.id === id)!
      expect(forTraeger.targets!.facilityIds).toEqual([1, krippe])
      expect(forTraeger.targets!.groupTargets).toHaveLength(2)
    })

    it('takes no home group from a helper of another facility who unlocked the tablet, and none after the lock time', () => {
      setTimeTrackingFrom(db, 1, '2026-10-01')
      setTimeTrackingFrom(db, krippe, '2026-10-01')
      const tablet = addUser(db, 'tablet', 'terminal')
      db.insert(entries).values({ employeeId: helper, date: TODAY, kind: 'shift', helpFacilityId: 1, updatedAt: NOW.toISOString() }).run()
      setPin(db, krippe, helper, '445566')
      const { token } = unlockChildren(db, { id: tablet.id, facilityId: 1 }, helper, '445566', NOW)
      const group = readerHomeGroup(db, tablet, token, NOW)
      expect(group).toBe(maeuse)
      template(leitung(), 'Nur Bären', { groupTargets: [{ facilityId: 1, groupIds: [baeren] }] })
      expect(templateTitles(as('terminal', group))).toEqual([])
      // The lock time over: locked.
      expect(readerHomeGroup(db, tablet, token, new Date(NOW.getTime() + 24 * 3_600_000))).toBeNull()
    })

    it('counts the Träger\'s templates in a category for an editor without manager rights by their home group', () => {
      template(provider(), 'Bären-Vorlage', { scope: 'all', groupTargets: [{ facilityId: 1, groupIds: [baeren] }] })
      const count = (homeGroupId: number | null, role: Role = 'observer') =>
        listCategories(db, { role, facilityId: 1, homeGroupId }).find(category => category.id === templateCategory)!.globalCount
      expect(count(baeren)).toBe(1)
      expect(count(fuechse)).toBe(0)
      expect(count(null, 'admin')).toBe(1)
    })

    it('lets the Träger find an item whose chosen facilities are all gone („Keine Einrichtung gewählt“), give it facilities or delete it', () => {
      const weg = addFacility(db, 'Weg')
      const id = template(provider(), 'Verwaist', { scope: 'selected', facilityIds: [weg] })
      const knowledge = entry(provider(), 'Verwaist', { scope: 'selected', facilityIds: [weg] })
      // The facility is deleted (directly; its rows go with it).
      db.run(sql`PRAGMA foreign_keys = OFF`)
      db.delete(facilities).where(eq(facilities.id, weg)).run()
      db.run(sql`PRAGMA foreign_keys = ON`)
      db.delete(printTemplateTargets).where(eq(printTemplateTargets.facilityId, weg)).run()
      db.delete(knowledgeEntryTargets).where(eq(knowledgeEntryTargets.facilityId, weg)).run()
      expect(templateTitles(leitung())).toEqual([])
      expect(entryTitles(leitung())).toEqual([])
      const orphan = listTemplates(db, provider()).find(item => item.id === id)!
      expect(orphan).toMatchObject({ categoryId: null, global: true, allFacilities: false })
      expect(orphan.targets).toMatchObject({ scope: 'selected', facilityIds: [], facilityNames: [] })
      expect(listKnowledge(db, provider()).entries.find(item => item.id === knowledge)!.targets).toMatchObject({ scope: 'selected', facilityNames: [] })
      // Facilities again, then it shows there; the knowledge entry is deleted.
      updateTemplate(db, actor(provider()), id, { title: 'Verwaist', scope: 'selected', facilityIds: [krippe], categoryName: 'Eltern' }, NOW)
      expect(templateTitles(provider(krippe))).toContain('Verwaist')
      deleteKnowledgeEntry(db, { ...provider(), id: 1 }, knowledge)
      expect(db.select().from(knowledgeEntries).where(eq(knowledgeEntries.id, knowledge)).get()).toBeUndefined()
    })

    it('reads every Vorlagen and „Wissen“ route with the reader\'s home group', () => {
      const routes = [
        'print-templates/index.get.ts', 'print-templates/[id]/file.get.ts', 'print-templates/[id].put.ts', 'print-templates/[id].delete.ts',
        'print-templates/[id]/file.put.ts', 'print-templates/order.post.ts', 'template-categories/index.get.ts', 'knowledge/index.get.ts',
        'knowledge/open-count.get.ts', 'knowledge/[id]/file.get.ts', 'knowledge/[id]/confirm.post.ts', 'knowledge/[id]/confirmations.get.ts',
        'knowledge/[id]/move.post.ts', 'knowledge/[id].put.ts', 'knowledge/[id].delete.ts',
      ]
      for (const route of routes) {
        expect(readFileSync(join(process.cwd(), 'server', 'api', route), 'utf8'), route).toMatch(/useDb\(\), await withHomeGroup\(event, \w+\)/)
      }
    })
  })
})
