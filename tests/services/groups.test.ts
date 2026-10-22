import { asc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import {
  childGroupChanges, children, coverageRules, employees, entries, groups, weekTemplateEntries, weekTemplateMarks, weekTemplates,
} from '../../server/db/schema'
import { deleteGroupChange, planGroupChange } from '../../server/services/childGroupChanges'
import {
  createEmployee, getEmployee, listEmployees, moveEmployeeToFacility, updateEmployee,
} from '../../server/services/employees'
import { applyToCells } from '../../server/services/entries'
import {
  assertGroup, createGroup, deleteGroup, listChildGroups, listGroups, renameGroup, setGroupCapacity, setGroupColor,
} from '../../server/services/groups'
import { addChild, addEmployee, addFacility, addGroup, addUser, asChildViewer, createTestDb, errorCode, templateId } from '../helpers/fixtures'

const today = '2026-10-08'

describe('groups of a facility', () => {
  let db: Db
  beforeEach(() => {
    db = createTestDb()
  })

  function groupRows() {
    return db.select().from(groups).orderBy(asc(groups.id)).all()
  }

  it('creates groups in order and lists only the facility\'s own', () => {
    const krippe = addFacility(db, 'Krippe')
    const bears = createGroup(db, 1, '  Bären ')
    expect(bears).toEqual({ id: bears.id, name: 'Bären', sortOrder: 0, capacity: null, forSchoolChildren: false, color: null, groupType: null })
    const mice = createGroup(db, 1, 'Mäuse')
    expect(mice.sortOrder).toBe(1)
    // The same name in another facility is fine: names are unique per facility.
    const krippeBears = createGroup(db, krippe, 'Bären')
    expect(krippeBears.sortOrder).toBe(0)
    expect(listGroups(db, 1)).toEqual([bears, mice])
    expect(listGroups(db, krippe)).toEqual([krippeBears])
    expect(listGroups(db, addFacility(db, 'Hort'))).toEqual([])
  })

  it('refuses empty names and names taken in any spelling, umlauts included', () => {
    expect(errorCode(() => createGroup(db, 1, '   '))).toBe('group_name_required')
    createGroup(db, 1, 'Bären')
    expect(errorCode(() => createGroup(db, 1, 'BÄREN'))).toBe('group_name_taken')
    expect(errorCode(() => createGroup(db, 1, ' bären '))).toBe('group_name_taken')
    expect(groupRows().map(group => group.name)).toEqual(['Bären'])
  })

  it('renames a group with every refusal', () => {
    const bears = addGroup(db, 1, 'Bären')
    addGroup(db, 1, 'Mäuse')
    renameGroup(db, 1, bears, ' BÄREN ') // its own name in another spelling
    expect(listGroups(db, 1).map(group => group.name)).toEqual(['BÄREN', 'Mäuse'])
    expect(errorCode(() => renameGroup(db, 1, bears, 'MÄUSE'))).toBe('group_name_taken')
    expect(errorCode(() => renameGroup(db, 1, bears, '  '))).toBe('group_name_required')
    expect(errorCode(() => renameGroup(db, 1, 999, 'Igel'))).toBe('group_not_found')
    expect(listGroups(db, 1).map(group => group.name)).toEqual(['BÄREN', 'Mäuse'])
  })

  it('deletes an empty group with its required duties and templates and clears the entry groups', () => {
    const bears = addGroup(db, 1, 'Bären')
    const mice = addGroup(db, 1, 'Mäuse')
    const anna = addEmployee(db, 'Anna', { groupId: mice })
    const F1 = templateId(db, 'F1')
    const helping = db.insert(entries).values({
      employeeId: anna, date: '2026-10-05', kind: 'shift', shiftTemplateId: F1, start: 420, end: 795, groupId: bears, updatedAt: 'now',
    }).returning().get().id
    const own = db.insert(entries).values({
      employeeId: anna, date: '2026-10-06', kind: 'shift', shiftTemplateId: F1, start: 420, end: 795, updatedAt: 'now',
    }).returning().get().id
    const rulesBefore = db.select().from(coverageRules).all().length
    const bearsRule = db.insert(coverageRules).values({ facilityId: 1, label: 'Bären früh', start: 420, end: 480, groupId: bears })
      .returning().get().id
    const miceRule = db.insert(coverageRules).values({ facilityId: 1, label: 'Mäuse früh', start: 420, end: 480, groupId: mice })
      .returning().get().id
    const template = (name: string, groupId: number | null) => {
      const id = db.insert(weekTemplates).values({ facilityId: 1, name, groupId, updatedAt: 'now' }).returning().get().id
      db.insert(weekTemplateEntries).values({ weekTemplateId: id, employeeId: anna, weekday: 0, kind: 'shift', shiftTemplateId: F1 }).run()
      return id
    }
    const bearsWeek = template('Bärenwoche', bears)
    const miceWeek = template('Mäusewoche', mice)
    const wholeWeek = template('Normalwoche', null)
    db.insert(weekTemplateMarks).values([
      { facilityId: 1, weekStart: '2026-10-05', groupId: 0, weekTemplateId: wholeWeek },
      { facilityId: 1, weekStart: '2026-10-05', groupId: bears, weekTemplateId: bearsWeek },
      { facilityId: 1, weekStart: '2026-10-05', groupId: mice, weekTemplateId: miceWeek },
    ]).run()

    deleteGroup(db, 1, bears, today)

    expect(listGroups(db, 1).map(group => group.id)).toEqual([mice])
    // No entry is lost; the one that counted for the deleted group counts for the home group again.
    expect(db.select({ id: entries.id, groupId: entries.groupId }).from(entries).orderBy(asc(entries.id)).all())
      .toEqual([{ id: helping, groupId: null }, { id: own, groupId: null }])
    const rules = db.select().from(coverageRules).all()
    expect(rules).toHaveLength(rulesBefore + 1)
    expect(rules.map(rule => rule.id)).not.toContain(bearsRule)
    expect(rules.map(rule => rule.id)).toContain(miceRule)
    expect(db.select({ id: weekTemplates.id }).from(weekTemplates).orderBy(asc(weekTemplates.id)).all())
      .toEqual([{ id: miceWeek }, { id: wholeWeek }])
    expect(db.select().from(weekTemplateEntries).all().map(entry => entry.weekTemplateId)).toEqual([miceWeek, wholeWeek])
    expect(db.select({ groupId: weekTemplateMarks.groupId }).from(weekTemplateMarks).orderBy(asc(weekTemplateMarks.groupId)).all())
      .toEqual([{ groupId: 0 }, { groupId: mice }])
  })

  it('refuses to delete a group that is still somebody\'s home group', () => {
    const bears = addGroup(db, 1, 'Bären')
    const anna = addEmployee(db, 'Anna', { groupId: bears, leftOn: '2026-01-31' })
    const rule = db.insert(coverageRules).values({ facilityId: 1, label: 'Bären früh', start: 420, end: 480, groupId: bears })
      .returning().get().id
    expect(errorCode(() => deleteGroup(db, 1, bears, today))).toBe('group_has_members')
    expect(listGroups(db, 1).map(group => group.id)).toEqual([bears])
    expect(db.select().from(coverageRules).where(eq(coverageRules.id, rule)).get()).toBeDefined()

    updateEmployee(db, 1, anna, { name: 'Anna', shortName: 'An', leftOn: '2026-01-31', groupId: null })
    deleteGroup(db, 1, bears, today)
    expect(listGroups(db, 1)).toEqual([])
    expect(errorCode(() => deleteGroup(db, 1, bears, today))).toBe('group_not_found')
  })

  it('answers group_not_found for another facility\'s group and changes nothing', () => {
    const krippe = addFacility(db, 'Krippe')
    const foreign = addGroup(db, krippe, 'Igel')
    expect(errorCode(() => renameGroup(db, 1, foreign, 'Füchse'))).toBe('group_not_found')
    expect(errorCode(() => deleteGroup(db, 1, foreign, today))).toBe('group_not_found')
    expect(errorCode(() => assertGroup(db, 1, foreign))).toBe('group_not_found')
    expect(errorCode(() => assertGroup(db, 1, 999))).toBe('group_not_found')
    expect(errorCode(() => assertGroup(db, 1, null))).toBeNull()
    expect(errorCode(() => assertGroup(db, krippe, foreign))).toBeNull()
    expect(listGroups(db, krippe)).toEqual([{ id: foreign, name: 'Igel', sortOrder: 0, capacity: null, forSchoolChildren: false, color: null, groupType: null }])
  })

  it('refuses to delete a group holding only a waitlist child', () => {
    const bears = addGroup(db, 1, 'Bären')
    const waitlisted = addChild(db, 1, { groupId: bears, admissionStatus: 'waitlist', entryDate: null })
    expect(errorCode(() => deleteGroup(db, 1, bears, today))).toBe('group_has_children')
    db.update(children).set({ groupId: null }).where(eq(children.id, waitlisted)).run()
    deleteGroup(db, 1, bears, today)
    expect(listGroups(db, 1)).toEqual([])
  })

  it('refuses to delete a group with active or planned children, but not one with archived children only', () => {
    const bears = addGroup(db, 1, 'Bären')
    const active = addChild(db, 1, { groupId: bears })
    const planned = addChild(db, 1, { groupId: bears, entryDate: null, plannedEntryDate: '2027-01-01' })
    // Leaving today still counts: the child is archived only the day after.
    const leaving = addChild(db, 1, { groupId: bears, leftOn: today })
    const archived = addChild(db, 1, { groupId: bears, leftOn: '2026-10-07' })
    for (const child of [active, planned, leaving]) {
      expect(errorCode(() => deleteGroup(db, 1, bears, today))).toBe('group_has_children')
      expect(listGroups(db, 1).map(group => group.id)).toEqual([bears])
      db.update(children).set({ groupId: null }).where(eq(children.id, child)).run()
    }

    deleteGroup(db, 1, bears, today)
    expect(listGroups(db, 1)).toEqual([])
    expect(db.select({ groupId: children.groupId }).from(children).where(eq(children.id, archived)).get()!.groupId).toBeNull()
  })

  const KEEP_ALL = { contacts: true, health: true, consents: true, documents: true, careType: true, keyEducator: true }

  it('refuses to delete a group a planned change still leads into', () => {
    const admin = asChildViewer(addUser(db, 'leitung', 'admin'))
    const bears = addGroup(db, 1, 'Bären')
    const mice = addGroup(db, 1, 'Mäuse')
    const id = addChild(db, 1, { groupId: bears })
    planGroupChange(db, admin, 1, id, { groupId: mice, date: '2027-03-15', keep: KEEP_ALL }, today)

    expect(errorCode(() => deleteGroup(db, 1, mice, today))).toBe('group_has_pending_changes')
    expect(listGroups(db, 1).map(group => group.id)).toEqual([bears, mice])

    const pending = db.select().from(childGroupChanges).where(eq(childGroupChanges.groupId, mice)).get()!
    deleteGroupChange(db, 1, pending.id, today)
    deleteGroup(db, 1, mice, today)
    expect(listGroups(db, 1).map(group => group.id)).toEqual([bears])
  })

  it('lets the history entries of a deleted group lose the group', () => {
    const admin = asChildViewer(addUser(db, 'leitung', 'admin'))
    const bears = addGroup(db, 1, 'Bären')
    const mice = addGroup(db, 1, 'Mäuse')
    const archived = addChild(db, 1, { groupId: bears, leftOn: '2026-10-07' })
    const moved = addChild(db, 1, { groupId: bears })
    // An applied change into another group does not hold the old group.
    planGroupChange(db, admin, 1, moved, { groupId: mice, date: '2026-10-01', keep: KEEP_ALL }, today)

    deleteGroup(db, 1, bears, today)

    const history = (childId: number) => db.select().from(childGroupChanges).where(eq(childGroupChanges.childId, childId))
      .orderBy(asc(childGroupChanges.fromDate)).all().map(row => [row.fromDate, row.groupId])
    expect(history(archived)).toEqual([[null, null]])
    expect(history(moved)).toEqual([[null, null], ['2026-10-01', mice]])
  })
})

describe('home group of employees', () => {
  let db: Db
  let bears: number
  let mice: number
  beforeEach(() => {
    db = createTestDb()
    bears = addGroup(db, 1, 'Bären')
    mice = addGroup(db, 1, 'Mäuse')
  })

  const input = { name: 'Anna', shortName: 'An', weeklyMinutes: 2340, validFrom: '2026-01-01' }

  it('sets the group on creation and update and returns it in the list and detail', () => {
    const actor = addUser(db, 'leitung', 'admin')
    const anna = createEmployee(db, actor, 1, { ...input, groupId: bears })
    const ben = createEmployee(db, actor, 1, { ...input, name: 'Ben' })
    expect(getEmployee(db, 1, anna, today, 'admin').groupId).toBe(bears)
    expect(listEmployees(db, 1, today, 'admin').map(employee => [employee.id, employee.groupId]))
      .toEqual([[anna, bears], [ben, null]])

    updateEmployee(db, 1, anna, { name: 'Anna', shortName: 'An', leftOn: null, groupId: mice })
    expect(getEmployee(db, 1, anna, today, 'admin').groupId).toBe(mice)
    // Leaving groupId out keeps the group.
    updateEmployee(db, 1, anna, { name: 'Anna B.', shortName: 'An', leftOn: null })
    expect(getEmployee(db, 1, anna, today, 'admin').groupId).toBe(mice)
    updateEmployee(db, 1, anna, { name: 'Anna B.', shortName: 'An', leftOn: null, groupId: null })
    expect(getEmployee(db, 1, anna, today, 'admin').groupId).toBeNull()
  })

  it('refuses a group of another facility', () => {
    const actor = addUser(db, 'leitung', 'admin')
    const foreign = addGroup(db, addFacility(db, 'Krippe'), 'Igel')
    const before = db.select().from(employees).all().length
    expect(errorCode(() => createEmployee(db, actor, 1, { ...input, groupId: foreign }))).toBe('group_not_found')
    expect(db.select().from(employees).all()).toHaveLength(before)

    const anna = addEmployee(db, 'Anna', { groupId: bears })
    expect(errorCode(() => updateEmployee(db, 1, anna, { name: 'Anneliese', shortName: 'An', leftOn: null, groupId: foreign })))
      .toBe('group_not_found')
    expect(errorCode(() => updateEmployee(db, 1, anna, { name: 'Anneliese', shortName: 'An', leftOn: null, groupId: 999 })))
      .toBe('group_not_found')
    expect(db.select().from(employees).where(eq(employees.id, anna)).get()).toMatchObject({ name: 'Anna', groupId: bears })
  })

  it('clears the group and every home entry group when the employee moves; help-out groups stay', () => {
    const krippe = addFacility(db, 'Krippe')
    const krippeGroup = addGroup(db, krippe, 'Wichtel')
    const hort = addFacility(db, 'Hort')
    const hortGroup = addGroup(db, hort, 'Raben')
    const provider = addUser(db, 'traeger', 'provider')
    const anna = addEmployee(db, 'Anna', { groupId: bears })
    const entry = (date: string, groupId: number | null, helpFacilityId: number | null = null) => db.insert(entries).values({
      employeeId: anna, date, kind: 'shift', shiftTemplateId: templateId(db, 'F1', helpFacilityId ?? 1), start: 420, end: 795,
      groupId, helpFacilityId, updatedAt: 'now',
    }).returning().get().id
    const before = entry('2026-10-07', mice)
    const moveDay = entry('2026-10-08', mice)
    const later = entry('2026-10-12', bears)
    const inHort = entry('2026-10-13', hortGroup, hort)
    // Helping out in the new home becomes a home entry and keeps its group: it belongs to the new facility.
    const inKrippe = entry('2026-10-14', krippeGroup, krippe)

    moveEmployeeToFacility(db, provider, anna, krippe, new Date(`${today}T08:00:00Z`))

    expect(db.select().from(employees).where(eq(employees.id, anna)).get()!.groupId).toBeNull()
    // The old facility's group ids are gone from every home entry, earlier days included; help-outs keep their plan's group.
    expect(db.select({ id: entries.id, groupId: entries.groupId, helpFacilityId: entries.helpFacilityId })
      .from(entries).orderBy(asc(entries.id)).all()).toEqual([
      { id: before, groupId: null, helpFacilityId: null }, { id: moveDay, groupId: null, helpFacilityId: null },
      { id: later, groupId: null, helpFacilityId: null }, { id: inHort, groupId: hortGroup, helpFacilityId: hort },
      { id: inKrippe, groupId: krippeGroup, helpFacilityId: null },
    ])
  })

  it('lets the new facility rewrite a single pre-move day without a group', () => {
    const krippe = addFacility(db, 'Krippe')
    const provider = addUser(db, 'traeger', 'provider')
    const anna = addEmployee(db, 'Anna', { groupId: bears })
    db.insert(entries).values({
      employeeId: anna, date: '2026-10-07', kind: 'shift', shiftTemplateId: templateId(db, 'F1', 1), start: 420, end: 795,
      groupId: mice, updatedAt: 'now',
    }).run()

    moveEmployeeToFacility(db, provider, anna, krippe, new Date(`${today}T08:00:00Z`))
    applyToCells(db, provider, krippe, [{ employeeId: anna, date: '2026-10-07' }], 'replace', { kind: 'shift', templateId: templateId(db, 'F2', krippe) })

    expect(db.select({ groupId: entries.groupId }).from(entries).where(eq(entries.employeeId, anna)).all()).toEqual([{ groupId: null }])
  })
})

describe('group capacity', () => {
  let db: Db
  beforeEach(() => {
    db = createTestDb()
  })

  it('has no capacity at first and keeps what is set, per group', () => {
    const bears = addGroup(db, 1, 'Bären')
    const mice = addGroup(db, 1, 'Mäuse')
    expect(listGroups(db, 1).map(group => group.capacity)).toEqual([null, null])
    setGroupCapacity(db, 1, bears, 12)
    expect(listGroups(db, 1)).toEqual([
      { id: bears, name: 'Bären', sortOrder: 0, capacity: 12, forSchoolChildren: false, color: null, groupType: null },
      { id: mice, name: 'Mäuse', sortOrder: 1, capacity: null, forSchoolChildren: false, color: null, groupType: null },
    ])
  })

  it('gives the places to Träger and Leitung only in the group list of the child pages', () => {
    const bears = addGroup(db, 1, 'Bären')
    const mice = addGroup(db, 1, 'Mäuse')
    setGroupCapacity(db, 1, bears, 12)
    const viewer = (role: 'provider' | 'admin' | 'observer' | 'terminal' | null) => ({ facilityId: 1, role, groups: null })
    for (const role of ['provider', 'admin'] as const) {
      expect(listChildGroups(db, viewer(role)), role).toEqual(listGroups(db, 1).map(group => ({ ...group, right: 'write' })))
    }
    for (const role of ['observer', 'terminal', null] as const) {
      expect(listChildGroups(db, viewer(role)), String(role)).toEqual([
        { id: bears, name: 'Bären', sortOrder: 0, capacity: null, forSchoolChildren: false, color: null, groupType: null, right: 'write' },
        { id: mice, name: 'Mäuse', sortOrder: 1, capacity: null, forSchoolChildren: false, color: null, groupType: null, right: 'write' },
      ])
    }
  })

  it('gives a viewer with a group only the own (write) and granted (read) groups for the child pages', () => {
    const bears = addGroup(db, 1, 'Bären')
    const mice = addGroup(db, 1, 'Mäuse')
    const owls = addGroup(db, 1, 'Eulen')
    const anna = { facilityId: 1, role: 'terminal' as const, groups: { own: mice, readable: [owls] } }
    expect(listChildGroups(db, anna)).toEqual([
      { id: mice, name: 'Mäuse', sortOrder: 1, capacity: null, forSchoolChildren: false, color: null, groupType: null, right: 'write' },
      { id: owls, name: 'Eulen', sortOrder: 2, capacity: null, forSchoolChildren: false, color: null, groupType: null, right: 'read' },
    ])
    expect(listChildGroups(db, anna).some(group => group.id === bears)).toBe(false)
  })

  it('accepts 1 and 200, and null clears the capacity', () => {
    const bears = addGroup(db, 1, 'Bären')
    setGroupCapacity(db, 1, bears, 1)
    expect(listGroups(db, 1)[0]!.capacity).toBe(1)
    setGroupCapacity(db, 1, bears, 200)
    expect(listGroups(db, 1)[0]!.capacity).toBe(200)
    setGroupCapacity(db, 1, bears, null)
    expect(listGroups(db, 1)[0]!.capacity).toBeNull()
  })

  it('refuses anything but a whole number from 1 to 200', () => {
    const bears = addGroup(db, 1, 'Bären')
    setGroupCapacity(db, 1, bears, 10)
    for (const value of [0, 201, 2.5, -1, Number.NaN]) {
      expect(errorCode(() => setGroupCapacity(db, 1, bears, value)), String(value)).toBe('invalid_capacity')
    }
    expect(listGroups(db, 1)[0]!.capacity).toBe(10)
  })

  it('answers 404 group_not_found for another facility\'s group and leaves it alone', () => {
    const krippe = addFacility(db, 'Krippe')
    const wichtel = addGroup(db, krippe, 'Wichtel')
    expect(errorCode(() => setGroupCapacity(db, 1, wichtel, 5))).toBe('group_not_found')
    expect(errorCode(() => setGroupCapacity(db, 1, 999, 5))).toBe('group_not_found')
    expect(listGroups(db, krippe)[0]!.capacity).toBeNull()
  })
})

describe('group colour', () => {
  let db: Db
  beforeEach(() => {
    db = createTestDb()
  })

  it('has no colour at first; a palette colour is kept per group and null clears it', () => {
    const bears = addGroup(db, 1, 'Bären')
    const mice = addGroup(db, 1, 'Mäuse')
    expect(listGroups(db, 1).map(group => group.color)).toEqual([null, null])
    setGroupColor(db, 1, bears, 'amber')
    setGroupColor(db, 1, mice, 'brown')
    expect(listGroups(db, 1).map(group => group.color)).toEqual(['amber', 'brown'])
    setGroupColor(db, 1, bears, null)
    expect(listGroups(db, 1).map(group => group.color)).toEqual([null, 'brown'])
  })

  it('refuses a key outside the palette (400 invalid_group_color) and keeps the colour', () => {
    const bears = addGroup(db, 1, 'Bären')
    setGroupColor(db, 1, bears, 'teal')
    for (const value of ['green', 'red', 'blue', '', 'bg-red-500', '#ff0000', 'Amber']) {
      expect(errorCode(() => setGroupColor(db, 1, bears, value)), value).toBe('invalid_group_color')
    }
    expect(() => setGroupColor(db, 1, bears, 'green')).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(listGroups(db, 1)[0]!.color).toBe('teal')
  })

  it('answers 404 group_not_found for another facility\'s group and leaves it alone', () => {
    const krippe = addFacility(db, 'Krippe')
    const wichtel = addGroup(db, krippe, 'Wichtel')
    expect(errorCode(() => setGroupColor(db, 1, wichtel, 'rose'))).toBe('group_not_found')
    expect(() => setGroupColor(db, 1, wichtel, 'rose')).toThrow(expect.objectContaining({ statusCode: 404 }))
    expect(errorCode(() => setGroupColor(db, 1, 999, 'rose'))).toBe('group_not_found')
    expect(listGroups(db, krippe)[0]!.color).toBeNull()
  })
})
