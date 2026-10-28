import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { employeePayroll } from '../../server/db/schema'
import { categoryHasData } from '../../server/services/employeeDeletion'
import { getPayroll, setPayroll } from '../../server/services/employeePayroll'
import type { EmployeePayrollDto } from '../../shared/types/api'
import { addEmployee, addFacility, createTestDb, errorCode } from '../helpers/fixtures'

const EMPTY: EmployeePayrollDto = {
  taxId: null, taxClass: null, svNumber: null, healthInsurer: null, iban: null, accountHolder: null, denomination: null,
}
const VALID: EmployeePayrollDto = {
  taxId: '86 095 742 719', taxClass: 1, svNumber: '15 070649 c 103', healthInsurer: ' AOK ', iban: 'de89 3704 0044 0532 0130 00',
  accountHolder: 'Anna Muster', denomination: 'rk',
}

describe('payroll data (Lohn und Steuer)', () => {
  let db: Db
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    anna = addEmployee(db, 'Anna')
  })

  it('answers empty values while nothing is stored', () => {
    expect(getPayroll(db, 1, anna)).toEqual(EMPTY)
  })

  it('stores the values normalised and returns them in full', () => {
    setPayroll(db, 1, anna, VALID)
    expect(getPayroll(db, 1, anna)).toEqual({
      taxId: '86095742719', taxClass: 1, svNumber: '15070649C103', healthInsurer: 'AOK', iban: 'DE89370400440532013000',
      accountHolder: 'Anna Muster', denomination: 'rk',
    })
    setPayroll(db, 1, anna, { ...VALID, taxClass: 6, healthInsurer: 'TK' })
    expect(getPayroll(db, 1, anna)).toMatchObject({ taxClass: 6, healthInsurer: 'TK' })
    expect(db.select().from(employeePayroll).all()).toHaveLength(1)
  })

  it('refuses an invalid IBAN, Steuer-ID, SV-Nummer or tax class (400 with the code) and keeps what was stored', () => {
    setPayroll(db, 1, anna, VALID)
    const before = getPayroll(db, 1, anna)
    const cases: [Partial<EmployeePayrollDto>, string][] = [
      [{ iban: 'DE89370400440532013001' }, 'iban_invalid'],
      [{ iban: 'DE8937040044053201300' }, 'iban_invalid'],
      [{ taxId: '86095742718' }, 'tax_id_invalid'],
      [{ taxId: '8609574271' }, 'tax_id_invalid'],
      [{ svNumber: '15070649C104' }, 'sv_number_invalid'],
      [{ svNumber: '150706491103' }, 'sv_number_invalid'],
      [{ taxClass: 0 }, 'tax_class_invalid'],
      [{ taxClass: 7 }, 'tax_class_invalid'],
      [{ taxClass: 2.5 }, 'tax_class_invalid'],
    ]
    for (const [fields, code] of cases) {
      let status: number | undefined
      try {
        setPayroll(db, 1, anna, { ...VALID, ...fields })
      }
      catch (error) {
        status = (error as { statusCode?: number }).statusCode
      }
      expect(status, code).toBe(400)
      expect(errorCode(() => setPayroll(db, 1, anna, { ...VALID, ...fields })), code).toBe(code)
    }
    expect(getPayroll(db, 1, anna)).toEqual(before)
  })

  it('accepts empty values and removes the row once everything is empty (nothing left for the retention overview)', () => {
    setPayroll(db, 1, anna, { ...EMPTY, taxId: ' ', iban: '', svNumber: '  ', healthInsurer: 'AOK' })
    expect(getPayroll(db, 1, anna)).toEqual({ ...EMPTY, healthInsurer: 'AOK' })
    expect(categoryHasData(db, anna).immediate).toBe(true)
    setPayroll(db, 1, anna, { ...EMPTY, healthInsurer: ' ' })
    expect(db.select().from(employeePayroll).all()).toEqual([])
    expect(getPayroll(db, 1, anna)).toEqual(EMPTY)
    expect(categoryHasData(db, anna).immediate).toBe(false)
  })

  it('keeps another facility\'s employee unconfirmed (404)', () => {
    const hort = addFacility(db, 'Hort')
    const other = addEmployee(db, 'Olga', { facilityId: hort })
    expect(errorCode(() => getPayroll(db, 1, other))).toBe('employee_not_found')
    expect(errorCode(() => setPayroll(db, 1, other, VALID))).toBe('employee_not_found')
    expect(errorCode(() => getPayroll(db, 1, 999))).toBe('employee_not_found')
  })
})
