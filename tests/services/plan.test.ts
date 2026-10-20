import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { childParentMeetings, coverageRules, employees, notifications, releaseSnapshots } from '../../server/db/schema'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { applyToCells, setDayNote } from '../../server/services/entries'
import { getMonthPlan, getMyPlan } from '../../server/services/plan'
import { releaseMonth } from '../../server/services/release'
import { createCoverageRule, deleteTemplate, updateCode } from '../../server/services/settings'
import { createRecord } from '../../server/services/timeTracking'
import { cellKey } from '../../shared/domain/cells'
import type { SessionUser } from '../../shared/types/api'
import { addChild, addEmployee, addFacility, addGroup, addHelpOut, addUser, codeId, createTestDb, errorCode, templateId } from '../helpers/fixtures'

const today = '2026-10-01'

describe('month plan', () => {
  let db: Db
  let admin: SessionUser
  let observer: SessionUser
  let anna: number
  let ben: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
    ben = addEmployee(db, 'Ben')
    addEmployee(db, 'Carl', { validFrom: '2026-11-01' })
    observer = addUser(db, 'anna', 'observer', anna)
  })
  const shift = (employeeId: number, date: string, label = 'M', now?: Date) =>
    applyToCells(db, admin, 1, [{ employeeId, date }], 'replace', { kind: 'shift', templateId: templateId(db, label) }, { now })

  it('gives admins the full draft plan with warnings, weeks and balances', () => {
    const plan = getMonthPlan(db, admin, 1, 2026, 10, today)
    expect(plan.employees.map(e => e.name)).toEqual(['Anna', 'Ben'])
    // With a single facility the plan (and its printout) does not name it.
    expect(plan.facilityName).toBeNull()
    expect(plan.days).toHaveLength(31)
    expect(plan.days[2]).toMatchObject({ date: '2026-10-03', holidayKey: 'german_unity_day', isWeekend: true })
    expect(plan.templates).toHaveLength(5)
    expect(plan.codes).toHaveLength(10)
    expect(plan.admin!.weeks.map(w => w.weekStart)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'])
    expect(plan.admin!.weeks[0]!.weekNumber).toBe(40)
    expect(plan.admin!.warnings.filter(w => w.date === '2026-10-05')).toHaveLength(5)
    expect(plan.admin!.balances.map(b => b.name)).toEqual(['Anna', 'Ben'])
  })
  it('sums weeks across the year boundary', () => {
    for (const date of ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31']) shift(anna, date)
    const lastWeek = getMonthPlan(db, admin, 1, 2026, 12, today).admin!.weeks.at(-1)!
    expect(lastWeek).toMatchObject({ weekStart: '2026-12-28', weekEnd: '2027-01-03', weekNumber: 53 })
    expect(lastWeek.totals.find(t => t.employeeId === anna)).toEqual({ employeeId: anna, target: 1872, credit: 1860, delta: -12 })
  })
  it('hides drafts from observers', () => {
    expect(errorCode(() => getMonthPlan(db, observer, 1, 2026, 10, today))).toBe('month_not_released')
    expect(errorCode(() => getMyPlan(db, observer, 2026, 10, today))).toBe('month_not_released')
  })
  it('gives observers released plans without hour data or warnings', () => {
    shift(anna, '2026-10-05')
    releaseMonth(db, admin, 1, 2026, 10)
    const plan = getMonthPlan(db, observer, 1, 2026, 10, today)
    expect(plan.admin).toBeNull()
    expect(plan.entries).toHaveLength(1)
  })
  it('shows observers only the released state, not later draft edits', () => {
    shift(anna, '2026-10-06', 'F2')
    releaseMonth(db, admin, 1, 2026, 10, new Date('2026-09-25T10:00:00Z'))
    shift(anna, '2026-10-06', 'S')
    shift(ben, '2026-10-07', 'M')
    setDayNote(db, admin, 1, '2026-10-07', 'info1', 'Elternabend')
    const plan = getMonthPlan(db, observer, 1, 2026, 10, today)
    expect(plan.entries.map(e => [e.employeeId, e.date, e.shortLabel])).toEqual([[anna, '2026-10-06', 'F2']])
    expect(plan.days[6]!.info1).toBe('')
    expect(plan.changes).toEqual({})
    expect(plan.release).toMatchObject({ releasedBy: 'leitung', changeCount: 0, pendingCount: 0 })
  })
  it('does not show employees who joined after the release to observers', () => {
    releaseMonth(db, admin, 1, 2026, 10, new Date('2026-09-25T10:00:00Z'))
    addEmployee(db, 'Dora', { validFrom: '2026-10-15' })
    expect(getMonthPlan(db, observer, 1, 2026, 10, today).employees.map(e => e.name)).toEqual(['Anna', 'Ben'])
    expect(getMonthPlan(db, admin, 1, 2026, 10, today).employees.map(e => e.name)).toEqual(['Anna', 'Ben', 'Dora'])
  })
  it('marks released changes and keeps them across later releases', () => {
    shift(anna, '2026-10-06', 'F2')
    releaseMonth(db, admin, 1, 2026, 10, new Date('2026-09-25T10:00:00Z'))
    shift(anna, '2026-10-06', 'S')
    releaseMonth(db, admin, 1, 2026, 10, new Date('2026-10-01T07:00:00Z'))
    setDayNote(db, admin, 1, '2026-10-07', 'info1', 'Elternabend')
    releaseMonth(db, admin, 1, 2026, 10, new Date('2026-10-02T07:00:00Z'))
    const plan = getMonthPlan(db, observer, 1, 2026, 10, today)
    expect(plan.changes[`${anna}|2026-10-06`]).toEqual([{
      field: 'entry', employeeId: anna, date: '2026-10-06',
      before: 'F2 7:30–15:45 [11:40–12:10]', after: 'S 8:45–17:00 [12:10–12:40]',
      changedAt: '2026-10-01T07:00:00.000Z', changedBy: 'leitung',
    }])
    expect(plan.changes['info1|2026-10-07']).toEqual([expect.objectContaining({
      field: 'info1', employeeId: null, date: '2026-10-07', before: '', after: 'Elternabend', changedAt: '2026-10-02T07:00:00.000Z',
    })])
    expect(plan.release.changeCount).toBe(2)
    expect(plan.days[6]!.info1).toBe('Elternabend')
    expect(getMyPlan(db, observer, 2026, 10, today).days[5]!.changes).toHaveLength(1)
  })
  it('shows admins pending draft changes separately from released ones', () => {
    shift(anna, '2026-10-06', 'F2')
    releaseMonth(db, admin, 1, 2026, 10, new Date('2026-09-25T10:00:00Z'))
    shift(anna, '2026-10-06', 'S')
    const plan = getMonthPlan(db, admin, 1, 2026, 10, today)
    expect(plan.entries.find(e => e.date === '2026-10-06')?.shortLabel).toBe('S')
    expect(plan.changes).toEqual({})
    expect(plan.admin!.pendingChanges).toEqual({
      [`${anna}|2026-10-06`]: { before: 'F2 7:30–15:45 [11:40–12:10]', after: 'S 8:45–17:00 [12:10–12:40]' },
    })
    expect(plan.release).toMatchObject({ changeCount: 0, pendingCount: 1 })
  })
  it('has no pending or released changes for a never-released month', () => {
    shift(anna, '2026-10-06', 'F2')
    const plan = getMonthPlan(db, admin, 1, 2026, 10, today)
    expect(plan.admin!.pendingChanges).toEqual({})
    expect(plan.release).toEqual({ releasedAt: null, releasedBy: null, changeCount: 0, pendingCount: 0 })
  })
  it('does not count a renamed code as a plan change', () => {
    applyToCells(db, admin, 1, [{ employeeId: anna, date: '2026-10-06' }], 'replace', { kind: 'code', codeId: codeId(db, 'sick') })
    releaseMonth(db, admin, 1, 2026, 10, new Date('2026-09-25T10:00:00Z'))
    updateCode(db, codeId(db, 'sick'), { label: 'Krankheit', color: 'gray', creditMode: 'daily_target' })
    const plan = getMonthPlan(db, admin, 1, 2026, 10, today)
    expect(plan.entries.find(e => e.date === '2026-10-06')?.label).toBe('Krankheit')
    expect(plan.release.pendingCount).toBe(0)
    expect(plan.admin!.pendingChanges).toEqual({})
    releaseMonth(db, admin, 1, 2026, 10, new Date('2026-10-01T07:00:00Z'))
    expect(getMonthPlan(db, observer, 1, 2026, 10, today).changes).toEqual({})
  })
  it('does not count a deleted template as a plan change', () => {
    shift(anna, '2026-10-06', 'F2')
    releaseMonth(db, admin, 1, 2026, 10, new Date('2026-09-25T10:00:00Z'))
    deleteTemplate(db, 1, templateId(db, 'F2'))
    const plan = getMonthPlan(db, admin, 1, 2026, 10, today)
    expect(plan.entries.find(e => e.date === '2026-10-06')?.shortLabel).toBeNull()
    expect(plan.release.pendingCount).toBe(0)
    releaseMonth(db, admin, 1, 2026, 10, new Date('2026-10-01T07:00:00Z'))
    expect(getMonthPlan(db, observer, 1, 2026, 10, today).changes).toEqual({})
  })
  it('returns only the own entries in the personal plan', () => {
    shift(anna, '2026-10-05')
    shift(ben, '2026-10-05', 'S')
    releaseMonth(db, admin, 1, 2026, 10)
    const mine = getMyPlan(db, observer, 2026, 10, today)
    expect(mine.employee.name).toBe('Anna')
    expect(mine.days.flatMap(d => d.entries).map(e => e.employeeId)).toEqual([anna])
    expect(errorCode(() => getMyPlan(db, { ...observer, employeeId: null }, 2026, 10, today))).toBe('no_employee')
  })

  describe('with time tracking', () => {
    const NOW = new Date('2026-10-08T10:00:00Z')
    const record = (date: string, minutes: number) =>
      createRecord(db, admin, 1, { employeeId: anna, date, start: 465, end: 465 + minutes }, NOW)
    beforeEach(() => setTimeTrackingFrom(db, 1, '2026-10-01'))

    it('marks recorded time that deviates more than 15 minutes from the planned credit', () => {
      for (const date of ['2026-10-05', '2026-10-06', '2026-10-07']) shift(anna, date) // M = 465 min
      record('2026-10-05', 465 + 15)
      record('2026-10-06', 465 + 16)
      record('2026-10-07', 465 - 16)
      const actuals = getMonthPlan(db, admin, 1, 2026, 10, '2026-10-08').admin!.actuals
      expect(actuals[cellKey(anna, '2026-10-05')]).toEqual({ minutes: 480, open: false, deviates: false })
      expect(actuals[cellKey(anna, '2026-10-06')]).toEqual({ minutes: 481, open: false, deviates: true })
      expect(actuals[cellKey(anna, '2026-10-07')]).toEqual({ minutes: 449, open: false, deviates: true })
    })
    it('sorts plan and time warnings by date', () => {
      shift(anna, '2026-10-02') // planned, nothing recorded → missing_record on 02.10.
      const warnings = getMonthPlan(db, admin, 1, 2026, 10, '2026-10-08').admin!.warnings
      expect(warnings.some(w => w.type === 'missing_record' && w.date === '2026-10-02')).toBe(true)
      const dates = warnings.map(w => w.date)
      expect(dates).toEqual([...dates].sort())
    })
  })
})

