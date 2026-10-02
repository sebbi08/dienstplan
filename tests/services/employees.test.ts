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
      { id, name: 'Anna', shortName: 'AN', sortOrder: 1, leftOn: null, currentWeeklyMinutes: 2340, currentWorkdays: 0b11111 },
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

describe('creating an employee with working days, leave and opening balance', () => {
  let db: Db
  beforeEach(() => {
    db = createTestDb()
  })

  it('stores working days, leave entitlement, carried-over leave and existing overtime', () => {
    const id = createEmployee(db, {
      name: 'Clara', shortName: 'CL', weeklyMinutes: 1200, validFrom: '2026-10-01',
      workdays: 0b00111, vacationDays: 18, carriedOverDays: 2.5, openingBalanceMinutes: -90,
    })
    const employee = getEmployee(db, id, '2026-10-05')
    expect(employee.hours).toEqual([{ id: expect.any(Number), weeklyMinutes: 1200, validFrom: '2026-10-01', workdays: 0b00111 }])
    expect(employee.currentWorkdays).toBe(0b00111)
    expect(employee.entitlements).toEqual([{ id: expect.any(Number), year: 2026, days: 18, carriedOverDays: 2.5 }])
    expect(employee.adjustments).toEqual([{ id: expect.any(Number), date: '2026-10-01', minutes: -90, reason: 'Übertrag bei Anlage' }])
  })
  it('creates nothing extra when no leave or balance is given and defaults to Monday–Friday', () => {
    const id = createEmployee(db, { name: 'Dora', shortName: '', weeklyMinutes: 2340, validFrom: '2026-10-01' })
    const employee = getEmployee(db, id, '2026-10-05')
    expect(employee.hours[0]!.workdays).toBe(0b11111)
    expect(employee.entitlements).toEqual([])
    expect(employee.adjustments).toEqual([])
  })
  it('requires at least one working day and keeps them for later hours periods', () => {
    expect(errorCode(() => createEmployee(db, { name: 'Eva', shortName: '', weeklyMinutes: 2340, validFrom: '2026-10-01', workdays: 0 })))
      .toBe('workdays_required')
    const id = createEmployee(db, { name: 'Eva', shortName: '', weeklyMinutes: 2340, validFrom: '2026-10-01' })
    addHours(db, id, { weeklyMinutes: 1560, validFrom: '2027-01-01', workdays: 0b01111 })
    expect(getEmployee(db, id, '2027-01-04').hours.map(h => h.workdays)).toEqual([0b11111, 0b01111])
  })
})
