import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { contractSchema, employeeUpdateSchema } from '../../server/schemas'
import { rolePermissions } from '../../server/services/permissions'
import type { Db } from '../../server/db/client'
import { setRoleBundle } from '../../server/services/rights'
import {
  addAdjustment, addHours, createEmployee, deleteHours, getEmployee, listEmployees, listLevelUps,
  moveEmployee, setAdjustmentPaidOut, setContract, setEntitlement, updateEmployee,
} from '../../server/services/employees'
import type { SessionUser } from '../../shared/types/api'
import { addFacility, addUser, createTestDb, errorCode } from '../helpers/fixtures'

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
    expect(listEmployees(db, 1, today, rolePermissions(db, 'admin'))).toEqual([
      { id, name: 'Anna', shortName: 'AN', sortOrder: 1, leftOn: null, currentWeeklyMinutes: 2340, currentWorkdays: 0b11111,
        stampVia: 'both', breakMode: 'stamp', groupId: null, birthday: null, qualification: null, staffingShare: null,
        hasPin: false, pinLocked: false },
    ])
    expect(errorCode(() => createEmployee(db, admin, 1, { name: ' ', shortName: '', weeklyMinutes: 0, validFrom: '2026-01-01' }))).toBe('name_required')
  })
  it('keeps an hours history and never deletes the last period', () => {
    const id = createEmployee(db, admin, 1, { name: 'Anna', shortName: 'AN', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    addHours(db, 1, id, { weeklyMinutes: 1800, validFrom: '2026-10-01' }, admin)
    addHours(db, 1, id, { weeklyMinutes: 1950, validFrom: '2026-10-01' }, admin)
    const detail = getEmployee(db, 1, id, today, rolePermissions(db, 'admin'))
    expect(detail.hours.map(h => [h.validFrom, h.weeklyMinutes])).toEqual([['2026-01-01', 2340], ['2026-10-01', 1950]])
    expect(detail.currentWeeklyMinutes).toBe(1950)
    deleteHours(db, 1, detail.hours[1]!.id)
    expect(errorCode(() => deleteHours(db, 1, detail.hours[0]!.id))).toBe('last_hours')
  })
  it('reorders employees', () => {
    const anna = createEmployee(db, admin, 1, { name: 'Anna', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    createEmployee(db, admin, 1, { name: 'Ben', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    moveEmployee(db, 1, anna, 'down')
    expect(listEmployees(db, 1, today, rolePermissions(db, 'admin')).map(e => e.name)).toEqual(['Ben', 'Anna'])
    moveEmployee(db, 1, anna, 'down')
    expect(listEmployees(db, 1, today, rolePermissions(db, 'admin')).map(e => e.name)).toEqual(['Ben', 'Anna'])
  })
  it('moves past people who already left (they are hidden in the archive), not past those who leave later', () => {
    const add = (name: string) => createEmployee(db, admin, 1, { name, shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    const anna = add('Anna')
    const ben = add('Ben')
    add('Carla')
    const dora = add('Dora')
    updateEmployee(db, 1, ben, { name: 'Ben', shortName: '', leftOn: '2026-09-30' })
    updateEmployee(db, 1, dora, { name: 'Dora', shortName: '', leftOn: today })
    const names = () => listEmployees(db, 1, today, rolePermissions(db, 'admin')).map(e => e.name)
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
    addAdjustment(db, 1, id, { date: '2026-06-30', minutes: -600, reason: 'Ausgezahlt', paidOut: true })
    setEntitlement(db, 1, id, 2026, { days: 30, carriedOverDays: 2 })
    setEntitlement(db, 1, id, 2026, { days: 30, carriedOverDays: 3 })
    const detail = getEmployee(db, 1, id, today, rolePermissions(db, 'admin'))
    expect(detail).toMatchObject({ name: 'Anna B.', shortName: 'AB', leftOn: '2026-12-31' })
    expect(detail.adjustments).toMatchObject([
      { date: '2026-01-01', minutes: 750, reason: 'Übertrag', paidOut: false },
      { date: '2026-06-30', minutes: -600, reason: 'Ausgezahlt', paidOut: true },
    ])
    expect(detail.entitlements).toMatchObject([{ year: 2026, days: 30, carriedOverDays: 3 }])
    expect(errorCode(() => getEmployee(db, 1, 999, today, rolePermissions(db, 'admin')))).toBe('employee_not_found')
  })
  it('marks an existing adjustment „ausgezahlt“ and back, only for managers and the facility\'s own employees', () => {
    const id = createEmployee(db, admin, 1, { name: 'Anna', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    addAdjustment(db, 1, id, { date: '2026-06-30', minutes: -600, reason: 'Ausgezahlt' })
    const adjustmentId = getEmployee(db, 1, id, today, rolePermissions(db, 'admin')).adjustments[0]!.id
    const paidOut = () => getEmployee(db, 1, id, today, rolePermissions(db, 'admin')).adjustments[0]!.paidOut
    setAdjustmentPaidOut(db, admin, 1, id, adjustmentId, true)
    expect(paidOut()).toBe(true)
    expect(getEmployee(db, 1, id, today, rolePermissions(db, 'admin')).adjustments[0]).toMatchObject({ date: '2026-06-30', minutes: -600, reason: 'Ausgezahlt' })
    setAdjustmentPaidOut(db, addUser(db, 'traeger', 'provider'), 1, id, adjustmentId, false)
    expect(paidOut()).toBe(false)
    // Staff: 403; another facility (or another employee's adjustment): 404, nothing changes.
    const staff = addUser(db, 'mitarbeiter', 'observer', id)
    expect(errorCode(() => setAdjustmentPaidOut(db, staff, 1, id, adjustmentId, true))).toBe('forbidden')
    const hort = addFacility(db, 'Hort')
    const hortLeitung = addUser(db, 'hortleitung', 'admin', null, hort)
    expect(errorCode(() => setAdjustmentPaidOut(db, hortLeitung, hort, id, adjustmentId, true))).toBe('employee_not_found')
    const ben = createEmployee(db, admin, 1, { name: 'Ben', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    expect(errorCode(() => setAdjustmentPaidOut(db, admin, 1, ben, adjustmentId, true))).toBe('adjustment_not_found')
    expect(errorCode(() => setAdjustmentPaidOut(db, admin, 1, id, 999, true))).toBe('adjustment_not_found')
    expect(paidOut()).toBe(false)
  })
  it('tells for a left employee whether anything paid out is left', () => {
    const anna = createEmployee(db, admin, 1, { name: 'Anna', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    const ben = createEmployee(db, admin, 1, { name: 'Ben', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    const carla = createEmployee(db, admin, 1, { name: 'Carla', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    updateEmployee(db, 1, anna, { name: 'Anna', shortName: '', leftOn: '2026-03-15' })
    updateEmployee(db, 1, ben, { name: 'Ben', shortName: '', leftOn: '2026-03-15' })
    addAdjustment(db, 1, anna, { date: '2026-02-28', minutes: -600, reason: 'Ausgezahlt', paidOut: true })
    addAdjustment(db, 1, ben, { date: '2026-02-28', minutes: 60, reason: 'Übertrag' })
    addAdjustment(db, 1, carla, { date: '2026-02-28', minutes: -600, reason: 'Ausgezahlt', paidOut: true })
    const list = new Map(listEmployees(db, 1, today, rolePermissions(db, 'admin')).map(employee => [employee.id, employee]))
    expect(list.get(anna)!.hasPaidOut).toBe(true)
    expect(list.get(ben)!.hasPaidOut).toBe(false)
    expect(list.get(carla)).not.toHaveProperty('hasPaidOut')
    expect(getEmployee(db, 1, ben, today, rolePermissions(db, 'admin')).hasPaidOut).toBe(false)
    expect(getEmployee(db, 1, anna, today, rolePermissions(db, 'admin')).hasPaidOut).toBe(true)
  })
  it('stores a birthday as day and month, keeps it when left out and clears it with null', () => {
    const id = createEmployee(db, admin, 1, { name: 'Anna', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    expect(getEmployee(db, 1, id, today, rolePermissions(db, 'admin')).birthday).toBeNull()
    updateEmployee(db, 1, id, { name: 'Anna', shortName: '', leftOn: null, birthday: '02-29' })
    expect(getEmployee(db, 1, id, today, rolePermissions(db, 'admin')).birthday).toBe('02-29')
    expect(listEmployees(db, 1, today, rolePermissions(db, 'admin'))[0]!.birthday).toBe('02-29')
    updateEmployee(db, 1, id, { name: 'Anna B.', shortName: '', leftOn: null })
    expect(getEmployee(db, 1, id, today, rolePermissions(db, 'admin'))).toMatchObject({ name: 'Anna B.', birthday: '02-29' })
    updateEmployee(db, 1, id, { name: 'Anna B.', shortName: '', leftOn: null, birthday: '12-31' })
    expect(getEmployee(db, 1, id, today, rolePermissions(db, 'admin')).birthday).toBe('12-31')
    updateEmployee(db, 1, id, { name: 'Anna B.', shortName: '', leftOn: null, birthday: null })
    expect(getEmployee(db, 1, id, today, rolePermissions(db, 'admin')).birthday).toBeNull()
  })
  it('saves the birthday with a new employee and refuses an invalid one without creating anyone', () => {
    const id = createEmployee(db, admin, 1, { name: 'Anna', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01', birthday: '03-04' })
    expect(getEmployee(db, 1, id, today, rolePermissions(db, 'admin')).birthday).toBe('03-04')
    const none = createEmployee(db, admin, 1, { name: 'Ben', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01', birthday: null })
    expect(getEmployee(db, 1, none, today, rolePermissions(db, 'admin')).birthday).toBeNull()
    expect(errorCode(() => createEmployee(db, admin, 1, { name: 'Cem', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01', birthday: '02-31' })))
      .toBe('employee_birthday_invalid')
    expect(listEmployees(db, 1, today, rolePermissions(db, 'admin'))).toHaveLength(2)
  })
  it('accepts the qualification Haushaltskraft', () => {
    const id = createEmployee(db, admin, 1, { name: 'Anna', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    updateEmployee(db, 1, id, { name: 'Anna', shortName: '', leftOn: null, qualification: 'haushalt' })
    expect(getEmployee(db, 1, id, today, rolePermissions(db, 'admin'))).toMatchObject({ qualification: 'haushalt', staffingShare: null })
  })
  it('stores qualification and counting share for the staffing ratio, keeps them when left out and clears them with null', () => {
    const id = createEmployee(db, admin, 1, { name: 'Anna', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    expect(getEmployee(db, 1, id, today, rolePermissions(db, 'admin'))).toMatchObject({ qualification: null, staffingShare: null })
    const base = { name: 'Anna', shortName: '', leftOn: null }
    updateEmployee(db, 1, id, { ...base, qualification: 'azubi_2', staffingShare: 40 })
    expect(listEmployees(db, 1, today, rolePermissions(db, 'admin'))[0]).toMatchObject({ qualification: 'azubi_2', staffingShare: 40 })
    updateEmployee(db, 1, id, base)
    expect(getEmployee(db, 1, id, today, rolePermissions(db, 'admin'))).toMatchObject({ qualification: 'azubi_2', staffingShare: 40 })
    updateEmployee(db, 1, id, { ...base, staffingShare: 0 })
    expect(getEmployee(db, 1, id, today, rolePermissions(db, 'admin'))).toMatchObject({ qualification: 'azubi_2', staffingShare: 0 })
    updateEmployee(db, 1, id, { ...base, staffingShare: 100, qualification: 'fachkraft' })
    expect(getEmployee(db, 1, id, today, rolePermissions(db, 'admin'))).toMatchObject({ qualification: 'fachkraft', staffingShare: 100 })
    updateEmployee(db, 1, id, { ...base, qualification: null, staffingShare: null })
    expect(getEmployee(db, 1, id, today, rolePermissions(db, 'admin'))).toMatchObject({ qualification: null, staffingShare: null })
  })
  it('refuses an unknown qualification and a share outside 0–100 % or not whole, and changes nothing', () => {
    const id = createEmployee(db, admin, 1, { name: 'Anna', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    const base = { name: 'Ben', shortName: '', leftOn: null }
    updateEmployee(db, 1, id, { name: 'Anna', shortName: '', leftOn: null, qualification: 'ergaenzung', staffingShare: 50 })
    for (const qualification of ['', 'Fachkraft', 'azubi_4', 'leitung']) {
      expect(errorCode(() => updateEmployee(db, 1, id, { ...base, qualification })), qualification).toBe('qualification_invalid')
    }
    for (const staffingShare of [-1, 101, 50.5, Number.NaN]) {
      expect(errorCode(() => updateEmployee(db, 1, id, { ...base, staffingShare })), String(staffingShare)).toBe('staffing_share_invalid')
    }
    expect(getEmployee(db, 1, id, today, rolePermissions(db, 'admin'))).toMatchObject({ name: 'Anna', qualification: 'ergaenzung', staffingShare: 50 })
  })
  it('refuses a birthday that is no valid day and month and changes nothing', () => {
    const id = createEmployee(db, admin, 1, { name: 'Anna', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    updateEmployee(db, 1, id, { name: 'Anna', shortName: '', leftOn: null, birthday: '05-12' })
    for (const birthday of ['02-30', '04-31', '13-01', '00-10', '06-00', '1-5', '2026-02-01', '', 'ab-cd', '05-12 ']) {
      expect(errorCode(() => updateEmployee(db, 1, id, { name: 'Ben', shortName: '', leftOn: null, birthday })), birthday)
        .toBe('employee_birthday_invalid')
    }
    expect(getEmployee(db, 1, id, today, rolePermissions(db, 'admin'))).toMatchObject({ name: 'Anna', birthday: '05-12' })
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
    const employee = getEmployee(db, 1, id, '2026-10-05', rolePermissions(db, 'admin'))
    expect(employee.hours).toEqual([{ id: expect.any(Number), weeklyMinutes: 1200, validFrom: '2026-10-01', workdays: 0b00111 }])
    expect(employee.currentWorkdays).toBe(0b00111)
    expect(employee.entitlements).toEqual([{ id: expect.any(Number), year: 2026, days: 18, carriedOverDays: 2.5, carriedAutomatically: false }])
    expect(employee.adjustments).toEqual([{ id: expect.any(Number), date: '2026-10-01', minutes: -90, reason: 'Übertrag bei Anlage', paidOut: false }])
  })
  it('creates nothing extra when no leave or balance is given and defaults to Monday–Friday', () => {
    const id = createEmployee(db, admin, 1, { name: 'Dora', shortName: '', weeklyMinutes: 2340, validFrom: '2026-10-01' })
    const employee = getEmployee(db, 1, id, '2026-10-05', rolePermissions(db, 'admin'))
    expect(employee.hours[0]!.workdays).toBe(0b11111)
    expect(employee.entitlements).toEqual([])
    expect(employee.adjustments).toEqual([])
  })
  it('requires at least one working day and keeps them for later hours periods', () => {
    expect(errorCode(() => createEmployee(db, admin, 1, { name: 'Eva', shortName: '', weeklyMinutes: 2340, validFrom: '2026-10-01', workdays: 0 })))
      .toBe('workdays_required')
    const id = createEmployee(db, admin, 1, { name: 'Eva', shortName: '', weeklyMinutes: 2340, validFrom: '2026-10-01' })
    addHours(db, 1, id, { weeklyMinutes: 1560, validFrom: '2027-01-01', workdays: 0b01111 }, admin)
    expect(getEmployee(db, 1, id, '2027-01-04', rolePermissions(db, 'admin')).hours.map(h => h.workdays)).toEqual([0b11111, 0b01111])
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
    const saved = { ...contract, jobOther: null, fixedTermUntil: null, trainingUntil: null, recognitionYearCounts: false } // free text only with 'other'
    expect(listEmployees(db, 1, today, rolePermissions(db, 'provider'))[0]!.contract).toEqual(saved)
    expect(getEmployee(db, 1, id, today, rolePermissions(db, 'provider')).contract).toEqual(saved)
    expect(listEmployees(db, 1, today, rolePermissions(db, 'admin'))[0]!.contract).toBeUndefined()
    setRoleBundle(db, 'admin', 'contractView', true)
    expect(getEmployee(db, 1, id, today, rolePermissions(db, 'admin')).contract).toEqual(saved)
    expect(listEmployees(db, 1, today, rolePermissions(db, 'observer'))[0]!.contract).toBeUndefined()
  })
  it('keeps free text for other jobs and validates the level', () => {
    const db = createTestDb()
    const admin = addUser(db, 'traeger', 'provider')
    const id = createEmployee(db, admin, 1, { name: 'Anna', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    setContract(db, 1, id, { ...contract, jobKey: 'other', jobOther: ' Hauswirtschaft ', payGroup: null, payLevel: null })
    expect(getEmployee(db, 1, id, today, rolePermissions(db, 'provider')).contract).toMatchObject({ jobKey: 'other', jobOther: 'Hauswirtschaft' })
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
    expect(getEmployee(db, 1, anna, today, rolePermissions(db, 'provider')).contract!.personnelNumber).toBe('1042')
    expect(errorCode(() => setContract(db, 1, ben, { ...contract, personnelNumber: '1042' }))).toBe('personnel_number_taken')
    setContract(db, 1, ben, { ...contract, personnelNumber: ' ' })
    expect(getEmployee(db, 1, ben, today, rolePermissions(db, 'provider')).contract!.personnelNumber).toBeNull()
  })
})

describe('contract data: training or studies in the facility', () => {
  const today = '2026-11-18'
  const contract = { personnelNumber: null, employedSince: '2021-09-01', jobKey: 'educator' as const, jobOther: null, payGroup: 'S 8a' as const, payLevel: 2 }
  let db: Db
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    anna = createEmployee(db, addUser(db, 'traeger', 'provider'), 1, { name: 'Anna', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
  })
  const read = () => getEmployee(db, 1, anna, today, rolePermissions(db, 'provider')).contract!

  it('starts empty, round-trips both fields and keeps them when left out', () => {
    setContract(db, 1, anna, contract, today)
    expect(read()).toMatchObject({ trainingUntil: null, recognitionYearCounts: false })
    setContract(db, 1, anna, { ...contract, trainingUntil: '2024-07-31', recognitionYearCounts: true }, today)
    expect(read()).toMatchObject({ trainingUntil: '2024-07-31', recognitionYearCounts: true })
    setContract(db, 1, anna, { ...contract, payLevel: 3 }, today)
    expect(read()).toMatchObject({ payLevel: 3, trainingUntil: '2024-07-31', recognitionYearCounts: true })
    // The DTO goes back unchanged (as the level-up notice does it).
    setContract(db, 1, anna, read(), today)
    expect(read()).toMatchObject({ trainingUntil: '2024-07-31', recognitionYearCounts: true })
    setContract(db, 1, anna, { ...contract, recognitionYearCounts: false }, today)
    expect(read()).toMatchObject({ trainingUntil: '2024-07-31', recognitionYearCounts: false })
    // Without a training end the recognition year has no meaning.
    setContract(db, 1, anna, { ...contract, trainingUntil: null, recognitionYearCounts: true }, today)
    expect(read()).toMatchObject({ trainingUntil: null, recognitionYearCounts: false })
  })

  it('shows them like the other contract fields: to the Leitung only with „Vertragsangaben ansehen“', () => {
    setContract(db, 1, anna, { ...contract, trainingUntil: '2024-07-31', recognitionYearCounts: true }, today)
    expect(getEmployee(db, 1, anna, today, rolePermissions(db, 'admin'))).not.toHaveProperty('contract')
    setRoleBundle(db, 'admin', 'contractView', true)
    expect(listEmployees(db, 1, today, rolePermissions(db, 'admin'))[0]!.contract).toMatchObject({ trainingUntil: '2024-07-31', recognitionYearCounts: true })
  })

  it('checks the training end: a real date, from 1970, at most a year after today', () => {
    for (const value of ['2024-02-30', '1969-12-31', '2027-11-19']) {
      expect(errorCode(() => setContract(db, 1, anna, { ...contract, trainingUntil: value }, today)), value).toBe('training_until_invalid')
    }
    setContract(db, 1, anna, { ...contract, trainingUntil: '2027-11-18' }, today)
    setContract(db, 1, anna, { ...contract, trainingUntil: '1970-01-01' }, today)
    expect(read().trainingUntil).toBe('1970-01-01')
  })

  it('counts the level steps from the day after the training, or with the recognition year one year earlier', () => {
    // Employed during the training until 31.07.2024: level 2 from 01.08.2025, level 3 from 01.08.2027.
    setContract(db, 1, anna, { ...contract, trainingUntil: '2024-07-31' }, today)
    expect(listLevelUps(db, 1, '2025-07-02', rolePermissions(db, 'provider'))).toEqual([]) // by employedSince level 3 was due 2024-09-01
    setContract(db, 1, anna, { ...contract, payLevel: 1, trainingUntil: '2024-07-31' }, today)
    expect(listLevelUps(db, 1, '2025-07-02', rolePermissions(db, 'provider')))
      .toEqual([{ employeeId: anna, name: 'Anna', fromLevel: 1, level: 2, on: '2025-08-01' }])
    // The recognition year as level 1: level 2 right after the training, level 3 on 01.08.2026 (without it 01.08.2027).
    setContract(db, 1, anna, { ...contract, trainingUntil: '2024-07-31', recognitionYearCounts: true }, today)
    expect(listLevelUps(db, 1, '2026-07-02', rolePermissions(db, 'provider')))
      .toEqual([{ employeeId: anna, name: 'Anna', fromLevel: 2, level: 3, on: '2026-08-01' }])
  })
})

describe('contract data: only with „Vertragsangaben ändern“', () => {
  it('takes the training fields only on the contract route, which a Leitung without contractEdit cannot use', () => {
    const db = createTestDb()
    expect(rolePermissions(db, 'admin').has('employees.contractEdit')).toBe(false)
    setRoleBundle(db, 'admin', 'contractView', true)
    expect(rolePermissions(db, 'admin').has('employees.contractEdit')).toBe(false)
    expect(rolePermissions(db, 'provider').has('employees.contractEdit')).toBe(true)
    const route = readFileSync(join(process.cwd(), 'server', 'api', 'employees', '[id]', 'contract.put.ts'), 'utf8')
    expect(route).toContain('requirePermission(event, \'employees.contractEdit\')')
    // The employee form of the Leitung drops them.
    const update = employeeUpdateSchema.parse({ name: 'Anna', shortName: '', leftOn: null, trainingUntil: '2024-07-31', recognitionYearCounts: true })
    expect(update).not.toHaveProperty('trainingUntil')
    expect(update).not.toHaveProperty('recognitionYearCounts')
    expect(contractSchema.parse({ personnelNumber: null, employedSince: null, jobKey: null, jobOther: null, payGroup: null, payLevel: null, trainingUntil: '2024-07-31', recognitionYearCounts: true }))
      .toMatchObject({ trainingUntil: '2024-07-31', recognitionYearCounts: true })
  })
})

describe('level-up notices', () => {
  it('lists due level steps for the Träger, and for the Leitung only when contract data is shared', () => {
    const db = createTestDb()
    const admin = addUser(db, 'traeger', 'provider')
    const anna = createEmployee(db, admin, 1, { name: 'Anna', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    const ben = createEmployee(db, admin, 1, { name: 'Ben', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    const base = { personnelNumber: null, jobKey: 'educator' as const, jobOther: null, payGroup: 'S 8a' as const }
    setContract(db, 1, anna, { ...base, employedSince: '2023-11-01', payLevel: 2 }) // level 3 due on 2026-11-01
    setContract(db, 1, ben, { ...base, employedSince: '2023-11-01', payLevel: 3 }) // already entered
    const due = [{ employeeId: anna, name: 'Anna', fromLevel: 2, level: 3, on: '2026-11-01' }]
    expect(listLevelUps(db, 1, '2026-10-05', rolePermissions(db, 'provider'))).toEqual(due)
    expect(listLevelUps(db, 1, '2026-10-01', rolePermissions(db, 'provider'))).toEqual([])
    expect(listLevelUps(db, 1, '2026-10-05', rolePermissions(db, 'admin'))).toEqual([])
    setRoleBundle(db, 'admin', 'contractView', true)
    expect(listLevelUps(db, 1, '2026-10-05', rolePermissions(db, 'admin'))).toEqual(due)
    updateEmployee(db, 1, anna, { name: 'Anna', shortName: '', leftOn: '2026-10-04' })
    expect(listLevelUps(db, 1, '2026-10-05', rolePermissions(db, 'provider'))).toEqual([])
  })
})