describe('required duties per group in the month plan (Review Focus 2)', () => {
  const tuesday = '2026-10-06'
  let db: Db
  let admin: SessionUser
  let kaefer: number
  let maeuse: number
  let anna: number
  let ben: number
  let springer: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    kaefer = addGroup(db, 1, 'Käfer')
    maeuse = addGroup(db, 1, 'Mäuse')
    anna = addEmployee(db, 'Anna', { groupId: kaefer })
    ben = addEmployee(db, 'Ben', { groupId: maeuse })
    springer = addEmployee(db, 'Sina')
    // Only the group rules and one facility rule count here.
    db.delete(coverageRules).run()
  })
  const write = (employeeId: number, label: string, groupId?: number | null) =>
    applyToCells(db, admin, 1, [{ employeeId, date: tuesday }], 'replace',
      { kind: 'shift', templateId: templateId(db, label), groupId })
  const rule = (label: string, minCount: number, groupId: number | null) =>
    createCoverageRule(db, 1, { label, start: 420, end: null, minCount, active: true, groupId }).id
  const coverage = () => getMonthPlan(db, admin, 1, 2026, 10, today).admin!.warnings
    .filter(warning => warning.type === 'coverage' && warning.date === tuesday)

  it('counts each rule with the right duties: home groups, a moved duty, a Springer and a helper', () => {
    const facility = rule('Frühdienst ab 7:00', 4, null)
    const kaeferRule = rule('Frühdienst ab 7:00', 1, kaefer)
    rule('Frühdienst ab 7:00', 2, maeuse) // met: Anna's moved duty and Ben
    write(anna, 'F1', maeuse) // Käfer member, counts for Mäuse today
    write(ben, 'F1') // Mäuse
    write(springer, 'F1') // Springer: facility only
    expect(coverage()).toEqual([
      { type: 'coverage', date: tuesday, ruleId: facility, label: 'Frühdienst ab 7:00', found: 3, required: 4 },
      { type: 'coverage', date: tuesday, ruleId: kaeferRule, label: 'Frühdienst ab 7:00', found: 0, required: 1, groupName: 'Käfer' },
    ])

    // A helper from another facility has no home group here: facility rules only, unless the duty has a group.
    const krippe = addFacility(db, 'Krippe')
    db.delete(coverageRules).where(eq(coverageRules.facilityId, krippe)).run()
    const kim = addEmployee(db, 'Kim', { facilityId: krippe })
    addHelpOut(db, kim, 1, 2026, 10)
    applyToCells(db, admin, 1, [{ employeeId: kim, date: tuesday }], 'replace', { kind: 'shift', templateId: templateId(db, 'F1') })
    expect(coverage().map(warning => [warning.ruleId, (warning as { found: number }).found])).toEqual([[kaeferRule, 0]])
    applyToCells(db, admin, 1, [{ employeeId: kim, date: tuesday }], 'replace',
      { kind: 'shift', templateId: templateId(db, 'F1'), groupId: kaefer })
    expect(coverage()).toEqual([])
  })

  it('names no group in the warnings of a facility without groups', () => {
    const plain = createTestDb()
    const leitung = addUser(plain, 'leitung', 'admin')
    addEmployee(plain, 'Anna')
    const warnings = getMonthPlan(plain, leitung, 1, 2026, 10, today).admin!.warnings.filter(w => w.type === 'coverage')
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings.every(warning => !('groupName' in warning))).toBe(true)
  })
})

