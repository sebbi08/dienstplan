import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { groups, releaseSnapshots } from '../../server/db/schema'
import { applyToCells } from '../../server/services/entries'
import { deleteGroup, renameGroup } from '../../server/services/groups'
import { listNotifications } from '../../server/services/notifications'
import { getMonthPlan, getMyPlan } from '../../server/services/plan'
import { buildSnapshot, releaseMonth } from '../../server/services/release'
import { cellKey } from '../../shared/domain/cells'
import type { EntryInput, MonthPlanDto, SessionUser, SnapshotData } from '../../shared/types/api'
import { addEmployee, addFacility, addGroup, addHelpOut, addUser, codeId, createTestDb, templateId } from '../helpers/fixtures'

// 2026-10-06 is a Tuesday.
const tuesday = '2026-10-06'
const wednesday = '2026-10-07'
const thursday = '2026-10-08'
const today = '2026-10-01'

/** Strips groups from stored snapshots, as they were stored before groups existed. */
function makeSnapshotsOld(db: Db): void {
  for (const row of db.select().from(releaseSnapshots).all()) {
    const data = JSON.parse(row.data) as Record<string, unknown> & { employees: Record<string, unknown>[]; entries: Record<string, unknown>[] }
    delete data.groups
    for (const employee of data.employees) delete employee.groupId
    for (const entry of data.entries) delete entry.groupId
    db.update(releaseSnapshots).set({ data: JSON.stringify(data) }).where(eq(releaseSnapshots.id, row.id)).run()
  }
}

