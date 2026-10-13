import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { earlySickLeaves } from '../../server/db/schema'
import { ServiceError } from '../../server/lib/errors'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { getBalanceOverview } from '../../server/services/balances'
import { getSickYear } from '../../server/services/calendar'
import { deleteEarlySickLeave, listEarlySickLeaves, saveEarlySickLeave } from '../../server/services/earlySickLeaves'
import { moveEmployeeToFacility, setStampingOptions } from '../../server/services/employees'
import { applyToCells, deleteEntry } from '../../server/services/entries'
import { getMyTime } from '../../server/services/myTime'
import { listNotifications } from '../../server/services/notifications'
import { getMonthPlan, getMyPlan } from '../../server/services/plan'
import { loadEntries } from '../../server/services/queries'
import { loadReleases, releaseMonth } from '../../server/services/release'
import { revertToRelease } from '../../server/services/revert'
import { actualTimeFor, createRecord, getTimeMonth, stamp } from '../../server/services/timeTracking'
import { cellKey } from '../../shared/domain/cells'
import type { EntryInput, SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addHelpOut, addUser, codeId, createTestDb, errorCode, templateId } from '../helpers/fixtures'

// 2026-10-06 is a Tuesday; "now" is Thursday 08.10. at 12:00 in Berlin.
const tuesday = '2026-10-06'
const wednesday = '2026-10-07'
const today = '2026-10-08'
const NOW = new Date('2026-10-08T10:00:00Z')
/** F2: 7:30–15:45 with a 30-minute break. */
const F2_MINUTES = 465

/** The ServiceError thrown by fn as [status, code], or null. */
function refusal(fn: () => unknown): [number, string] | null {
  try {
    fn()
    return null
  }
  catch (error) {
    if (error instanceof ServiceError) return [error.statusCode, error.code]
    throw error
  }
}

