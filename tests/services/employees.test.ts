import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import {
  addAdjustment, addHours, createEmployee, deleteHours, getEmployee, listEmployees,
  moveEmployee, setEntitlement, updateEmployee,
} from '../../server/services/employees'
import { createTestDb, errorCode } from '../helpers/fixtures'

const today = '2026-10-05'

describe('employees service', () => {
  let db: Db
  beforeEach(() => {
    db = createTestDb()
  })

  it('creates employees with their first weekly hours', () => {
    const id = createEmployee(db, { name: 'Anna', shortName: 'AN', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    expect(listEmployees(db, today)).toEqual([
      { id, name: 'Anna', shortName: 'AN', sortOrder: 1, leftOn: null, currentWeeklyMinutes: 2340 },
    ])
    expect(errorCode(() => createEmployee(db, { name: ' ', shortName: '', weeklyMinutes: 0, validFrom: '2026-01-01' }))).toBe('name_required')
  })
  it('keeps an hours history and never deletes the last period', () => {
    const id = createEmployee(db, { name: 'Anna', shortName: 'AN', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    addHours(db, id, { weeklyMinutes: 1800, validFrom: '2026-10-01' })
    addHours(db, id, { weeklyMinutes: 1950, validFrom: '2026-10-01' })
    const detail = getEmployee(db, id, today)
    expect(detail.hours.map(h => [h.validFrom, h.weeklyMinutes])).toEqual([['2026-01-01', 2340], ['2026-10-01', 1950]])
    expect(detail.currentWeeklyMinutes).toBe(1950)
    deleteHours(db, detail.hours[1]!.id)
    expect(errorCode(() => deleteHours(db, detail.hours[0]!.id))).toBe('last_hours')
  })
  it('reorders employees', () => {
    const anna = createEmployee(db, { name: 'Anna', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    createEmployee(db, { name: 'Ben', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    moveEmployee(db, anna, 'down')
    expect(listEmployees(db, today).map(e => e.name)).toEqual(['Ben', 'Anna'])
    moveEmployee(db, anna, 'down')
    expect(listEmployees(db, today).map(e => e.name)).toEqual(['Ben', 'Anna'])
  })
  it('updates master data, adjustments and entitlements', () => {
    const id = createEmployee(db, { name: 'Anna', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    updateEmployee(db, id, { name: 'Anna B.', shortName: 'AB', leftOn: '2026-12-31' })
    addAdjustment(db, id, { date: '2026-01-01', minutes: 750, reason: 'Übertrag' })
    setEntitlement(db, id, 2026, { days: 30, carriedOverDays: 2 })
    setEntitlement(db, id, 2026, { days: 30, carriedOverDays: 3 })
    const detail = getEmployee(db, id, today)
    expect(detail).toMatchObject({ name: 'Anna B.', shortName: 'AB', leftOn: '2026-12-31' })
    expect(detail.adjustments).toMatchObject([{ date: '2026-01-01', minutes: 750, reason: 'Übertrag' }])
    expect(detail.entitlements).toMatchObject([{ year: 2026, days: 30, carriedOverDays: 3 }])
    expect(errorCode(() => getEmployee(db, 999, today))).toBe('employee_not_found')
  })
})