describe('groups in the plan and in releases', () => {
  let db: Db
  let admin: SessionUser
  let krippe: number
  let leitungB: SessionUser
  let kaefer: number
  let maeuse: number
  let zoe: number
  let anna: number
  let ben: number
  let carla: number
  let dora: number
  let hugo: number

  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    krippe = addFacility(db, 'Krippe')
    leitungB = addUser(db, 'leitung-b', 'admin', null, krippe)
    // Mäuse is created first, but Käfer comes first in the order.
    maeuse = addGroup(db, 1, 'Mäuse')
    kaefer = addGroup(db, 1, 'Käfer')
    db.update(groups).set({ sortOrder: 5 }).where(eq(groups.id, maeuse)).run()
    db.update(groups).set({ sortOrder: 2 }).where(eq(groups.id, kaefer)).run()
    zoe = addEmployee(db, 'Zoe', { groupId: maeuse })
    anna = addEmployee(db, 'Anna', { groupId: kaefer })
    ben = addEmployee(db, 'Ben')
    carla = addEmployee(db, 'Carla', { groupId: kaefer })
    dora = addEmployee(db, 'Dora', { groupId: maeuse })
    hugo = addEmployee(db, 'Hugo', { facilityId: krippe })
    addHelpOut(db, hugo, 1, 2026, 10)
  })

  const shift = (label = 'F2', extra: Partial<EntryInput> = {}): EntryInput =>
    ({ kind: 'shift', templateId: templateId(db, label), ...extra })
  const write = (employeeId: number, date: string, input: EntryInput, mode: 'replace' | 'add' = 'replace') =>
    applyToCells(db, admin, 1, [{ employeeId, date }], mode, input)
  const plan = (viewer: SessionUser = admin): MonthPlanDto => getMonthPlan(db, viewer, 1, 2026, 10, today)
  const release = (iso: string) => releaseMonth(db, admin, 1, 2026, 10, new Date(iso))
  const count = (dto: MonthPlanDto, groupId: number, date: string) => dto.attendance[String(groupId)]![date]

  /** One week with duties that do and do not count for a group. */
  function planWeek(): void {
    write(anna, tuesday, shift())
    write(carla, tuesday, shift())
    write(carla, tuesday, { kind: 'code', codeId: codeId(db, 'prep_time'), start: 960, end: 1020 }, 'add')
    write(zoe, tuesday, { kind: 'code', codeId: codeId(db, 'sick') })
    write(dora, tuesday, shift('HK'))
    write(ben, tuesday, shift('F2', { groupId: maeuse }))
    write(hugo, tuesday, shift('F1', { groupId: kaefer }))
    // Wednesday: Anna counts for Mäuse, Ben and Hugo for no group, Dora has only VZ, Zoe HK and a break.
    write(anna, wednesday, shift('F2', { groupId: maeuse }))
    write(ben, wednesday, shift())
    write(hugo, wednesday, shift('F1'))
    write(dora, wednesday, { kind: 'code', codeId: codeId(db, 'prep_time'), start: 480, end: 600 })
    write(zoe, wednesday, shift('HK'))
    write(zoe, wednesday, { kind: 'break', start: 700, end: 715 }, 'add')
  }

  it('orders the columns in blocks: groups in their order, then Springer, then helpers', () => {
    const dto = plan()
    expect(dto.groups.map(group => group.name)).toEqual(['Käfer', 'Mäuse'])
    expect(dto.employees.map(employee => [employee.name, employee.groupId])).toEqual([
      ['Anna', kaefer], ['Carla', kaefer], ['Zoe', maeuse], ['Dora', maeuse], ['Ben', null], ['Hugo', null],
    ])
    expect(dto.employees.at(-1)!.helpFrom).toBe('Krippe')
    const snapshot = buildSnapshot(db, 1, 2026, 10)
    expect(snapshot.groups).toEqual(dto.groups)
    expect(snapshot.employees).toEqual(dto.employees)
  })

  it('counts the persons working in a group per day, Springer and helper duties included', () => {
    planWeek()
    const dto = plan()
    expect(Object.keys(dto.attendance).sort()).toEqual([String(kaefer), String(maeuse)].sort())
    expect(Object.keys(dto.attendance[String(kaefer)]!)).toHaveLength(31)
    // Tuesday: Anna, Carla (shift and VZ: one person) and Hugo for Käfer; Ben for Mäuse, not sick Zoe or HK Dora.
    expect(count(dto, kaefer, tuesday)).toBe(3)
    expect(count(dto, maeuse, tuesday)).toBe(1)
    // Wednesday: Anna for Mäuse, Dora's VZ; Ben and Hugo without a group count nowhere, Zoe's HK and break do not count.
    expect(count(dto, kaefer, wednesday)).toBe(0)
    expect(count(dto, maeuse, wednesday)).toBe(2)
    expect(count(dto, kaefer, '2026-10-01')).toBe(0)
  })

  it('never counts a help-elsewhere marker for the home group, and counts it in the other plan', () => {
    const raupen = addGroup(db, krippe, 'Raupen')
    addHelpOut(db, carla, krippe, 2026, 10)
    applyToCells(db, leitungB, krippe, [{ employeeId: carla, date: thursday }], 'replace',
      { kind: 'shift', templateId: templateId(db, 'F2', krippe), groupId: raupen })
    expect(count(plan(), kaefer, thursday)).toBe(0)
    const inB = getMonthPlan(db, leitungB, krippe, 2026, 10, today)
    expect(inB.groups.map(group => group.name)).toEqual(['Raupen'])
    expect(inB.attendance[String(raupen)]![thursday]).toBe(1)
    // In B, Carla is a helper after B's Springer Hugo.
    expect(inB.employees.map(employee => [employee.name, employee.groupId])).toEqual([['Hugo', null], ['Carla', null]])
  })

  it('gives observers the groups, columns and attendance of the release', () => {
    planWeek()
    release('2026-09-25T10:00:00Z')
    const observer = addUser(db, 'anna', 'observer', anna)
    // Draft changes after the release: a new name, Anna's Tuesday duty for Mäuse.
    renameGroup(db, 1, kaefer, 'Igel')
    write(anna, tuesday, shift('F2', { groupId: maeuse }))
    const seen = plan(observer)
    expect(seen.groups.map(group => group.name)).toEqual(['Käfer', 'Mäuse'])
    expect(seen.employees.map(employee => employee.name)).toEqual(['Anna', 'Carla', 'Zoe', 'Dora', 'Ben', 'Hugo'])
    expect([count(seen, kaefer, tuesday), count(seen, maeuse, tuesday)]).toEqual([3, 1])
    const draft = plan()
    expect(draft.groups.map(group => group.name)).toEqual(['Igel', 'Mäuse'])
    expect([count(draft, kaefer, tuesday), count(draft, maeuse, tuesday)]).toEqual([2, 2])
  })

  it('reads an old snapshot without groups: no blocks, no attendance, no pending change, nobody told', () => {
    write(anna, tuesday, shift())
    write(ben, tuesday, shift('S'))
    release('2026-09-25T10:00:00Z')
    makeSnapshotsOld(db)
    expect(db.select().from(releaseSnapshots).get()!.data).not.toContain('group')
    const seen = plan(addUser(db, 'anna', 'observer', anna))
    expect(seen.groups).toEqual([])
    expect(seen.attendance).toEqual({})
    expect(seen.employees.map(employee => employee.groupId)).toEqual([null, null, null, null, null, null])
    expect(plan().admin!.pendingChanges).toEqual({})
    expect(release('2026-10-01T08:00:00Z')).toEqual({ notified: [] })
  })

  describe('texts of released states name the groups stored with the release', () => {
    let igel: number
    beforeEach(() => {
      igel = addGroup(db, 1, 'Igel') // nobody's home group
    })

    it('shows a deleted group in the pending change, the notification and the history', () => {
      write(ben, tuesday, shift('F2', { groupId: igel }))
      release('2026-09-25T10:00:00Z')
      deleteGroup(db, 1, igel)
      const key = cellKey(ben, tuesday)
      const change = { before: 'F2 7:30–15:45 [11:40–12:10] → Igel', after: 'F2 7:30–15:45 [11:40–12:10]' }
      expect(plan().admin!.pendingChanges).toEqual({ [key]: change })
      expect(release('2026-10-01T08:00:00Z')).toEqual({ notified: ['Ben'] })
      expect(listNotifications(db, ben, new Date('2026-10-01T09:00:00Z'))[0]!.changes).toEqual([{ date: tuesday, ...change }])
      expect(plan().changes[key]!.map(({ before, after }) => ({ before, after }))).toEqual([change])
      const benUser = addUser(db, 'ben', 'observer', ben)
      const myDay = getMyPlan(db, benUser, 2026, 10, today).days.find(day => day.date === tuesday)!
      expect(myDay.changes.map(({ before, after }) => ({ before, after }))).toEqual([change])
    })

    it('names a renamed group as it was called at release time', () => {
      write(ben, tuesday, shift('F2', { groupId: igel }))
      release('2026-09-25T10:00:00Z')
      renameGroup(db, 1, igel, 'Eulen')
      // A rename alone is no change.
      expect(plan().admin!.pendingChanges).toEqual({})
      write(ben, tuesday, shift('S', { groupId: igel }))
      const change = { before: 'F2 7:30–15:45 [11:40–12:10] → Igel', after: 'S 8:45–17:00 [12:10–12:40] → Eulen' }
      expect(plan().admin!.pendingChanges).toEqual({ [cellKey(ben, tuesday)]: change })
      release('2026-10-01T08:00:00Z')
      expect(listNotifications(db, ben, new Date('2026-10-01T09:00:00Z'))[0]!.changes).toEqual([{ date: tuesday, ...change }])
    })
  })
})

