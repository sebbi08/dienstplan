import { and, eq, gte } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { changeLog, employeeHours, entries, facilities } from '../../server/db/schema'
import { createClosure } from '../../server/services/closures'
import { setEntitlement } from '../../server/services/employees'
import { applyToCells } from '../../server/services/entries'
import { getLeaveAccount } from '../../server/services/leave'
import { enterLeave, removeLeave } from '../../server/services/leaveEntries'
import { loadEntries } from '../../server/services/queries'
import { releaseMonth } from '../../server/services/release'
import type { LeaveEntryKind, SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addHelpOut, addUser, codeId, createTestDb, templateId } from '../helpers/fixtures'

const today = '2026-11-19'
const now = new Date('2026-11-19T10:00:00Z')

function failure(fn: () => unknown): { code: string; status: number; details?: Record<string, unknown> } | null {
  try {
    fn()
    return null
  }
  catch (error) {
    const { code, statusCode, details } = error as { code: string; statusCode: number; details?: Record<string, unknown> }
    return { code, status: statusCode, details }
  }
}

describe('leave entered for an employee (Urlaub eintragen / entfernen)', () => {
  let db: Db
  let provider: SessionUser
  let leitung: SessionUser
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    provider = addUser(db, 'traeger', 'provider')
    leitung = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
  })
  const enter = (employeeId: number, from: string, to: string, kind: LeaveEntryKind = 'vacation', overwrite = false, actor = leitung) =>
    enterLeave(db, actor, 1, employeeId, { from, to, kind, overwrite }, now)
  const remove = (employeeId: number, from: string, to: string, kind: LeaveEntryKind = 'vacation', actor = leitung) =>
    removeLeave(db, actor, 1, employeeId, { from, to, kind }, now)
  const days = (employeeId: number) => loadEntries(db, { employeeId }).map(entry => [entry.date, entry.codeKey])

  it('books only the employee\'s working days: no weekends, holidays, closure days or a part-timer\'s days off', () => {
    // Mo 2.11. – So 8.11.: five working days
    expect(enter(anna, '2026-11-02', '2026-11-08')).toEqual({ booked: 5, keptAbsences: 0 })
    expect(days(anna).map(([date]) => date)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'])

    // Works Monday and Wednesday only.
    const paula = addEmployee(db, 'Paula', { weeklyHours: 15 })
    db.update(employeeHours).set({ workdays: 0b0000101 }).where(eq(employeeHours.employeeId, paula)).run()
    expect(enter(paula, '2026-11-02', '2026-11-08')).toEqual({ booked: 2, keptAbsences: 0 })
    expect(days(paula)).toEqual([['2026-11-02', 'vacation'], ['2026-11-04', 'vacation']])

    // A closure keeps its own bookings; only the days after it are booked.
    createClosure(db, provider, 1, { startDate: '2026-11-16', endDate: '2026-11-18', label: 'Fortbildungstage', mode: 'vacation' })
    expect(enter(anna, '2026-11-16', '2026-11-20')).toEqual({ booked: 2, keptAbsences: 0 })
    const closureLinked = db.select().from(entries).where(and(eq(entries.employeeId, anna), gte(entries.date, '2026-11-16'))).all()
      .map(entry => [entry.date, entry.closureId !== null]).sort()
    expect(closureLinked).toEqual([
      ['2026-11-16', true], ['2026-11-17', true], ['2026-11-18', true], ['2026-11-19', false], ['2026-11-20', false],
    ])
  })

  it('books past days too (1 May is a holiday) and the leave account counts them', () => {
    setEntitlement(db, 1, anna, 2026, { days: 30, carriedOverDays: 0 })
    expect(enter(anna, '2026-04-27', '2026-05-03')).toEqual({ booked: 4, keptAbsences: 0 })
    const account = getLeaveAccount(db, anna, 2026, today)
    expect(account.account).toMatchObject({ taken: 4, planned: 0, available: 26 })
    expect(account.entryRanges).toEqual([{ kind: 'vacation', from: '2026-04-27', to: '2026-04-30', days: 4 }])
  })

  it('refuses ranges before the employment, reversed, longer than a year or without a working day', () => {
    const carla = addEmployee(db, 'Carla', { validFrom: '2026-10-08' })
    expect(failure(() => enter(carla, '2026-10-01', '2026-10-09'))).toMatchObject({ status: 400, code: 'leave_before_employment' })
    expect(failure(() => enter(anna, '2026-11-06', '2026-11-02'))).toMatchObject({ status: 400, code: 'invalid_range' })
    expect(failure(() => enter(anna, '2026-01-01', '2027-01-02'))).toMatchObject({ status: 400, code: 'invalid_range' })
    expect(failure(() => enter(anna, '2026-11-07', '2026-11-08'))).toMatchObject({ status: 400, code: 'no_leave_days' })
    expect(days(carla)).toEqual([])
  })

  it('keeps Krank, Fortbildung and other full-day absences and says how many', () => {
    applyToCells(db, leitung, 1, [{ employeeId: anna, date: '2026-11-03' }], 'replace', { kind: 'code', codeId: codeId(db, 'sick') })
    applyToCells(db, leitung, 1, [{ employeeId: anna, date: '2026-11-04' }], 'replace', { kind: 'code', codeId: codeId(db, 'training') })
    expect(enter(anna, '2026-11-02', '2026-11-05')).toEqual({ booked: 2, keptAbsences: 2 })
    expect(days(anna)).toEqual([
      ['2026-11-02', 'vacation'], ['2026-11-03', 'sick'], ['2026-11-04', 'training'], ['2026-11-05', 'vacation'],
    ])
    // Sonderurlaub keeps planned Urlaub (another full-day absence).
    expect(enter(anna, '2026-11-02', '2026-11-06', 'special_leave')).toEqual({ booked: 1, keptAbsences: 4 })
    expect(days(anna).at(-1)).toEqual(['2026-11-06', 'special_leave'])
  })

  it('asks before replacing duties and writes nothing without the confirmation', () => {
    applyToCells(db, leitung, 1, [{ employeeId: anna, date: '2026-11-04' }], 'replace', { kind: 'shift', templateId: templateId(db, 'M') })
    expect(failure(() => enter(anna, '2026-11-02', '2026-11-06'))).toEqual({
      status: 409, code: 'cells_occupied', details: { days: 1, entries: false },
    })
    expect(days(anna)).toEqual([['2026-11-04', null]])
    expect(enter(anna, '2026-11-02', '2026-11-06', 'overtime_off', true)).toEqual({ booked: 5, keptAbsences: 0 })
    expect(days(anna).map(([, key]) => key)).toEqual(Array(5).fill('overtime_off'))
    // Urlaub over ÜF days: asked too, and the question says „Einträge“ (ÜF is no duty).
    expect(failure(() => enter(anna, '2026-11-05', '2026-11-06'))).toEqual({
      status: 409, code: 'cells_occupied', details: { days: 2, entries: true },
    })
  })

  it('asks before replacing a help-out day and then replaces it, logged in the other facility', () => {
    const krippe = addFacility(db, 'Krippe')
    const leitungB = addUser(db, 'leitung-b', 'admin', null, krippe)
    addHelpOut(db, anna, krippe, 2026, 11)
    releaseMonth(db, leitungB, krippe, 2026, 11, new Date('2026-10-01T10:00:00Z'))
    applyToCells(db, leitungB, krippe, [{ employeeId: anna, date: '2026-11-03' }], 'replace', { kind: 'shift', templateId: templateId(db, 'F1', krippe) })
    expect(failure(() => enter(anna, '2026-11-02', '2026-11-04'))).toMatchObject({ code: 'cells_occupied', details: { days: 1, entries: false } })
    expect(enter(anna, '2026-11-02', '2026-11-04', 'vacation', true)).toEqual({ booked: 3, keptAbsences: 0 })
    expect(loadEntries(db, { employeeId: anna }).map(entry => [entry.date, entry.codeKey, entry.helpFacilityId])).toEqual([
      ['2026-11-02', 'vacation', null], ['2026-11-03', 'vacation', null], ['2026-11-04', 'vacation', null],
    ])
    const logB = db.select().from(changeLog).where(eq(changeLog.facilityId, krippe)).all().filter(row => row.employeeId === anna)
    expect(logB.at(-1)).toMatchObject({ date: '2026-11-03', before: 'F1 7:00–13:15', after: '—', changedBy: leitung.id })
  })

  it('counts 24 and 31 December as half leave days where the facility says so', () => {
    db.update(facilities).set({ christmasEveHalfLeave: true }).where(eq(facilities.id, 1)).run()
    setEntitlement(db, 1, anna, 2026, { days: 30, carriedOverDays: 0 })
    // Mo 21.12. – Do 31.12.: 21.–24. and 28.–31. are working days (25./26. holidays), 24. and 31. count half.
    expect(enter(anna, '2026-12-21', '2026-12-31')).toEqual({ booked: 8, keptAbsences: 0 })
    const account = getLeaveAccount(db, anna, 2026, today)
    expect(account.entryRanges).toEqual([{ kind: 'vacation', from: '2026-12-21', to: '2026-12-31', days: 7 }])
    expect(account.account).toMatchObject({ planned: 7, available: 23 })
    // ÜF counts plain working days.
    remove(anna, '2026-12-21', '2026-12-31')
    enter(anna, '2026-12-24', '2026-12-24', 'overtime_off')
    expect(getLeaveAccount(db, anna, 2026, today).entryRanges).toEqual([{ kind: 'overtime_off', from: '2026-12-24', to: '2026-12-24', days: 1 }])
  })

  it('shows a period over New Year in each year and removes it year by year', () => {
    // Mo 28.12.2026 – Fr 8.1.2027 (1.1. and, in Baden-Württemberg, 6.1. holidays)
    expect(enter(anna, '2026-12-28', '2027-01-08')).toEqual({ booked: 8, keptAbsences: 0 })
    expect(getLeaveAccount(db, anna, 2026, today).entryRanges).toEqual([{ kind: 'vacation', from: '2026-12-28', to: '2026-12-31', days: 4 }])
    expect(getLeaveAccount(db, anna, 2027, today).entryRanges).toEqual([{ kind: 'vacation', from: '2027-01-04', to: '2027-01-08', days: 4 }])
    expect(remove(anna, '2026-12-28', '2026-12-31')).toEqual({ removed: 4, keptClosureDays: 0 })
    expect(days(anna).map(([date]) => date)).toEqual(['2027-01-04', '2027-01-05', '2027-01-07', '2027-01-08'])
  })

  it('leaves days that already hold the same leave as they are', () => {
    enter(anna, '2026-11-02', '2026-11-03')
    const before = loadEntries(db, { employeeId: anna })
    expect(enter(anna, '2026-11-02', '2026-11-04')).toEqual({ booked: 1, keptAbsences: 0 })
    const after = loadEntries(db, { employeeId: anna })
    expect(after.slice(0, 2).map(entry => entry.id)).toEqual(before.map(entry => entry.id))
    expect(enter(anna, '2026-11-02', '2026-11-04')).toEqual({ booked: 0, keptAbsences: 0 })
  })

  it('logs the changes of a released month like other plan edits', () => {
    releaseMonth(db, leitung, 1, 2026, 11, new Date('2026-10-30T10:00:00Z'))
    enter(anna, '2026-11-02', '2026-11-03')
    remove(anna, '2026-11-03', '2026-11-03')
    const log = db.select().from(changeLog).where(eq(changeLog.employeeId, anna)).all()
      .map(row => [row.date, row.before, row.after, row.changedBy])
    expect(log).toEqual([
      ['2026-11-02', '—', 'Urlaub', leitung.id], ['2026-11-03', '—', 'Urlaub', leitung.id], ['2026-11-03', 'Urlaub', '—', leitung.id],
    ])
  })

  it('removes only the leave entries of that kind in the period, never closure bookings, duties or other absences', () => {
    createClosure(db, provider, 1, { startDate: '2026-11-16', endDate: '2026-11-18', label: 'Fortbildungstage', mode: 'vacation' })
    enter(anna, '2026-11-02', '2026-11-06')
    enter(anna, '2026-11-09', '2026-11-10', 'overtime_off')
    enter(anna, '2026-11-19', '2026-11-19')
    applyToCells(db, leitung, 1, [{ employeeId: anna, date: '2026-11-11' }], 'replace', { kind: 'shift', templateId: templateId(db, 'M') })
    applyToCells(db, leitung, 1, [{ employeeId: anna, date: '2026-11-12' }], 'replace', { kind: 'code', codeId: codeId(db, 'sick') })
    expect(getLeaveAccount(db, anna, 2026, today).entryRanges).toEqual([
      { kind: 'vacation', from: '2026-11-02', to: '2026-11-06', days: 5 },
      { kind: 'overtime_off', from: '2026-11-09', to: '2026-11-10', days: 2 },
      { kind: 'vacation', from: '2026-11-19', to: '2026-11-19', days: 1 },
    ])

    expect(remove(anna, '2026-11-01', '2026-11-30')).toEqual({ removed: 6, keptClosureDays: 3 })
    expect(days(anna)).toEqual([
      ['2026-11-09', 'overtime_off'], ['2026-11-10', 'overtime_off'], ['2026-11-11', null], ['2026-11-12', 'sick'],
      ['2026-11-16', 'vacation'], ['2026-11-17', 'vacation'], ['2026-11-18', 'vacation'],
    ])
    expect(remove(anna, '2026-11-09', '2026-11-10', 'overtime_off')).toEqual({ removed: 2, keptClosureDays: 0 })
    expect(getLeaveAccount(db, anna, 2026, today).entryRanges).toEqual([])
    expect(failure(() => remove(anna, '2026-11-10', '2026-11-09'))).toMatchObject({ status: 400, code: 'invalid_range' })
  })

  it('is refused for the own employee (except for the Träger) and for employees of another facility', () => {
    const lena = addEmployee(db, 'Lena')
    const leitungLena = addUser(db, 'leitung-lena', 'admin', lena)
    expect(failure(() => enter(lena, '2026-11-02', '2026-11-03', 'vacation', false, leitungLena))).toMatchObject({ status: 403, code: 'own_leave_entry' })
    expect(failure(() => remove(lena, '2026-11-02', '2026-11-03', 'vacation', leitungLena))).toMatchObject({ status: 403, code: 'own_leave_entry' })
    const staff = addUser(db, 'anna', 'observer', anna)
    expect(failure(() => enter(anna, '2026-11-02', '2026-11-03', 'vacation', false, staff))).toMatchObject({ status: 403, code: 'own_leave_entry' })
    expect(days(lena)).toEqual([])
    // Another Leitung enters it for her.
    expect(enter(lena, '2026-11-02', '2026-11-03').booked).toBe(2)

    // The Träger may enter and remove the own linked employee's leave, as in the own plan row.
    const tom = addEmployee(db, 'Tom')
    const traegerTom = addUser(db, 'traeger-tom', 'provider', tom)
    expect(enter(tom, '2026-11-02', '2026-11-03', 'vacation', false, traegerTom).booked).toBe(2)
    expect(remove(tom, '2026-11-02', '2026-11-03', 'vacation', traegerTom).removed).toBe(2)

    const krippe = addFacility(db, 'Krippe')
    const kurt = addEmployee(db, 'Kurt', { facilityId: krippe })
    expect(failure(() => enter(kurt, '2026-11-02', '2026-11-03'))).toMatchObject({ status: 404, code: 'employee_not_found' })
    expect(failure(() => remove(kurt, '2026-11-02', '2026-11-03'))).toMatchObject({ status: 404, code: 'employee_not_found' })
    expect(days(kurt)).toEqual([])
  })
})