describe('falling ill during duty (Im Dienst erkrankt)', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  let ben: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
    ben = addEmployee(db, 'Ben')
  })

  const enter = (employeeId: number, date: string, entry: EntryInput, actor = admin, facilityId = 1) =>
    applyToCells(db, actor, facilityId, [{ employeeId, date }], 'replace', entry)
  const f2 = (employeeId: number, date: string) => enter(employeeId, date, { kind: 'shift', templateId: templateId(db, 'F2') })
  const absence = (employeeId: number, date: string, key: string) => enter(employeeId, date, { kind: 'code', codeId: codeId(db, key) })
  const mark = (employeeId: number, date: string, leftAt: number | null = null, note?: string, actor = admin, facilityId = 1) =>
    saveEarlySickLeave(db, actor, facilityId, { employeeId, date, leftAt, note }, NOW)
  const stored = () => db.select().from(earlySickLeaves).all()
  const record = (employeeId: number, date: string, start: number, end: number) =>
    createRecord(db, admin, 1, { employeeId, date, start, end }, NOW)
  const timeDay = (employeeId: number, date: string) =>
    getTimeMonth(db, 1, employeeId, 2026, 10, today).days.find(day => day.date === date)!
  const adminPlan = () => getMonthPlan(db, admin, 1, 2026, 10, today).admin!

  describe('credit with time tracking', () => {
    beforeEach(() => {
      setTimeTrackingFrom(db, 1, '2026-10-01')
      f2(anna, tuesday)
      f2(anna, wednesday)
      record(anna, tuesday, 450, 680) // 3:50, went home ill
      record(anna, wednesday, 450, 700) // 4:10, not marked
    })
    const weekCredit = () => adminPlan().weeks.find(week => week.weekStart === '2026-10-05')!
      .totals.find(total => total.employeeId === anna)!.credit
    const balance = () => getBalanceOverview(db, 1, 2026, 10, today).find(row => row.employeeId === anna)!

    it('credits the planned time of the marked day although less was stamped', () => {
      expect(timeDay(anna, tuesday)).toMatchObject({ counted: 230, recordedMinutes: 230, plannedMinutes: F2_MINUTES, sickLeave: null })
      mark(anna, tuesday)
      expect(timeDay(anna, tuesday)).toMatchObject({ counted: F2_MINUTES, recordedMinutes: 230, plannedMinutes: F2_MINUTES, usesRecords: true })
      expect(timeDay(anna, tuesday).records.map(r => [r.start, r.end])).toEqual([[450, 680]]) // the stamped times stay
      expect(actualTimeFor(db, 1, today)(anna)!.plannedDates).toEqual(new Set([tuesday]))
    })
    it('leaves unmarked days and other employees unchanged', () => {
      f2(ben, tuesday)
      record(ben, tuesday, 450, 600)
      mark(anna, tuesday)
      expect(timeDay(anna, wednesday).counted).toBe(250)
      expect(timeDay(ben, tuesday).counted).toBe(150)
      expect(actualTimeFor(db, 1, today)(ben)!.plannedDates ?? new Set()).toEqual(new Set())
    })
    it('lets balances and week totals follow', () => {
      const before = { week: weekCredit(), balance: balance() }
      expect(before.week).toBe(230 + 250)
      mark(anna, tuesday)
      expect(weekCredit()).toBe(F2_MINUTES + 250)
      expect(balance().today).toBe(before.balance.today + (F2_MINUTES - 230))
      expect(balance().monthEnd).toBe(before.balance.monthEnd + (F2_MINUTES - 230))
      deleteEarlySickLeave(db, 1, stored()[0]!.id)
      expect({ week: weekCredit(), balance: balance() }).toEqual(before)
    })
    it('credits the planned time also when nothing was stamped at all', () => {
      f2(ben, tuesday)
      mark(ben, tuesday, 600)
      expect(timeDay(ben, tuesday)).toMatchObject({ counted: F2_MINUTES, recordedMinutes: 0 })
    })
    it('never credits less than was stamped: the larger of planned and stamped time counts', () => {
      enter(ben, tuesday, { kind: 'special', start: 600, end: 720 }) // 2:00 planned
      record(ben, tuesday, 420, 720) // came early: 5:00 stamped
      const balanceOf = () => getBalanceOverview(db, 1, 2026, 10, today).find(row => row.employeeId === ben)!.today
      const before = balanceOf()
      expect(timeDay(ben, tuesday).counted).toBe(300)
      mark(ben, tuesday)
      expect(timeDay(ben, tuesday)).toMatchObject({ counted: 300, recordedMinutes: 300, plannedMinutes: 120 })
      expect(balanceOf()).toBe(before)
      expect(adminPlan().weeks.find(week => week.weekStart === '2026-10-05')!.totals.find(total => total.employeeId === ben)!.credit).toBe(300)
      // Still no deviation flag and no time hints on the marked day.
      expect(adminPlan().actuals[cellKey(ben, tuesday)]).toMatchObject({ minutes: 300, deviates: false })
    })
    it('compares the plan with the credited time of someone whose breaks are deducted automatically', () => {
      setStampingOptions(db, 1, ben, { stampVia: 'both', breakMode: 'auto' })
      f2(ben, tuesday)
      record(ben, tuesday, 450, 680) // 3:50 stamped, minus the planned break of 0:30
      expect(timeDay(ben, tuesday).counted).toBe(200)
      mark(ben, tuesday)
      expect(timeDay(ben, tuesday)).toMatchObject({ counted: F2_MINUTES, recordedMinutes: 230 })
      // Stamped longer than planned: the stamped time counts, with the legal break deducted as on any other day.
      enter(ben, wednesday, { kind: 'special', start: 600, end: 720 })
      record(ben, wednesday, 420, 840) // 7:00 stamped, no break planned: 0:30 deducted
      expect(timeDay(ben, wednesday).counted).toBe(390)
      mark(ben, wednesday)
      expect(timeDay(ben, wednesday)).toMatchObject({ counted: 390, plannedMinutes: 120 })
    })
    it('switches off time warnings and the deviation flag on the marked day', () => {
      f2(ben, tuesday) // no record: "keine Stempelzeit"
      stamp(db, ben, 'in', 'terminal', new Date('2026-10-07T05:30:00Z')) // Wednesday, never clocked out, no plan
      const timeTypes = ['open_record', 'missing_record', 'break_rule', 'record_without_plan']
      const timeWarningsOf = (employeeId: number, date: string) => adminPlan().warnings
        .filter(w => timeTypes.includes(w.type) && w.date === date && 'employeeId' in w && w.employeeId === employeeId).map(w => w.type)
      expect(adminPlan().actuals[cellKey(anna, tuesday)]).toMatchObject({ minutes: 230, deviates: true })
      expect(timeWarningsOf(ben, tuesday)).toEqual(['missing_record'])
      expect(timeDay(ben, tuesday).warnings.map(w => w.type)).toEqual(['missing_record'])

      mark(anna, tuesday)
      mark(ben, tuesday)
      expect(adminPlan().actuals[cellKey(anna, tuesday)]).toMatchObject({ minutes: 230, deviates: false })
      expect(timeWarningsOf(ben, tuesday)).toEqual([])
      expect(timeDay(ben, tuesday).warnings).toEqual([])
      expect(timeDay(anna, tuesday).warnings).toEqual([])
      // Other days keep their hints and their flag.
      expect(adminPlan().actuals[cellKey(anna, wednesday)]).toMatchObject({ minutes: 250, deviates: true })
      expect(timeWarningsOf(ben, wednesday)).toContain('open_record')
    })
    it('hides the break hint of a marked day', () => {
      f2(ben, tuesday)
      record(ben, tuesday, 450, 900) // 7:30 h without a break
      expect(timeDay(ben, tuesday).warnings.map(w => w.type)).toEqual(['break_rule'])
      mark(ben, tuesday)
      expect(timeDay(ben, tuesday).warnings).toEqual([])
      expect(adminPlan().warnings.filter(w => w.type === 'break_rule')).toEqual([])
    })
  })

  it('is no sick day: the sick-day statistics stay as they are', () => {
    f2(anna, tuesday)
    absence(ben, tuesday, 'sick')
    const before = getSickYear(db, 1, 2026)
    mark(anna, tuesday, 680, 'Migräne')
    expect(getSickYear(db, 1, 2026)).toEqual(before)
    expect(before.map(row => [row.name, row.total])).toEqual([['Anna', 0], ['Ben', 1]])
    // The duty stays in the plan as it was.
    expect(loadEntries(db, { employeeId: anna, from: tuesday, to: tuesday })).toMatchObject([{ kind: 'shift', shortLabel: 'F2' }])
  })

  describe('refusals', () => {
    it('needs planned working time on that day', () => {
      expect(refusal(() => mark(anna, tuesday))).toEqual([400, 'no_duty_planned'])
      enter(anna, tuesday, { kind: 'code', codeId: codeId(db, 'other') }) // "sonstiges": no working time
      expect(refusal(() => mark(anna, tuesday))).toEqual([400, 'no_duty_planned'])
      expect(stored()).toEqual([])
    })
    it('refuses a day with a full-day absence', () => {
      for (const key of ['sick', 'vacation', 'training']) {
        absence(anna, tuesday, key)
        expect(refusal(() => mark(anna, tuesday)), key).toEqual([400, 'no_duty_planned'])
      }
      expect(stored()).toEqual([])
    })
    it('accepts shifts, special shifts, VZ and Büro', () => {
      f2(anna, '2026-10-05')
      enter(anna, tuesday, { kind: 'special', start: 600, end: 720 })
      enter(anna, wednesday, { kind: 'code', codeId: codeId(db, 'prep_time'), start: 480, end: 600 })
      enter(anna, today, { kind: 'code', codeId: codeId(db, 'office'), start: 480, end: 600 })
      for (const date of ['2026-10-05', tuesday, wednesday, today]) mark(anna, date)
      expect(stored().map(row => row.date)).toEqual(['2026-10-05', tuesday, wednesday, today])
    })
    it('refuses a date in the future but accepts today', () => {
      f2(anna, today)
      f2(anna, '2026-10-09')
      expect(refusal(() => mark(anna, '2026-10-09'))).toEqual([400, 'date_in_future'])
      expect(stored()).toEqual([])
      mark(anna, today)
      expect(stored()).toHaveLength(1)
    })
    it('refuses an invalid time of leaving', () => {
      f2(anna, tuesday)
      for (const leftAt of [-1, 1440, 680.5, Number.NaN]) {
        expect(refusal(() => mark(anna, tuesday, leftAt)), String(leftAt)).toEqual([400, 'invalid_time'])
      }
      expect(stored()).toEqual([])
      mark(anna, tuesday, 0)
      mark(anna, tuesday, 1439)
      expect(stored().map(row => row.leftAt)).toEqual([1439])
    })
    it('answers 404 for unknown employees and marker ids', () => {
      expect(refusal(() => mark(999, tuesday))).toEqual([404, 'employee_not_found'])
      expect(refusal(() => deleteEarlySickLeave(db, 1, 999))).toEqual([404, 'early_sick_leave_not_found'])
    })
  })

  describe('saving and deleting', () => {
    beforeEach(() => f2(anna, tuesday))

    it('stores who marked it and when', () => {
      mark(anna, tuesday, 680, '  Migräne  ')
      expect(stored()).toEqual([{
        id: expect.any(Number), employeeId: anna, date: tuesday, leftAt: 680, note: 'Migräne',
        createdAt: NOW.toISOString(), createdBy: admin.id,
      }])
    })
    it('replaces time and note on the second save: one marker per person and day', () => {
      mark(anna, tuesday, 680, 'Migräne')
      const [first] = stored()
      mark(anna, tuesday, 700, '')
      expect(stored()).toEqual([{ ...first, leftAt: 700, note: null }])
      mark(anna, tuesday, null, 'Kreislauf')
      expect(stored()).toMatchObject([{ id: first!.id, leftAt: null, note: 'Kreislauf' }])
    })
    it('deletes the marker', () => {
      mark(anna, tuesday)
      deleteEarlySickLeave(db, 1, stored()[0]!.id)
      expect(stored()).toEqual([])
      expect(listEarlySickLeaves(db, 1, 2026)).toEqual({ rows: [], totals: [] })
    })
  })

  describe('time of leaving', () => {
    beforeEach(() => {
      setTimeTrackingFrom(db, 1, '2026-10-01')
      f2(anna, tuesday)
    })
    const row = () => listEarlySickLeaves(db, 1, 2026).rows[0]!

    it('is the entered time', () => {
      record(anna, tuesday, 450, 680)
      mark(anna, tuesday, 675)
      expect(row()).toMatchObject({ leftAt: 675, leftAtFromRecord: false })
      expect(timeDay(anna, tuesday).sickLeave).toMatchObject({ leftAt: 675, leftAtFromRecord: false })
      expect(adminPlan().sickLeaves[cellKey(anna, tuesday)]).toMatchObject({ leftAt: 675, leftAtFromRecord: false })
    })
    it('falls back to the end of the last closed time record', () => {
      record(anna, tuesday, 450, 600)
      record(anna, tuesday, 615, 683)
      mark(anna, tuesday)
      expect(row()).toMatchObject({ leftAt: 683, leftAtFromRecord: true })
      expect(timeDay(anna, tuesday).sickLeave).toMatchObject({ leftAt: 683, leftAtFromRecord: true })
      expect(adminPlan().sickLeaves[cellKey(anna, tuesday)]).toMatchObject({ leftAt: 683, leftAtFromRecord: true })
    })
    it('is unknown without an entered time and without a closed record', () => {
      mark(anna, tuesday)
      expect(row()).toMatchObject({ leftAt: null, leftAtFromRecord: false })
      stamp(db, anna, 'in', 'terminal', new Date('2026-10-06T05:30:00Z')) // still open
      expect(row()).toMatchObject({ leftAt: null, leftAtFromRecord: false })
      expect(timeDay(anna, tuesday).sickLeave).toMatchObject({ leftAt: null, leftAtFromRecord: false })
    })
  })

  describe('stale markers', () => {
    const cell = () => [{ employeeId: anna, date: tuesday }]
    beforeEach(() => {
      f2(anna, tuesday)
      f2(ben, tuesday)
      mark(anna, tuesday, 680)
      mark(ben, tuesday)
    })
    const markedIds = () => stored().map(row => row.employeeId)

    it('goes when the cell is cleared', () => {
      applyToCells(db, admin, 1, cell(), 'clear', null)
      expect(markedIds()).toEqual([ben])
    })
    it('goes when the duty is replaced by "Krank" or another full-day absence', () => {
      absence(anna, tuesday, 'sick')
      expect(markedIds()).toEqual([ben])
      absence(ben, tuesday, 'vacation')
      expect(markedIds()).toEqual([])
    })
    it('goes when an absence is added next to the duty', () => {
      applyToCells(db, admin, 1, cell(), 'add', { kind: 'code', codeId: codeId(db, 'sick') })
      expect(markedIds()).toEqual([ben])
    })
    it('goes when the only duty of the day is removed', () => {
      const [entry] = loadEntries(db, { employeeId: anna, from: tuesday, to: tuesday })
      deleteEntry(db, admin, 1, entry!.id)
      expect(markedIds()).toEqual([ben])
    })
    it('stays while the day keeps working time', () => {
      enter(anna, tuesday, { kind: 'shift', templateId: templateId(db, 'S') }) // another shift
      applyToCells(db, admin, 1, cell(), 'add', { kind: 'code', codeId: codeId(db, 'prep_time'), start: 1020, end: 1080 })
      applyToCells(db, admin, 1, cell(), 'add', { kind: 'break', start: 600, end: 615 })
      const vz = loadEntries(db, { employeeId: anna, from: tuesday, to: tuesday }).find(entry => entry.codeKey === 'prep_time')!
      deleteEntry(db, admin, 1, vz.id) // the shift is still there
      expect(markedIds()).toEqual([anna, ben])
      expect(stored()[0]).toMatchObject({ leftAt: 680 })
    })
    it('goes when the changes are discarded back to an empty cell, and stays when a duty comes back', () => {
      // Released: Anna has F2 on Tuesday, Wednesday is empty.
      releaseMonth(db, admin, 1, 2026, 10, new Date('2026-09-25T10:00:00Z'))
      f2(anna, wednesday)
      mark(anna, wednesday)
      enter(anna, tuesday, { kind: 'shift', templateId: templateId(db, 'S') })
      expect(stored().filter(row => row.employeeId === anna).map(row => row.date)).toEqual([tuesday, wednesday])
      revertToRelease(db, admin, 1, 2026, 10, [cellKey(anna, tuesday), cellKey(anna, wednesday)])
      expect(stored().filter(row => row.employeeId === anna).map(row => row.date)).toEqual([tuesday])
    })
    it('goes when the changes are discarded back to an absence', () => {
      absence(anna, wednesday, 'sick')
      releaseMonth(db, admin, 1, 2026, 10, new Date('2026-09-25T10:00:00Z'))
      f2(anna, wednesday)
      mark(anna, wednesday)
      revertToRelease(db, admin, 1, 2026, 10, [cellKey(anna, wednesday)])
      expect(stored().filter(row => row.employeeId === anna).map(row => row.date)).toEqual([tuesday])
    })
  })

  describe('the list of the sick-days page', () => {
    it('lists the year newest first with the planned duty, and counts per employee', () => {
      setTimeTrackingFrom(db, 1, '2026-10-01')
      f2(anna, tuesday)
      enter(anna, wednesday, { kind: 'code', codeId: codeId(db, 'prep_time'), start: 480, end: 600 })
      applyToCells(db, admin, 1, [{ employeeId: anna, date: wednesday }], 'add', { kind: 'special', start: 600, end: 840 })
      f2(ben, tuesday)
      f2(anna, '2025-12-30')
      record(ben, tuesday, 450, 655)
      mark(anna, tuesday, 680, 'Migräne')
      mark(anna, wednesday)
      mark(ben, tuesday)
      mark(anna, '2025-12-30', 600)
      const list = listEarlySickLeaves(db, 1, 2026)
      expect(list.rows).toEqual([
        { id: expect.any(Number), employeeId: anna, employeeName: 'Anna', date: wednesday, duty: 'VZ 8:00–10:00 + 10:00–14:00', leftAt: null, leftAtFromRecord: false, note: null },
        { id: expect.any(Number), employeeId: anna, employeeName: 'Anna', date: tuesday, duty: 'F2 7:30–15:45', leftAt: 680, leftAtFromRecord: false, note: 'Migräne' },
        { id: expect.any(Number), employeeId: ben, employeeName: 'Ben', date: tuesday, duty: 'F2 7:30–15:45', leftAt: 655, leftAtFromRecord: true, note: null },
      ])
      expect(list.totals).toEqual([
        { employeeId: anna, employeeName: 'Anna', count: 2 }, { employeeId: ben, employeeName: 'Ben', count: 1 },
      ])
      expect(listEarlySickLeaves(db, 1, 2025).rows.map(row => [row.employeeName, row.date])).toEqual([['Anna', '2025-12-30']])
      expect(listEarlySickLeaves(db, 1, 2027)).toEqual({ rows: [], totals: [] })
    })
    it('gives the month plan the markers of its cells', () => {
      f2(anna, tuesday)
      f2(anna, '2026-11-03')
      mark(anna, tuesday, 680, 'Migräne')
      expect(adminPlan().sickLeaves).toEqual({
        [cellKey(anna, tuesday)]: { id: stored()[0]!.id, leftAt: 680, leftAtFromRecord: false, note: 'Migräne' },
      })
      expect(getMonthPlan(db, admin, 1, 2026, 11, today).admin!.sickLeaves).toEqual({})
    })
  })

  describe('several facilities', () => {
    let krippe: number
    let leitungB: SessionUser
    let provider: SessionUser
    beforeEach(() => {
      krippe = addFacility(db, 'Krippe')
      leitungB = addUser(db, 'leitung-b', 'admin', null, krippe)
      provider = addUser(db, 'traeger', 'provider')
      f2(anna, tuesday)
    })

    it('shows another facility no rows and lets it neither mark nor delete', () => {
      mark(anna, tuesday, 680)
      const [row] = stored()
      expect(listEarlySickLeaves(db, krippe, 2026)).toEqual({ rows: [], totals: [] })
      expect(getMonthPlan(db, leitungB, krippe, 2026, 10, today).admin!.sickLeaves).toEqual({})
      expect(refusal(() => deleteEarlySickLeave(db, krippe, row!.id))).toEqual([404, 'early_sick_leave_not_found'])
      expect(refusal(() => mark(anna, tuesday, 700, 'fremd', leitungB, krippe))).toEqual([404, 'employee_not_found'])
      expect(stored()).toEqual([row])
      expect(errorCode(() => getTimeMonth(db, krippe, anna, 2026, 10, today))).toBe('employee_not_found')
    })
    it('lets the home facility mark a day of helping out elsewhere, and only the home facility', () => {
      addHelpOut(db, anna, krippe, 2026, 10)
      const shiftB = { kind: 'shift' as const, templateId: templateId(db, 'F1', krippe) }
      enter(anna, wednesday, shiftB, leitungB, krippe)
      expect(refusal(() => mark(anna, wednesday, 600, undefined, leitungB, krippe))).toEqual([404, 'employee_not_found'])
      // With time tracking at home, the short stamped time of the help-out day counts until the day is marked.
      setTimeTrackingFrom(db, 1, '2026-10-01')
      record(anna, wednesday, 420, 600)
      const balanceBefore = getBalanceOverview(db, 1, 2026, 10, today).find(row => row.employeeId === anna)!.today
      expect(timeDay(anna, wednesday)).toMatchObject({ counted: 180, plannedMinutes: 375, plannedDuty: true })
      mark(anna, wednesday, 600)
      expect(timeDay(anna, wednesday)).toMatchObject({ counted: 375, recordedMinutes: 180, warnings: [] })
      expect(getBalanceOverview(db, 1, 2026, 10, today).find(row => row.employeeId === anna)!.today).toBe(balanceBefore + 195)
      expect(listEarlySickLeaves(db, 1, 2026).rows).toMatchObject([{ date: wednesday, duty: '7:00–13:15', leftAt: 600 }])
      expect(adminPlan().sickLeaves[cellKey(anna, wednesday)]).toMatchObject({ leftAt: 600 })
      // The plan Anna helps in learns nothing of it.
      expect(getMonthPlan(db, leitungB, krippe, 2026, 10, today).admin!.sickLeaves).toEqual({})
      // The other facility clears the help-out: the day has no working time any more.
      applyToCells(db, leitungB, krippe, [{ employeeId: anna, date: wednesday }], 'clear', null)
      expect(stored()).toEqual([])
    })
    it('keeps the markers when the employee moves: they belong to the person', () => {
      mark(anna, tuesday, 680, 'Migräne')
      moveEmployeeToFacility(db, provider, anna, krippe, NOW)
      expect(stored()).toMatchObject([{ employeeId: anna, date: tuesday, leftAt: 680, note: 'Migräne' }])
      expect(listEarlySickLeaves(db, 1, 2026).rows).toEqual([])
      expect(listEarlySickLeaves(db, krippe, 2026).rows).toMatchObject([{ employeeName: 'Anna', date: tuesday, leftAt: 680 }])
      expect(refusal(() => deleteEarlySickLeave(db, 1, stored()[0]!.id))).toEqual([404, 'early_sick_leave_not_found'])
      deleteEarlySickLeave(db, krippe, stored()[0]!.id)
      expect(stored()).toEqual([])
    })
  })

  describe('not part of releases', () => {
    it('keeps the marker out of snapshots, pending changes, messages, the observer plan, "Mein Dienstplan" and the own times', () => {
      const observer = addUser(db, 'anna', 'observer', anna)
      f2(anna, tuesday)
      releaseMonth(db, admin, 1, 2026, 10, new Date('2026-09-25T10:00:00Z'))
      mark(anna, tuesday, 680, 'Migräne')
      // Marking is no change of the plan.
      expect(adminPlan().pendingChanges).toEqual({})
      // A changed duty gives Anna a message with the next release; its marker is no part of it.
      f2(anna, wednesday)
      mark(anna, wednesday, 700, 'Kreislauf')
      releaseMonth(db, admin, 1, 2026, 10, new Date('2026-10-08T11:00:00Z'))

      const leak = /sickLeave|leftAt|Migräne|Kreislauf|erkrankt|early/i
      const messages = listNotifications(db, anna, NOW)
      expect(messages).toHaveLength(1)
      expect(messages[0]!.changes.map(change => change.date)).toEqual([wednesday])
      expect(JSON.stringify(messages)).not.toMatch(leak)
      expect(JSON.stringify(getMyTime(db, observer, 2026, 10, NOW))).not.toMatch(leak)
      const snapshot = loadReleases(db, 1, 2026, 10).at(-1)!.data
      expect(Object.keys(snapshot).sort()).toEqual(['days', 'employees', 'entries', 'groups'])
      expect(JSON.stringify(snapshot)).not.toMatch(leak)

      const observerPlan = getMonthPlan(db, observer, 1, 2026, 10, today)
      expect(observerPlan.admin).toBeNull()
      expect(JSON.stringify(observerPlan)).not.toMatch(leak)
      expect(observerPlan.entries).toEqual(getMonthPlan(db, admin, 1, 2026, 10, today).entries)

      const myPlan = getMyPlan(db, observer, 2026, 10, today)
      expect(JSON.stringify(myPlan)).not.toMatch(leak)
      expect(myPlan.days.find(day => day.date === tuesday)!.entries).toMatchObject([{ kind: 'shift', shortLabel: 'F2' }])
      expect(myPlan.days.find(day => day.date === tuesday)!.changes).toEqual([])
    })
  })
})
