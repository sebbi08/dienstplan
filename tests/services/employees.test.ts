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
    const id = createEmployee(db, admin, 1, { name: 'Anna', shortName: 'AN', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    expect(listEmployees(db, 1, today, 'admin')).toEqual([
      { id, name: 'Anna', shortName: 'AN', sortOrder: 1, leftOn: null, currentWeeklyMinutes: 2340, currentWorkdays: 0b11111,
        stampVia: 'both', breakMode: 'stamp', groupId: null, birthday: null },
    ])
    expect(errorCode(() => createEmployee(db, admin, 1, { name: ' ', shortName: '', weeklyMinutes: 0, validFrom: '2026-01-01' }))).toBe('name_required')
  })
  it('keeps an hours history and never deletes the last period', () => {
    const id = createEmployee(db, admin, 1, { name: 'Anna', shortName: 'AN', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    addHours(db, 1, id, { weeklyMinutes: 1800, validFrom: '2026-10-01' })
    addHours(db, 1, id, { weeklyMinutes: 1950, validFrom: '2026-10-01' })
    const detail = getEmployee(db, 1, id, today, 'admin')
    expect(detail.hours.map(h => [h.validFrom, h.weeklyMinutes])).toEqual([['2026-01-01', 2340], ['2026-10-01', 1950]])
    expect(detail.currentWeeklyMinutes).toBe(1950)
    deleteHours(db, 1, detail.hours[1]!.id)
    expect(errorCode(() => deleteHours(db, 1, detail.hours[0]!.id))).toBe('last_hours')
  })
  it('reorders employees', () => {
    const anna = createEmployee(db, admin, 1, { name: 'Anna', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    createEmployee(db, admin, 1, { name: 'Ben', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    moveEmployee(db, 1, anna, 'down')
    expect(listEmployees(db, 1, today, 'admin').map(e => e.name)).toEqual(['Ben', 'Anna'])
    moveEmployee(db, 1, anna, 'down')
    expect(listEmployees(db, 1, today, 'admin').map(e => e.name)).toEqual(['Ben', 'Anna'])
  })
  it('moves past people who already left (they are hidden in the archive), not past those who leave later', () => {
    const add = (name: string) => createEmployee(db, admin, 1, { name, shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    const anna = add('Anna')
    const ben = add('Ben')
    add('Carla')
    const dora = add('Dora')
    updateEmployee(db, 1, ben, { name: 'Ben', shortName: '', leftOn: '2026-09-30' })
    updateEmployee(db, 1, dora, { name: 'Dora', shortName: '', leftOn: today })
    const names = () => listEmployees(db, 1, today, 'admin').map(e => e.name)
    moveEmployee(db, 1, anna, 'down', today)
    expect(names()).toEqual(['Carla', 'Ben', 'Anna', 'Dora'])
    // Dora leaves today and is still in the active list: Anna moves past her.
    moveEmployee(db, 1, anna, 'down', today)
    expect(names()).toEqual(['Carla', 'Ben', 'Dora', 'Anna'])
    moveEmployee(db, 1, anna, 'down', today)
    expect(names()).toEqual(['Carla', 'Ben', 'Dora', 'Anna'])
    // Up past the leaver Ben; then Dora is the first of the active list and stays there.
    moveEmployee(db, 1, dora, 'up', today)
    moveEmployee(db, 1, dora, 'up', today)
    expect(names()).toEqual(['Dora', 'Ben', 'Carla', 'Anna'])
  })
  it('updates master data, adjustments and entitlements', () => {
    const id = createEmployee(db, admin, 1, { name: 'Anna', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    updateEmployee(db, 1, id, { name: 'Anna B.', shortName: 'AB', leftOn: '2026-12-31' })
    addAdjustment(db, 1, id, { date: '2026-01-01', minutes: 750, reason: 'Übertrag' })
    setEntitlement(db, 1, id, 2026, { days: 30, carriedOverDays: 2 })
    setEntitlement(db, 1, id, 2026, { days: 30, carriedOverDays: 3 })
    const detail = getEmployee(db, 1, id, today, 'admin')
    expect(detail).toMatchObject({ name: 'Anna B.', shortName: 'AB', leftOn: '2026-12-31' })
    expect(detail.adjustments).toMatchObject([{ date: '2026-01-01', minutes: 750, reason: 'Übertrag' }])
    expect(detail.entitlements).toMatchObject([{ year: 2026, days: 30, carriedOverDays: 3 }])
    expect(errorCode(() => getEmployee(db, 1, 999, today, 'admin'))).toBe('employee_not_found')
  })
  it('stores a birthday as day and month, keeps it when left out and clears it with null', () => {
    const id = createEmployee(db, admin, 1, { name: 'Anna', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    expect(getEmployee(db, 1, id, today, 'admin').birthday).toBeNull()
    updateEmployee(db, 1, id, { name: 'Anna', shortName: '', leftOn: null, birthday: '02-29' })
    expect(getEmployee(db, 1, id, today, 'admin').birthday).toBe('02-29')
    expect(listEmployees(db, 1, today, 'admin')[0]!.birthday).toBe('02-29')
    updateEmployee(db, 1, id, { name: 'Anna B.', shortName: '', leftOn: null })
    expect(getEmployee(db, 1, id, today, 'admin')).toMatchObject({ name: 'Anna B.', birthday: '02-29' })
    updateEmployee(db, 1, id, { name: 'Anna B.', shortName: '', leftOn: null, birthday: '12-31' })
    expect(getEmployee(db, 1, id, today, 'admin').birthday).toBe('12-31')
    updateEmployee(db, 1, id, { name: 'Anna B.', shortName: '', leftOn: null, birthday: null })
    expect(getEmployee(db, 1, id, today, 'admin').birthday).toBeNull()
  })
  it('refuses a birthday that is no valid day and month and changes nothing', () => {
    const id = createEmployee(db, admin, 1, { name: 'Anna', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    updateEmployee(db, 1, id, { name: 'Anna', shortName: '', leftOn: null, birthday: '05-12' })
    for (const birthday of ['02-30', '04-31', '13-01', '00-10', '06-00', '1-5', '2026-02-01', '', 'ab-cd', '05-12 ']) {
      expect(errorCode(() => updateEmployee(db, 1, id, { name: 'Ben', shortName: '', leftOn: null, birthday })), birthday)
        .toBe('employee_birthday_invalid')
    }
    expect(getEmployee(db, 1, id, today, 'admin')).toMatchObject({ name: 'Anna', birthday: '05-12' })
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
    const id = createEmployee(db, admin, 1, {
      name: 'Clara', shortName: 'CL', weeklyMinutes: 1200, validFrom: '2026-10-01',
      workdays: 0b00111, vacationDays: 18, carriedOverDays: 2.5, openingBalanceMinutes: -90,
    })
    const employee = getEmployee(db, 1, id, '2026-10-05', 'admin')
    expect(employee.hours).toEqual([{ id: expect.any(Number), weeklyMinutes: 1200, validFrom: '2026-10-01', workdays: 0b00111 }])
    expect(employee.currentWorkdays).toBe(0b00111)
    expect(employee.entitlements).toEqual([{ id: expect.any(Number), year: 2026, days: 18, carriedOverDays: 2.5, carriedAutomatically: false }])
    expect(employee.adjustments).toEqual([{ id: expect.any(Number), date: '2026-10-01', minutes: -90, reason: 'Übertrag bei Anlage' }])
  })
  it('creates nothing extra when no leave or balance is given and defaults to Monday–Friday', () => {
    const id = createEmployee(db, admin, 1, { name: 'Dora', shortName: '', weeklyMinutes: 2340, validFrom: '2026-10-01' })
    const employee = getEmployee(db, 1, id, '2026-10-05', 'admin')
    expect(employee.hours[0]!.workdays).toBe(0b11111)
    expect(employee.entitlements).toEqual([])
    expect(employee.adjustments).toEqual([])
  })
  it('requires at least one working day and keeps them for later hours periods', () => {
    expect(errorCode(() => createEmployee(db, admin, 1, { name: 'Eva', shortName: '', weeklyMinutes: 2340, validFrom: '2026-10-01', workdays: 0 })))
      .toBe('workdays_required')
    const id = createEmployee(db, admin, 1, { name: 'Eva', shortName: '', weeklyMinutes: 2340, validFrom: '2026-10-01' })
    addHours(db, 1, id, { weeklyMinutes: 1560, validFrom: '2027-01-01', workdays: 0b01111 })
    expect(getEmployee(db, 1, id, '2027-01-04', 'admin').hours.map(h => h.workdays)).toEqual([0b11111, 0b01111])
  })
})

describe('contract data (Träger only)', () => {
  const today = '2026-10-05'
  const contract = { personnelNumber: '1042', employedSince: '2019-03-01', jobKey: 'educator' as const, jobOther: 'ignored', payGroup: 'S 8a' as const, payLevel: 3 }
  it('is shown to the Träger, to the Leitung only when allowed, and never to others', () => {
    const db = createTestDb()
    const admin = addUser(db, 'traeger', 'provider')
    const id = createEmployee(db, admin, 1, { name: 'Anna', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    setContract(db, 1, id, contract)
    const saved = { ...contract, jobOther: null } // free text only with 'other'
    expect(listEmployees(db, 1, today, 'provider')[0]!.contract).toEqual(saved)
    expect(getEmployee(db, 1, id, today, 'provider').contract).toEqual(saved)
    expect(listEmployees(db, 1, today, 'admin')[0]!.contract).toBeUndefined()
    setContractVisibleToAdmins(db, true)
    expect(getEmployee(db, 1, id, today, 'admin').contract).toEqual(saved)
    expect(listEmployees(db, 1, today, 'observer')[0]!.contract).toBeUndefined()
    expect(getAppSettings(db, 1).contractVisibleToAdmins).toBe(true)
  })
  it('keeps free text for other jobs and validates the level', () => {
    const db = createTestDb()
    const admin = addUser(db, 'traeger', 'provider')
    const id = createEmployee(db, admin, 1, { name: 'Anna', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    setContract(db, 1, id, { ...contract, jobKey: 'other', jobOther: ' Hauswirtschaft ', payGroup: null, payLevel: null })
    expect(getEmployee(db, 1, id, today, 'provider').contract).toMatchObject({ jobKey: 'other', jobOther: 'Hauswirtschaft' })
    expect(errorCode(() => setContract(db, 1, id, { ...contract, payLevel: 7 }))).toBe('invalid_pay_level')
    expect(errorCode(() => setContract(db, 1, 999, contract))).toBe('employee_not_found')
  })
  it('keeps personnel numbers unique and trims them', () => {
    const db = createTestDb()
    const admin = addUser(db, 'traeger', 'provider')
    const anna = createEmployee(db, admin, 1, { name: 'Anna', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    const ben = createEmployee(db, admin, 1, { name: 'Ben', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    setContract(db, 1, anna, { ...contract, personnelNumber: ' 1042 ' })
    setContract(db, 1, anna, { ...contract, personnelNumber: '1042' }) // saving again keeps it
    expect(getEmployee(db, 1, anna, today, 'provider').contract!.personnelNumber).toBe('1042')
    expect(errorCode(() => setContract(db, 1, ben, { ...contract, personnelNumber: '1042' }))).toBe('personnel_number_taken')
    setContract(db, 1, ben, { ...contract, personnelNumber: ' ' })
    expect(getEmployee(db, 1, ben, today, 'provider').contract!.personnelNumber).toBeNull()
  })
})

describe('level-up notices', () => {
  it('lists due level steps for the Träger, and for the Leitung only when contract data is shared', () => {
    const db = createTestDb()
    const admin = addUser(db, 'traeger', 'provider')
    const anna = createEmployee(db, admin, 1, { name: 'Anna', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    const ben = createEmployee(db, admin, 1, { name: 'Ben', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    const base = { personnelNumber: null, jobKey: 'educator' as const, jobOther: null, payGroup: 'S 8a' as const }
    setContract(db, 1, anna, { ...base, employedSince: '2022-11-01', payLevel: 2 }) // level 3 due on 2026-11-01
    setContract(db, 1, ben, { ...base, employedSince: '2022-11-01', payLevel: 3 }) // already entered
    const due = [{ employeeId: anna, name: 'Anna', fromLevel: 2, level: 3, on: '2026-11-01' }]
    expect(listLevelUps(db, 1, '2026-10-05', 'provider')).toEqual(due)
    expect(listLevelUps(db, 1, '2026-10-01', 'provider')).toEqual([])
    expect(listLevelUps(db, 1, '2026-10-05', 'admin')).toEqual([])
    setContractVisibleToAdmins(db, true)
    expect(listLevelUps(db, 1, '2026-10-05', 'admin')).toEqual(due)
    updateEmployee(db, 1, anna, { name: 'Anna', shortName: '', leftOn: '2026-10-04' })
    expect(listLevelUps(db, 1, '2026-10-05', 'provider')).toEqual([])
  })
})
