import { describe, expect, it } from 'vitest'
import { createEmployee, getEmployee, setEntitlement } from '../../server/services/employees'
import { applyToCells } from '../../server/services/entries'
import { getLeaveAccount } from '../../server/services/leave'
import { previewLeaveRequest, setLeaveModule } from '../../server/services/leaveRequests'
import { addUser, codeId, createTestDb } from '../helpers/fixtures'

const today = '2026-10-05'

describe('leave entitlement and remaining leave carried into later years', () => {
  function setup() {
    const db = createTestDb()
    const admin = addUser(db, 'leitung', 'admin')
    const anna = createEmployee(db, admin, 1, { name: 'Anna', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    const vacation = (dates: string[]) =>
      applyToCells(db, admin, 1, dates.map(date => ({ employeeId: anna, date })), 'replace', { kind: 'code', codeId: codeId(db, 'vacation') })
    return { db, admin, anna, vacation }
  }

  it('uses the last recorded entitlement for years without one', () => {
    const { db, anna } = setup()
    setEntitlement(db, 1, anna, 2026, { days: 30, carriedOverDays: 0 })
    expect(getLeaveAccount(db, anna, 2028, today)).toMatchObject({ account: { entitlement: 30 }, inheritedFrom: 2026 })
    expect(getLeaveAccount(db, anna, 2026, today).inheritedFrom).toBeNull()
  })

  it('takes a changed entitlement from that year on and keeps earlier years', () => {
    const { db, anna } = setup()
    setEntitlement(db, 1, anna, 2026, { days: 30, carriedOverDays: 0 })
    setEntitlement(db, 1, anna, 2028, { days: 28, carriedOverDays: 0 })
    expect(getLeaveAccount(db, anna, 2027, today).account.entitlement).toBe(30)
    expect(getLeaveAccount(db, anna, 2028, today).account.entitlement).toBe(28)
    expect(getLeaveAccount(db, anna, 2030, today)).toMatchObject({ account: { entitlement: 28 }, inheritedFrom: 2028 })
  })

  it('carries the remaining leave of every year into the next one', () => {
    const { db, anna, vacation } = setup()
    setEntitlement(db, 1, anna, 2026, { days: 30, carriedOverDays: 3 }) // the first year keeps the entered carry-over
    vacation(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']) // 5 days
    vacation(['2027-03-01', '2027-03-02']) // 2 days
    expect(getLeaveAccount(db, anna, 2026, today).account).toMatchObject({ carriedOver: 3, available: 28 })
    expect(getLeaveAccount(db, anna, 2027, today).account).toMatchObject({ entitlement: 30, carriedOver: 28, available: 56 })
    expect(getLeaveAccount(db, anna, 2028, today).account).toMatchObject({ carriedOver: 56, available: 86 })
  })

  it('carries a minus too, and ignores carry-overs entered for later years', () => {
    const { db, anna, vacation } = setup()
    setEntitlement(db, 1, anna, 2026, { days: 2, carriedOverDays: 0 })
    setEntitlement(db, 1, anna, 2027, { days: 30, carriedOverDays: 9 })
    vacation(['2026-11-02', '2026-11-03', '2026-11-04']) // 3 days, one more than the entitlement
    expect(getLeaveAccount(db, anna, 2027, today).account).toMatchObject({ carriedOver: -1, available: 29 })
  })

  it('has nothing before the first recorded year', () => {
    const { db, anna } = setup()
    setEntitlement(db, 1, anna, 2026, { days: 30, carriedOverDays: 0 })
    expect(getLeaveAccount(db, anna, 2025, today)).toMatchObject({ account: { entitlement: 0, carriedOver: 0 }, inheritedFrom: null })
  })

  it('shows the carried remaining leave on the employee page', () => {
    const { db, anna, vacation } = setup()
    setEntitlement(db, 1, anna, 2026, { days: 30, carriedOverDays: 3 })
    setEntitlement(db, 1, anna, 2027, { days: 30, carriedOverDays: 0 })
    vacation(['2026-11-02'])
    expect(getEmployee(db, 1, anna, today, 'admin').entitlements).toEqual([
      expect.objectContaining({ year: 2026, days: 30, carriedOverDays: 3, carriedAutomatically: false }),
      expect.objectContaining({ year: 2027, days: 30, carriedOverDays: 32, carriedAutomatically: true }),
    ])
  })

  it('counts the carried entitlement and remaining leave for a leave request', () => {
    const { db, anna } = setup()
    setEntitlement(db, 1, anna, 2026, { days: 30, carriedOverDays: 0 })
    const user = addUser(db, 'anna', 'observer', anna)
    setLeaveModule(db, { enabled: true, plannerIds: [] })
    expect(previewLeaveRequest(db, user, '2027-03-01', '2027-03-05', today).availableAfter).toBe(55)
  })
})
