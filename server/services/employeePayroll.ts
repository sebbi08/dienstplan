import { eq } from 'drizzle-orm'
import {
  ibanError, normalizeIban, normalizeSvNumber, normalizeTaxId, svNumberError, taxClassError, taxIdError,
} from '../../shared/domain/personnel'
import type { EmployeePayrollDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employeePayroll } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { assertEmployee } from './employees'

/**
 * „Lohn und Steuer“ of the personnel file (spec Personalakte §3): one row per employee, only for employees.payroll
 * (checked by the routes); nothing of it reaches any other answer. The values go out in full: the page masks them, and
 * whoever may not see them gets no answer at all.
 */

const EMPTY: EmployeePayrollDto = {
  taxId: null, taxClass: null, svNumber: null, healthInsurer: null, iban: null, accountHolder: null, denomination: null,
}

/** The employee's payroll data (all null while nothing is stored); the employee must belong to the facility (404). */
export function getPayroll(db: Db, facilityId: number, employeeId: number): EmployeePayrollDto {
  assertEmployee(db, facilityId, employeeId)
  const row = db.select().from(employeePayroll).where(eq(employeePayroll.employeeId, employeeId)).get()
  if (!row) return { ...EMPTY }
  return {
    taxId: row.taxId, taxClass: row.taxClass, svNumber: row.svNumber, healthInsurer: row.healthInsurer, iban: row.iban,
    accountHolder: row.accountHolder, denomination: row.denomination,
  }
}

const textOrNull = (value: string | null): string | null => value?.trim() || null

function fail(code: string | null): void {
  if (code !== null) throw new ServiceError(400, code)
}

/**
 * Replaces the payroll data. Empty values are always fine; IBAN (400 iban_invalid), Steuer-ID (400 tax_id_invalid),
 * SV-Nummer (400 sv_number_invalid) and tax class (400 tax_class_invalid) must be valid, and are stored normalised
 * (without spaces, upper case). When every value is empty the row goes, so the retention overview has nothing left.
 */
export function setPayroll(db: Db, facilityId: number, employeeId: number, input: EmployeePayrollDto): void {
  assertEmployee(db, facilityId, employeeId)
  fail(taxIdError(input.taxId))
  fail(taxClassError(input.taxClass))
  fail(svNumberError(input.svNumber))
  fail(ibanError(input.iban))
  const taxId = textOrNull(input.taxId)
  const svNumber = textOrNull(input.svNumber)
  const iban = textOrNull(input.iban)
  const values: EmployeePayrollDto = {
    taxId: taxId && normalizeTaxId(taxId),
    taxClass: input.taxClass,
    svNumber: svNumber && normalizeSvNumber(svNumber),
    healthInsurer: textOrNull(input.healthInsurer),
    iban: iban && normalizeIban(iban),
    accountHolder: textOrNull(input.accountHolder),
    denomination: textOrNull(input.denomination),
  }
  if (Object.values(values).every(value => value === null)) {
    db.delete(employeePayroll).where(eq(employeePayroll.employeeId, employeeId)).run()
    return
  }
  db.insert(employeePayroll).values({ employeeId, ...values })
    .onConflictDoUpdate({ target: employeePayroll.employeeId, set: values }).run()
}
