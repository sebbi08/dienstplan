import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { getBalanceOverview } from '../../server/services/balances'
import { createClosure } from '../../server/services/closures'
import { addAdjustment, getEmployee, setBalanceFrom } from '../../server/services/employees'
import { getLeaveAccount } from '../../server/services/leave'
import { getMonthPlan } from '../../server/services/plan'
import { getTimeMonth } from '../../server/services/timeTracking'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addUser, createTestDb, errorCode } from '../helpers/fixtures'

// 2026-10-05 is a Monday; October has 20 working days from then on (Mo–Fr, 31 October a Saturday).
const daily = 468
const today = '2026-11-18'

describe('„Stundenkonto ab“ (balanceFrom)', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna', { validFrom: '2026-10-05' })
  })
  const octoberEnd = () => getBalanceOverview(db, 1, 2026, 10, today)[0]!.monthEnd

  it('keeps today\'s behaviour when empty: the account starts with the weekly hours', () => {
    expect(octoberEnd()).toBe(-20 * daily)
    expect(getEmployee(db, 1, anna, today, admin.permissions).balanceFrom).toBeNull()
  })

  it('counts target and worked time only from that day on', () => {
    setBalanceFrom(db, 1, anna, '2026-10-19', admin, today)
    expect(getEmployee(db, 1, anna, today, admin.permissions).balanceFrom).toBe('2026-10-19')
    expect(octoberEnd()).toBe(-10 * daily)
    // A date before the weekly hours changes nothing.
    setBalanceFrom(db, 1, anna, '2026-01-01', admin, today)
    expect(octoberEnd()).toBe(-20 * daily)
    setBalanceFrom(db, 1, anna, null, admin, today)
    expect(octoberEnd()).toBe(-20 * daily)
  })

  it('shows no week difference in the plan before it, and the week it starts in only from that day', () => {
    setBalanceFrom(db, 1, anna, '2026-10-21', admin, today)
    const weeks = getMonthPlan(db, admin, 1, 2026, 10, today).admin!.weeks
    const annaWeek = (weekStart: string) => weeks.find(week => week.weekStart === weekStart)!.totals.find(row => row.employeeId === anna)!
    expect(annaWeek('2026-10-05')).toMatchObject({ target: 0, credit: 0, delta: 0 })
    expect(annaWeek('2026-10-12')).toMatchObject({ target: 0, credit: 0, delta: 0 })
    // Wednesday to Friday.
    expect(annaWeek('2026-10-19')).toMatchObject({ target: 3 * daily, delta: -3 * daily })
    expect(annaWeek('2026-10-26')).toMatchObject({ target: 5 * daily, delta: -5 * daily })
    // The weeks add up to the month of the account again.
    expect(weeks.reduce((sum, week) => sum + week.totals.find(row => row.employeeId === anna)!.delta, 0)).toBe(octoberEnd())
  })

  it('leaves the days before it out of the time sheet totals (flag inBalance)', () => {
    setBalanceFrom(db, 1, anna, '2026-10-21', admin, today)
    const days = getTimeMonth(db, 1, anna, 2026, 10, today, 600).days
    expect(days.filter(day => day.target > 0 && !day.inBalance).map(day => day.date)).toEqual([
      '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09',
      '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19', '2026-10-20',
    ])
    const counted = days.filter(day => day.inBalance)
    expect(counted.reduce((sum, day) => sum + day.counted - day.target, 0)).toBe(octoberEnd())
    // Without „Stundenkonto ab“ every day of the employment counts, as before.
    setBalanceFrom(db, 1, anna, null, admin, today)
    expect(getTimeMonth(db, 1, anna, 2026, 10, today, 600).days.filter(day => day.target > 0).every(day => day.inBalance)).toBe(true)
  })

  it('still counts a booking dated before it (a deliberate manual booking)', () => {
    addAdjustment(db, 1, anna, { date: '2026-10-05', minutes: 600, reason: 'Übertrag' })
    setBalanceFrom(db, 1, anna, '2026-10-19', admin, today)
    expect(octoberEnd()).toBe(-10 * daily + 600)
  })

  it('leaves the leave account alone', () => {
    createClosure(db, admin, 1, { startDate: '2026-10-12', endDate: '2026-10-16', label: 'Herbst', mode: 'vacation' })
    setBalanceFrom(db, 1, anna, '2026-10-19', admin, today)
    expect(getLeaveAccount(db, anna, 2026, today).account.taken).toBe(5)
  })

  it('checks the date: a real one, not before 1970, at most a year ahead', () => {
    expect(errorCode(() => setBalanceFrom(db, 1, anna, '2026-02-30', admin, today))).toBe('balance_from_invalid')
    expect(errorCode(() => setBalanceFrom(db, 1, anna, '18.11.2026', admin, today))).toBe('balance_from_invalid')
    expect(errorCode(() => setBalanceFrom(db, 1, anna, '1969-12-31', admin, today))).toBe('balance_from_out_of_range')
    expect(errorCode(() => setBalanceFrom(db, 1, anna, '2027-11-19', admin, today))).toBe('balance_from_out_of_range')
    setBalanceFrom(db, 1, anna, '2027-11-18', admin, today)
    setBalanceFrom(db, 1, anna, '1970-01-01', admin, today)
    expect(getEmployee(db, 1, anna, today, admin.permissions).balanceFrom).toBe('1970-01-01')
  })

  it('refuses the own account of a Mitarbeiter and another facility\'s employee', () => {
    expect(errorCode(() => setBalanceFrom(db, 1, anna, '2026-10-19', { role: 'observer', employeeId: anna }, today))).toBe('own_account')
    const kim = addEmployee(db, 'Kim', { facilityId: addFacility(db, 'Krippe') })
    expect(errorCode(() => setBalanceFrom(db, 1, kim, '2026-10-19', admin, today))).toBe('employee_not_found')
    expect(getEmployee(db, 1, anna, today, admin.permissions).balanceFrom).toBeNull()
  })
})
