import { describe, expect, it } from 'vitest'
import { createEmployee, setEntitlement } from '../../server/services/employees'
import { getLeaveAccount } from '../../server/services/leave'
import { previewLeaveRequest, setLeaveModule } from '../../server/services/leaveRequests'
import { addUser, createTestDb } from '../helpers/fixtures'

const today = '2026-10-05'

describe('leave entitlement carried into later years', () => {
  function setup() {
    const db = createTestDb()
    const admin = addUser(db, 'leitung', 'admin')
    const anna = createEmployee(db, admin, 1, { name: 'Anna', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    return { db, admin, anna }
  }

  it('uses the last recorded entitlement for years without one, without carry-over', () => {
    const { db, anna } = setup()
    setEntitlement(db, 1, anna, 2026, { days: 30, carriedOverDays: 3 })
    const later = getLeaveAccount(db, anna, 2028, today)
    expect(later.account).toMatchObject({ entitlement: 30, carriedOver: 0, available: 30 })
    expect(later.inheritedFrom).toBe(2026)
    expect(getLeaveAccount(db, anna, 2026, today).inheritedFrom).toBeNull()
  })

  it('takes a changed entitlement from that year on and keeps earlier years', () => {
    const { db, anna } = setup()
    setEntitlement(db, 1, anna, 2026, { days: 30, carriedOverDays: 0 })
    setEntitlement(db, 1, anna, 2028, { days: 28, carriedOverDays: 1 })
    expect(getLeaveAccount(db, anna, 2027, today).account.entitlement).toBe(30)
    expect(getLeaveAccount(db, anna, 2028, today).account).toMatchObject({ entitlement: 28, carriedOver: 1 })
    expect(getLeaveAccount(db, anna, 2030, today)).toMatchObject({ account: { entitlement: 28, carriedOver: 0 }, inheritedFrom: 2028 })
  })

  it('has no entitlement before the first recorded year', () => {
    const { db, anna } = setup()
    setEntitlement(db, 1, anna, 2026, { days: 30, carriedOverDays: 0 })
    expect(getLeaveAccount(db, anna, 2025, today)).toMatchObject({ account: { entitlement: 0 }, inheritedFrom: null })
  })

  it('counts the carried entitlement for the remaining leave of a request', () => {
    const { db, anna } = setup()
    setEntitlement(db, 1, anna, 2026, { days: 30, carriedOverDays: 0 })
    const user = addUser(db, 'anna', 'observer', anna)
    setLeaveModule(db, { enabled: true, plannerIds: [] })
    expect(previewLeaveRequest(db, user, '2027-03-01', '2027-03-05', today).availableAfter).toBe(25)
  })
})
