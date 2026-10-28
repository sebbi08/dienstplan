import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { rolePermissions } from '../../server/services/permissions'
import type { Db } from '../../server/db/client'
import { employees } from '../../server/db/schema'
import { setContractVisibleToAdmins } from '../../server/services/appSettings'
import { getMyYearCalendar } from '../../server/services/calendar'
import { addAdjustment, getEmployee, listEmployees, setContract, updateEmployee, type EmployeeUpdate } from '../../server/services/employees'
import { getLeaveAccount } from '../../server/services/leave'
import { getMyTime } from '../../server/services/myTime'
import { getMonthPlan, getMyPlan } from '../../server/services/plan'
import { loadEmployee, loadEmployees } from '../../server/services/queries'
import { releaseMonth } from '../../server/services/release'
import { getMyRequirements } from '../../server/services/requirements'
import { terminalStatus } from '../../server/services/terminal'
import { PERMISSION_KEYS } from '../../shared/domain/permissions'
import type { EmployeePersonalInput, EmployeeSensitiveDto, SessionUser } from '../../shared/types/api'
import { addEmployeeDocument } from '../helpers/employeeData'
import { addEmployee, addUser, createTestDb, errorCode, permissionsOf } from '../helpers/fixtures'

const TODAY = '2026-10-28'
const ALL = new Set(PERMISSION_KEYS)
const LEITUNG = permissionsOf('admin')
const MITARBEITER = permissionsOf('observer')

const personal: EmployeePersonalInput = {
  birthYear: 1988, street: 'Lindenweg 4', postalCode: '79098', city: 'Freiburg', phone: '0761 12345', email: 'anna@example.org',
}
const sensitive: EmployeeSensitiveDto = {
  nationality: 'deutsch', disability: true, disabilityDegree: 50, disabilityEqual: false, disabilityUntil: '2028-12-31',
}
const contract = { personnelNumber: '1042', employedSince: '2019-03-01', jobKey: 'educator' as const, jobOther: null, payGroup: 'S 8a' as const, payLevel: 3 }

