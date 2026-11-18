import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { getBalanceOverview } from '../../server/services/balances'
import { createClosure } from '../../server/services/closures'
import { addAdjustment, getEmployee, setBalanceFrom } from '../../server/services/employees'
import { getLeaveAccount } from '../../server/services/leave'
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
