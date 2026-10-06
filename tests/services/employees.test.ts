import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { getAppSettings, setContractVisibleToAdmins } from '../../server/services/appSettings'
import {
  addAdjustment, addHours, createEmployee, deleteHours, getEmployee, listEmployees, listLevelUps,
  moveEmployee, setContract, setEntitlement, updateEmployee,
} from '../../server/services/employees'
import type { SessionUser } from '../../shared/types/api'
import { addUser, createTestDb, errorCode } from '../helpers/fixtures'

const today = '2026-10-05'

describe('employees service', () => {
  let db: Db
  let admin: SessionUser
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
  })

  it('creates employees with their first weekly hours', () => {
    const id = createEmployee(db, admin, { name: 'Anna', shortName: 'AN', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    expect(listEmployees(db, today, 'admin')).toEqual([
      { id, name: 'Anna', shortName: 'AN', sortOrder: 1, leftOn: null, currentWeeklyMinutes: 2340, currentWorkdays: 0b11111 },
    ])
    expect(errorCode(() => createEmployee(db, admin, { name: ' ', shortName: '', weeklyMinutes: 0, validFrom: '2026-01-01' }))).toBe('name_required')
  })
  it('keeps an hours history and never deletes the last period', () => {
    const id = createEmployee(db, admin, { name: 'Anna', shortName: 'AN', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    addHours(db, id, { weeklyMinutes: 1800, validFrom: '2026-10-01' })
    addHours(db, id, { weeklyMinutes: 1950, validFrom: '2026-10-01' })
    const detail = getEmployee(db, id, today, 'admin')
    expect(detail.hours.map(h => [h.validFrom, h.weeklyMinutes])).toEqual([['2026-01-01', 2340], ['2026-10-01', 1950]])
    expect(detail.currentWeeklyMinutes).toBe(1950)
    deleteHours(db, detail.hours[1]!.id)
    expect(errorCode(() => deleteHours(db, detail.hours[0]!.id))).toBe('last_hours')
  })
  it('reorders employees', () => {
    const anna = createEmployee(db, admin, { name: 'Anna', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    createEmployee(db, admin, { name: 'Ben', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    moveEmployee(db, anna, 'down')
    expect(listEmployees(db, today, 'admin').map(e => e.name)).toEqual(['Ben', 'Anna'])
    moveEmployee(db, anna, 'down')
    expect(listEmployees(db, today, 'admin').map(e => e.name)).toEqual(['Ben', 'Anna'])
  })
  it('updates master data, adjustments and entitlements', () => {
    const id = createEmployee(db, admin, { name: 'Anna', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    updateEmployee(db, id, { name: 'Anna B.', shortName: 'AB', leftOn: '2026-12-31' })
    addAdjustment(db, id, { date: '2026-01-01', minutes: 750, reason: 'Übertrag' })
    setEntitlement(db, id, 2026, { days: 30, carriedOverDays: 2 })
    setEntitlement(db, id, 2026, { days: 30, carriedOverDays: 3 })
    const detail = getEmployee(db, id, today, 'admin')
    expect(detail).toMatchObject({ name: 'Anna B.', shortName: 'AB', leftOn: '2026-12-31' })
    expect(detail.adjustments).toMatchObject([{ date: '2026-01-01', minutes: 750, reason: 'Übertrag' }])
    expect(detail.entitlements).toMatchObject([{ year: 2026, days: 30, carriedOverDays: 3 }])
    expect(errorCode(() => getEmployee(db, 999, today, 'admin'))).toBe('employee_not_found')
  })
})

describe('creating an employee with working days, leave and opening balance', () => {
  let db: Db
  let admin: SessionUser
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
  })

  it('stores working days, leave entitlement, carried-over leave and existing overtime', () => {
    const id = createEmployee(db, admin, {
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
    const id = createEmployee(db, admin, { name: 'Dora', shortName: '', weeklyMinutes: 2340, validFrom: '2026-10-01' })
    const employee = getEmployee(db, id, '2026-10-05')
    expect(employee.hours[0]!.workdays).toBe(0b11111)
    expect(employee.entitlements).toEqual([])
    expect(employee.adjustments).toEqual([])
  })
  it('requires at least one working day and keeps them for later hours periods', () => {
    expect(errorCode(() => createEmployee(db, admin, { name: 'Eva', shortName: '', weeklyMinutes: 2340, validFrom: '2026-10-01', workdays: 0 })))
      .toBe('workdays_required')
    const id = createEmployee(db, admin, { name: 'Eva', shortName: '', weeklyMinutes: 2340, validFrom: '2026-10-01' })
    addHours(db, id, { weeklyMinutes: 1560, validFrom: '2027-01-01', workdays: 0b01111 })
    expect(getEmployee(db, id, '2027-01-04').hours.map(h => h.workdays)).toEqual([0b11111, 0b01111])
  })
})

describe('contract data (Träger only)', () => {
  const today = '2026-10-05'
  const contract = { employedSince: '2019-03-01', jobKey: 'educator' as const, jobOther: 'ignored', payGroup: 'S 8a' as const, payLevel: 3 }
  it('is shown to the Träger, to the Leitung only when allowed, and never to others', () => {
    const db = createTestDb()
    const admin = addUser(db, 'traeger', 'provider')
    const id = createEmployee(db, admin, { name: 'Anna', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    setContract(db, id, contract)
    const saved = { ...contract, jobOther: null } // free text only with 'other'
    expect(listEmployees(db, today, 'provider')[0]!.contract).toEqual(saved)
    expect(getEmployee(db, id, today, 'provider').contract).toEqual(saved)
    expect(listEmployees(db, today, 'admin')[0]!.contract).toBeUndefined()
    setContractVisibleToAdmins(db, true)
    expect(getEmployee(db, id, today, 'admin').contract).toEqual(saved)
    expect(listEmployees(db, today, 'observer')[0]!.contract).toBeUndefined()
    expect(getAppSettings(db).contractVisibleToAdmins).toBe(true)
  })
  it('keeps free text for other jobs and validates the level', () => {
    const db = createTestDb()
    const admin = addUser(db, 'traeger', 'provider')
    const id = createEmployee(db, admin, { name: 'Anna', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    setContract(db, id, { ...contract, jobKey: 'other', jobOther: ' Hauswirtschaft ', payGroup: null, payLevel: null })
    expect(getEmployee(db, id, today, 'provider').contract).toMatchObject({ jobKey: 'other', jobOther: 'Hauswirtschaft' })
    expect(errorCode(() => setContract(db, id, { ...contract, payLevel: 7 }))).toBe('invalid_pay_level')
    expect(errorCode(() => setContract(db, 999, contract))).toBe('employee_not_found')
  })
})

describe('level-up notices', () => {
  it('lists due level steps for the Träger, and for the Leitung only when contract data is shared', () => {
    const db = createTestDb()
    const admin = addUser(db, 'traeger', 'provider')
    const anna = createEmployee(db, admin, { name: 'Anna', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    const ben = createEmployee(db, admin, { name: 'Ben', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    const base = { jobKey: 'educator' as const, jobOther: null, payGroup: 'S 8a' as const }
    setContract(db, anna, { ...base, employedSince: '2022-11-01', payLevel: 2 }) // level 3 due on 2026-11-01
    setContract(db, ben, { ...base, employedSince: '2022-11-01', payLevel: 3 }) // already entered
    const due = [{ employeeId: anna, name: 'Anna', fromLevel: 2, level: 3, on: '2026-11-01' }]
    expect(listLevelUps(db, '2026-10-05', 'provider')).toEqual(due)
    expect(listLevelUps(db, '2026-10-01', 'provider')).toEqual([])
    expect(listLevelUps(db, '2026-10-05', 'admin')).toEqual([])
    setContractVisibleToAdmins(db, true)
    expect(listLevelUps(db, '2026-10-05', 'admin')).toEqual(due)
    updateEmployee(db, anna, { name: 'Anna', shortName: '', leftOn: '2026-10-04' })
    expect(listLevelUps(db, '2026-10-05', 'provider')).toEqual([])
  })
})
