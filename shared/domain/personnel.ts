import { isValidIsoDate } from './dates'
import type { PermissionKey } from './permissions'

/**
 * The personnel file (spec Personalakte): validators of the master data and the payroll fields, and the document
 * folders. Each validator answers null (fine; an empty value is always fine) or an error code, which the services
 * throw as 400 and `de.errors` / `de.personnel.invalid` explain in German.
 */

export type PersonnelError =
  | 'iban_invalid' | 'tax_id_invalid' | 'sv_number_invalid' | 'tax_class_invalid' | 'email_invalid' | 'postal_code_invalid'
  | 'disability_degree_invalid' | 'birth_year_invalid'

/** The folders of the „Dokumente“ tab, in the order the page shows them. */
export const EMPLOYEE_DOCUMENT_FOLDERS = ['contract', 'application', 'qualifications', 'correspondence', 'measures', 'salary'] as const
export type EmployeeDocumentFolder = typeof EMPLOYEE_DOCUMENT_FOLDERS[number]

/** The key that lets a person see, upload and delete the documents of a folder. */
export const FOLDER_PERMISSION: Record<EmployeeDocumentFolder, PermissionKey> = {
  contract: 'employees.docs.contract',
  application: 'employees.docs.application',
  qualifications: 'employees.docs.qualifications',
  correspondence: 'employees.docs.correspondence',
  measures: 'employees.docs.measures',
  salary: 'employees.docs.salary',
}

/**
 * The retention category of a folder's documents after leaving (spec §7): contract and salary with the paid overtime
 * (10 years), the rest with the assessments (3 years). server/services/employeeDeletion.ts derives its row lists from it.
 */
export const FOLDER_RETENTION: Record<EmployeeDocumentFolder, 'assessment' | 'paidOvertime'> = {
  contract: 'paidOvertime',
  application: 'assessment',
  qualifications: 'assessment',
  correspondence: 'assessment',
  measures: 'assessment',
  salary: 'paidOvertime',
}

const isEmpty = (value: string | null | undefined): value is null | undefined | '' => value == null || value.trim() === ''
const withoutSpaces = (value: string) => value.replace(/\s+/g, '')

/** An IBAN as stored: upper case, without spaces. */
export function normalizeIban(value: string): string {
  return withoutSpaces(value).toUpperCase()
}

/** Steuer-ID as stored: the digits without spaces. */
export function normalizeTaxId(value: string): string {
  return withoutSpaces(value)
}

/** SV-Nummer as stored: upper case, without spaces. */
export function normalizeSvNumber(value: string): string {
  return withoutSpaces(value).toUpperCase()
}

/** The remainder of a long digit string modulo 97, piecewise (the number is too long for a double). */
function mod97(digits: string): number {
  let rest = 0
  for (let start = 0; start < digits.length; start += 7) rest = Number(`${rest}${digits.slice(start, start + 7)}`) % 97
  return rest
}

/**
 * IBAN (ISO 13616): country code, two check digits and 11–30 letters or digits (15–34 characters in all; a German IBAN
 * has exactly 22), and the ISO 7064 MOD 97-10 check (the first four characters moved to the end, letters as 10–35,
 * the number modulo 97 must be 1). The country-specific layout of the other countries is not checked.
 */
export function ibanError(value: string | null | undefined): PersonnelError | null {
  if (isEmpty(value)) return null
  const iban = normalizeIban(value)
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return 'iban_invalid'
  if (iban.startsWith('DE') && iban.length !== 22) return 'iban_invalid'
  const digits = `${iban.slice(4)}${iban.slice(0, 4)}`.replace(/[A-Z]/g, letter => String(letter.charCodeAt(0) - 55))
  return mod97(digits) === 1 ? null : 'iban_invalid'
}

/**
 * Steuerliche Identifikationsnummer: 11 digits, the first not 0, the last the check digit of ISO 7064 MOD 11,10 over
 * the first ten. The rule on how often a digit may repeat among the first ten is not checked (it has changed over
 * the years; the check digit catches typing errors anyway).
 */
export function taxIdError(value: string | null | undefined): PersonnelError | null {
  if (isEmpty(value)) return null
  const id = normalizeTaxId(value)
  if (!/^[1-9]\d{10}$/.test(id)) return 'tax_id_invalid'
  let product = 10
  for (let index = 0; index < 10; index++) {
    let sum = (Number(id[index]) + product) % 10
    if (sum === 0) sum = 10
    product = (sum * 2) % 11
  }
  const check = (11 - product) % 10
  return check === Number(id[10]) ? null : 'tax_id_invalid'
}

const SV_WEIGHTS = [2, 1, 2, 5, 7, 1, 2, 1, 2, 1, 2, 1]

/**
 * Sozialversicherungsnummer (Rentenversicherungsnummer): area number (2 digits), birth date (6 digits), the initial
 * letter of the birth name, serial number (2 digits) and a check digit: the letter becomes its position in the
 * alphabet (two digits), the first twelve digits are weighted 2 1 2 5 7 1 2 1 2 1 2 1, the digit sums of the products
 * are added up, modulo 10. The birth date and the area number are not checked further.
 */
export function svNumberError(value: string | null | undefined): PersonnelError | null {
  if (isEmpty(value)) return null
  const number = normalizeSvNumber(value)
  if (!/^\d{8}[A-Z]\d{3}$/.test(number)) return 'sv_number_invalid'
  const letter = String(number.charCodeAt(8) - 64).padStart(2, '0')
  const digits = `${number.slice(0, 8)}${letter}${number.slice(9, 11)}`
  const sum = SV_WEIGHTS.reduce((total, weight, index) => {
    const product = Number(digits[index]) * weight
    return total + Math.floor(product / 10) + (product % 10)
  }, 0)
  return sum % 10 === Number(number[11]) ? null : 'sv_number_invalid'
}

/** Steuerklasse 1 to 6. */
export function taxClassError(value: number | null | undefined): PersonnelError | null {
  if (value == null) return null
  return Number.isInteger(value) && value >= 1 && value <= 6 ? null : 'tax_class_invalid'
}

/** An e-mail address of the basic shape `name@domain.tld`, no spaces (whether it exists is not checked). */
export function emailError(value: string | null | undefined): PersonnelError | null {
  if (isEmpty(value)) return null
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? null : 'email_invalid'
}

/** A German postal code: 5 digits. */
export function postalCodeError(value: string | null | undefined): PersonnelError | null {
  if (isEmpty(value)) return null
  return /^\d{5}$/.test(value.trim()) ? null : 'postal_code_invalid'
}

/** Grad der Behinderung: 20 to 100 in steps of 10. */
export function disabilityDegreeError(value: number | null | undefined): PersonnelError | null {
  if (value == null) return null
  return Number.isInteger(value) && value >= 20 && value <= 100 && value % 10 === 0 ? null : 'disability_degree_invalid'
}

/**
 * The year of birth, which with the birthday (`MM-DD`, null = not given) forms the full date: a whole year from 1900
 * to `currentYear`, and the date must exist (29 February only in a leap year).
 */
export function birthYearError(
  value: number | null | undefined, birthday: string | null | undefined, currentYear: number,
): PersonnelError | null {
  if (value == null) return null
  if (!Number.isInteger(value) || value < 1900 || value > currentYear) return 'birth_year_invalid'
  if (birthday && !isValidIsoDate(`${value}-${birthday}`)) return 'birth_year_invalid'
  return null
}