describe('personnel file: master data in the employee DTO and update', () => {
  let db: Db
  let anna: number
  const base = { name: 'Anna', shortName: 'AN', leftOn: null }
  const update = (fields: Partial<EmployeeUpdate>, permissions = ALL) =>
    updateEmployee(db, 1, anna, { ...base, ...fields }, permissions, TODAY)
  const row = () => db.select().from(employees).where(eq(employees.id, anna)).get()!

  beforeEach(() => {
    db = createTestDb()
    anna = addEmployee(db, 'Anna')
    db.update(employees).set({ birthday: '03-14' }).where(eq(employees.id, anna)).run()
  })

  it('gives the Träger the personal and the sensitive data, with the full birth date', () => {
    update({ personal, sensitive })
    const detail = getEmployee(db, 1, anna, TODAY, ALL)
    expect(detail.personal).toEqual({ ...personal, birthDate: '1988-03-14' })
    expect(detail.sensitive).toEqual(sensitive)
  })

  it('gives the Leitung the personal data but leaves the sensitive fields out of the DTO', () => {
    update({ personal, sensitive })
    const detail = getEmployee(db, 1, anna, TODAY, LEITUNG)
    expect(detail.personal).toMatchObject({ street: 'Lindenweg 4', birthDate: '1988-03-14' })
    expect(detail).not.toHaveProperty('sensitive')
    expect(JSON.stringify(detail)).not.toContain('deutsch')
  })

  it('leaves both out without the keys, and never in the list', () => {
    update({ personal, sensitive })
    for (const viewer of [MITARBEITER, rolePermissions(db, 'observer')]) {
      const detail = getEmployee(db, 1, anna, TODAY, viewer)
      expect(detail).not.toHaveProperty('personal')
      expect(detail).not.toHaveProperty('sensitive')
    }
    expect(getEmployee(db, 1, anna, TODAY, rolePermissions(db, 'provider')).sensitive).toEqual(sensitive)
    const listed = JSON.stringify(listEmployees(db, 1, TODAY, rolePermissions(db, 'provider')))
    expect(listed).not.toContain('Lindenweg')
    expect(listed).not.toContain('deutsch')
  })

  it('has no full birth date without year or birthday', () => {
    update({ personal: { ...personal, birthYear: null } })
    expect(getEmployee(db, 1, anna, TODAY, ALL).personal!.birthDate).toBeNull()
    update({ personal, birthday: null })
    expect(getEmployee(db, 1, anna, TODAY, ALL).personal).toMatchObject({ birthYear: 1988, birthDate: null })
  })

  it('refuses personal or sensitive fields from someone without the key (403), whatever the value, and changes nothing', () => {
    update({ personal, sensitive })
    const before = row()
    expect(errorCode(() => update({ name: 'Anna B.', sensitive }, LEITUNG))).toBe('forbidden')
    expect(errorCode(() => update({ name: 'Anna B.', sensitive: { ...sensitive, nationality: 'x' } }, LEITUNG))).toBe('forbidden')
    expect(errorCode(() => update({ name: 'Anna B.', personal }, MITARBEITER))).toBe('forbidden')
    expect(errorCode(() => update({ personal }, new Set()))).toBe('forbidden')
    expect(row()).toEqual(before)
    // Left out, the fields stay as they are: the Leitung keeps the sensitive data when saving the master data.
    update({ name: 'Anna B.', personal: { ...personal, city: 'Basel' } }, LEITUNG)
    expect(row()).toMatchObject({ name: 'Anna B.', city: 'Basel', nationality: 'deutsch', disabilityDegree: 50 })
  })

  it('trims the texts and stores empty ones as null', () => {
    update({
      personal: { birthYear: null, street: '  Hauptstr. 1 ', postalCode: ' ', city: '', phone: ' 0761 ', email: '  ' },
      sensitive: { ...sensitive, nationality: '  ', disability: false, disabilityDegree: null, disabilityUntil: null },
    })
    expect(row()).toMatchObject({
      street: 'Hauptstr. 1', postalCode: null, city: null, phone: '0761', email: null, nationality: null,
      disability: false, disabilityDegree: null, disabilityUntil: null,
    })
  })

  it('keeps no disability details for a „nein“', () => {
    update({ sensitive })
    update({ sensitive: { ...sensitive, disability: false, disabilityDegree: 45, disabilityEqual: true, disabilityUntil: '2028-12-31' } })
    expect(getEmployee(db, 1, anna, TODAY, ALL).sensitive).toEqual({
      nationality: 'deutsch', disability: false, disabilityDegree: null, disabilityEqual: false, disabilityUntil: null,
    })
  })

  it('checks the formats with the German error codes (400), and on an error nothing changes', () => {
    update({ personal, sensitive })
    const before = row()
    const cases: [Partial<EmployeeUpdate>, string][] = [
      [{ personal: { ...personal, email: 'anna.example.org' } }, 'email_invalid'],
      [{ personal: { ...personal, postalCode: '7909' } }, 'postal_code_invalid'],
      [{ personal: { ...personal, birthYear: 1850 } }, 'birth_year_invalid'],
      [{ personal: { ...personal, birthYear: 2027 } }, 'birth_year_invalid'],
      [{ personal: { ...personal, birthYear: 1987 }, birthday: '02-29' }, 'birth_year_invalid'],
      [{ sensitive: { ...sensitive, disabilityDegree: 45 } }, 'disability_degree_invalid'],
      [{ sensitive: { ...sensitive, disabilityDegree: 10 } }, 'disability_degree_invalid'],
      [{ sensitive: { ...sensitive, disabilityUntil: '2028-02-30' } }, 'invalid_date'],
    ]
    for (const [fields, code] of cases) expect(errorCode(() => update({ name: 'Neu', ...fields })), code).toBe(code)
    expect(row()).toEqual(before)
    update({ personal: { ...personal, birthYear: 1988 }, birthday: '02-29' })
    expect(getEmployee(db, 1, anna, TODAY, ALL).personal!.birthDate).toBe('1988-02-29')
  })
})

describe('personnel file: „befristet bis“ with the contract data', () => {
  let db: Db
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    anna = addEmployee(db, 'Anna')
  })

  it('stores it with the contract, keeps it when left out and shows it like the other contract fields', () => {
    setContract(db, 1, anna, { ...contract, fixedTermUntil: '2027-07-31' })
    expect(getEmployee(db, 1, anna, TODAY, rolePermissions(db, 'provider')).contract).toMatchObject({ fixedTermUntil: '2027-07-31' })
    setContract(db, 1, anna, { ...contract, payLevel: 4 })
    expect(getEmployee(db, 1, anna, TODAY, rolePermissions(db, 'provider')).contract).toMatchObject({ payLevel: 4, fixedTermUntil: '2027-07-31' })
    expect(getEmployee(db, 1, anna, TODAY, rolePermissions(db, 'admin'))).not.toHaveProperty('contract')
    expect(getEmployee(db, 1, anna, TODAY, LEITUNG)).not.toHaveProperty('contract')
    setContractVisibleToAdmins(db, true)
    expect(getEmployee(db, 1, anna, TODAY, rolePermissions(db, 'admin')).contract!.fixedTermUntil).toBe('2027-07-31')
    expect(listEmployees(db, 1, TODAY, rolePermissions(db, 'admin'))[0]!.contract!.fixedTermUntil).toBe('2027-07-31')
    setContract(db, 1, anna, { ...contract, fixedTermUntil: null })
    expect(getEmployee(db, 1, anna, TODAY, rolePermissions(db, 'provider')).contract!.fixedTermUntil).toBeNull()
    expect(errorCode(() => setContract(db, 1, anna, { ...contract, fixedTermUntil: '2027-02-30' }))).toBe('invalid_date')
  })
})