describe('automatic day events in the plan (Review Focus 1, 4)', () => {
  let db: Db
  let admin: SessionUser
  let observer: SessionUser
  let anna: number
  let baeren: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
    observer = addUser(db, 'anna', 'observer', anna)
    baeren = addGroup(db, 1, 'Bären')
  })
  const shift = (date: string, label = 'M') =>
    applyToCells(db, admin, 1, [{ employeeId: anna, date }], 'replace', { kind: 'shift', templateId: templateId(db, label) })
  const day = (days: { date: string; autoEvents: string[] }[], date: string) => days.find(row => row.date === date)!.autoEvents

  it('adds them to the draft next to the own Info texts, empty on other days', () => {
    addChild(db, 1, { firstName: 'Zoraida', lastName: 'Quintus', birthDate: '2022-10-14', groupId: baeren })
    setDayNote(db, admin, 1, '2026-10-14', 'info1', 'Elternabend')
    const plan = getMonthPlan(db, admin, 1, 2026, 10, today)
    expect(plan.days[13]).toMatchObject({ info1: 'Elternabend', info2: '', autoEvents: ['Kindergeburtstag (Bären)'] })
    expect(day(plan.days, '2026-10-15')).toEqual([])
  })

  it('shows staff the live events of a released month, without changing releases, diffs or notifications', () => {
    shift('2026-10-05')
    releaseMonth(db, admin, 1, 2026, 10, new Date('2026-09-25T10:00:00Z'))
    // Added after the release: computed live for every viewer.
    const kid = addChild(db, 1, { firstName: 'Zoraida', lastName: 'Quintus', birthDate: '2022-10-14', groupId: baeren })
    db.insert(childParentMeetings).values({
      childId: kid, date: '2026-10-14', start: 840, end: null, kind: 'development', note: 'Vertraulich', createdAt: '2026-01-01T00:00:00Z',
    }).run()
    db.update(employees).set({ birthday: '10-14' }).where(eq(employees.id, anna)).run()
    const events = ['Elterngespräch 14:00 (Bären)', 'Kindergeburtstag (Bären)', 'Geburtstag Anna']

    const forStaff = getMonthPlan(db, observer, 1, 2026, 10, today)
    expect(day(forStaff.days, '2026-10-14')).toEqual(events)
    const mine = getMyPlan(db, observer, 2026, 10, today)
    expect(day(mine.days, '2026-10-14')).toEqual(events)
    const forAdmin = getMonthPlan(db, admin, 1, 2026, 10, today)
    expect(day(forAdmin.days, '2026-10-14')).toEqual(events)
    expect(forAdmin.admin!.pendingChanges).toEqual({})
    expect(forAdmin.release).toMatchObject({ changeCount: 0, pendingCount: 0 })

    expect(releaseMonth(db, admin, 1, 2026, 10, new Date('2026-10-02T10:00:00Z'))).toEqual({ notified: [] })
    expect(db.select().from(notifications).all()).toEqual([])
    expect(getMonthPlan(db, observer, 1, 2026, 10, today).changes).toEqual({})
    for (const snapshot of db.select().from(releaseSnapshots).all()) {
      expect(snapshot.data).not.toContain('autoEvents')
      expect(snapshot.data).not.toContain('Kindergeburtstag')
    }

    // Review Focus 4: no child name, child id or meeting note in what staff phones get.
    for (const dto of [forStaff, mine, forAdmin]) {
      const json = JSON.stringify(dto)
      for (const secret of ['Zoraida', 'Quintus', 'Vertraulich', 'childId']) expect(json).not.toContain(secret)
    }
  })

  it('gives a person\'s own plan the events of their home facility', () => {
    const krippe = addFacility(db, 'Krippe')
    const leitungB = addUser(db, 'leitung-b', 'admin', null, krippe)
    addChild(db, krippe, { birthDate: '2022-10-14' })
    addChild(db, 1, { birthDate: '2022-10-20', groupId: baeren })
    addHelpOut(db, anna, krippe, 2026, 10)
    releaseMonth(db, admin, 1, 2026, 10)
    releaseMonth(db, leitungB, krippe, 2026, 10)
    const mine = getMyPlan(db, observer, 2026, 10, today)
    expect(day(mine.days, '2026-10-14')).toEqual([])
    expect(day(mine.days, '2026-10-20')).toEqual(['Kindergeburtstag (Bären)'])
  })
})