describe('the plan of a facility without groups', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  let ben: number
  let hugo: number

  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    const krippe = addFacility(db, 'Krippe')
    // Ben comes before Anna in the employee order.
    ben = addEmployee(db, 'Ben')
    anna = addEmployee(db, 'Anna')
    hugo = addEmployee(db, 'Hugo', { facilityId: krippe })
    addHelpOut(db, hugo, 1, 2026, 10)
    const write = (employeeId: number, date: string, label: string) => applyToCells(db, admin, 1, [{ employeeId, date }], 'replace',
      { kind: 'shift', templateId: templateId(db, label) })
    write(anna, tuesday, 'F2')
    write(ben, tuesday, 'S')
    write(hugo, wednesday, 'F1')
  })

  const oldKeys = [
    'year', 'month', 'facilityName', 'facilityId', 'facilityNames', 'release', 'days', 'employees', 'entries', 'changes',
    'templates', 'codes', 'admin',
  ]
  const oldColumns = (anna: number, ben: number, hugo: number) => [
    { id: ben, name: 'Ben', shortName: 'Be', helpFrom: null, groupId: null },
    { id: anna, name: 'Anna', shortName: 'An', helpFrom: null, groupId: null },
    { id: hugo, name: 'Hugo', shortName: 'Hu', helpFrom: 'Krippe', groupId: null },
  ]

  it('gives the plan as before, with only empty groups and attendance added (Review Focus 1)', () => {
    const dto = getMonthPlan(db, admin, 1, 2026, 10, today)
    const { groups: shownGroups, attendance, ...rest } = dto
    expect(shownGroups).toEqual([])
    expect(attendance).toEqual({})
    expect(Object.keys(rest).sort()).toEqual([...oldKeys].sort())
    expect(rest.employees).toEqual(oldColumns(anna, ben, hugo))
    expect(rest.entries.map(entry => [entry.employeeId, entry.date, entry.groupId])).toEqual([
      [anna, tuesday, null], [ben, tuesday, null], [hugo, wednesday, null],
    ])
    expect(rest.admin!.weeks.every(week => week.templateName === null && Object.keys(week.templateNames).length === 0)).toBe(true)
  })

  it('stores a release as before plus empty groups, and an old release gives the same plan', () => {
    releaseMonth(db, admin, 1, 2026, 10, new Date('2026-09-25T10:00:00Z'))
    const stored = JSON.parse(db.select().from(releaseSnapshots).get()!.data) as SnapshotData
    expect(stored.groups).toEqual([])
    expect(Object.keys(stored).sort()).toEqual(['days', 'employees', 'entries', 'groups'])
    const observer = addUser(db, 'anna', 'observer', anna)
    const before = getMonthPlan(db, observer, 1, 2026, 10, today)
    makeSnapshotsOld(db)
    const after = getMonthPlan(db, observer, 1, 2026, 10, today)
    expect(after).toEqual(before)
    expect(after.groups).toEqual([])
    expect(after.attendance).toEqual({})
    expect(after.employees).toEqual(oldColumns(anna, ben, hugo))
    expect(getMonthPlan(db, admin, 1, 2026, 10, today).admin!.pendingChanges).toEqual({})
    expect(releaseMonth(db, admin, 1, 2026, 10, new Date('2026-10-01T08:00:00Z'))).toEqual({ notified: [] })
  })
})