describe('personnel file: the archive flag of the 10-year category', () => {
  it('counts contract and salary documents as data of the paid-overtime period', () => {
    const db = createTestDb()
    const [anna, ben, carla, dora] = ['Anna', 'Ben', 'Carla', 'Dora'].map(name => addEmployee(db, name, { leftOn: '2026-03-15' }))
    addEmployeeDocument(db, anna!, 'contract')
    addEmployeeDocument(db, ben!, 'salary')
    addEmployeeDocument(db, carla!, 'qualifications')
    addAdjustment(db, 1, dora!, { date: '2026-02-28', minutes: -600, reason: 'Ausgezahlt', paidOut: true })
    const flags = new Map(listEmployees(db, 1, TODAY, rolePermissions(db, 'admin')).map(employee => [employee.id, employee.hasPaidOut]))
    expect([anna, ben, carla, dora].map(id => flags.get(id!))).toEqual([true, true, false, true])
    expect(getEmployee(db, 1, ben!, TODAY, rolePermissions(db, 'admin')).hasPaidOut).toBe(true)
    expect(getEmployee(db, 1, carla!, TODAY, rolePermissions(db, 'admin')).hasPaidOut).toBe(false)
  })
})

describe('personnel file: never in the own pages or at the tablet', () => {
  it('keeps the PIN hash and the personal and sensitive columns out of the employee records (which get spread)', () => {
    const db = createTestDb()
    const anna = addEmployee(db, 'Anna')
    db.update(employees).set({ street: 'GEHEIM', nationality: 'GEHEIM', pinHash: 'GEHEIM' }).where(eq(employees.id, anna)).run()
    for (const record of [loadEmployee(db, anna)!, loadEmployees(db, 1)[0]!]) {
      expect(JSON.stringify(record)).not.toContain('GEHEIM')
      for (const key of ['pinHash', 'birthYear', 'street', 'postalCode', 'city', 'phone', 'email', 'nationality', 'disability',
        'disabilityDegree', 'disabilityEqual', 'disabilityUntil']) expect(record, key).not.toHaveProperty(key)
      expect(record).toHaveProperty('fixedTermUntil')
    }
  })

  it('sends none of the new fields in the my/* answers, the tablet status or the tablet plan', () => {
    const db = createTestDb()
    const anna = addEmployee(db, 'Anna')
    db.update(employees).set({
      birthday: '03-14', birthYear: 1988, street: 'GEHEIM-Strasse', postalCode: '79098', city: 'GEHEIM-Ort', phone: 'GEHEIM-Tel',
      email: 'geheim@example.org', nationality: 'GEHEIM-Land', disability: true, disabilityDegree: 50, disabilityEqual: true,
      disabilityUntil: '2028-12-31', fixedTermUntil: '2027-07-31',
    }).where(eq(employees.id, anna)).run()
    const own: SessionUser = addUser(db, 'anna', 'observer', anna)
    const tablet = addUser(db, 'tablet', 'terminal')
    releaseMonth(db, addUser(db, 'leitung', 'admin'), 1, 2026, 10, new Date('2026-09-25T10:00:00Z'))
    const answers = [
      getMyPlan(db, own, 2026, 10, TODAY),
      getMyTime(db, own, 2026, 10),
      getLeaveAccount(db, anna, 2026, TODAY),
      getMyYearCalendar(db, own, 2026),
      getMyRequirements(db, own, TODAY),
      terminalStatus(db, 1),
      getMonthPlan(db, tablet, 1, 2026, 10, TODAY),
    ].map(answer => JSON.stringify(answer))
    for (const text of answers) {
      for (const word of ['GEHEIM', 'geheim', '1988', '2028-12-31', '2027-07-31', 'birthYear', 'street', 'postalCode', 'nationality',
        'disability', 'fixedTermUntil', 'personal', 'sensitive', 'payroll', 'iban']) {
        expect(text, word).not.toContain(word)
      }
    }
  })
})
