import { isValidIsoDate } from '#shared/domain/dates'
import type { PermissionKey } from '#shared/domain/permissions'
import {
  EMPLOYEE_DOCUMENT_FOLDERS, FOLDER_PERMISSION, ibanError, normalizeIban, svNumberError, taxClassError, taxIdError,
  type EmployeeDocumentFolder, type PersonnelError,
} from '#shared/domain/personnel'
import type { EmployeePayrollDto, EmployeePersonalDto, EmployeePersonalInput, EmployeeSensitiveDto } from '#shared/types/api'

/**
 * The personnel file pages (spec Personalakte): masking and grouping of the payroll values, the form fields of the
 * personal and sensitive blocks and of „Lohn und Steuer“, which form field a format error belongs to, and the
 * document folders a viewer sees. Everything the server checks again; this only shows it early and at the field.
 */

/** The dot that stands for a hidden character. */
export const MASK_DOT = '•'
/** A value hidden completely (Konfession): always the same length, so it tells nothing about the value. */
export const FULL_MASK = MASK_DOT.repeat(6)

const groupsOf = (text: string, size = 4) => text.match(new RegExp(`.{1,${size}}`, 'g'))?.join(' ') ?? ''

/** An IBAN in groups of four, upper case: „DE89 3704 0044 0532 0130 00“. Empty stays empty. */
export function formatIban(value: string | null | undefined): string {
  return value ? groupsOf(normalizeIban(value)) : ''
}

/**
 * An IBAN with only the country code and the last four characters visible, the rest as dots in groups of four and the
 * last four as a group of their own: „DE•• •••• •••• •••• •• 3000“. Very short values are hidden completely.
 */
export function maskIban(value: string | null | undefined): string {
  if (!value) return ''
  const iban = normalizeIban(value)
  if (iban.length <= 6) return MASK_DOT.repeat(iban.length)
  const hidden = `${iban.slice(0, 2)}${MASK_DOT.repeat(iban.length - 6)}`
  return `${groupsOf(hidden)} ${iban.slice(-4)}`
}

/** A value with only its last `visible` characters shown (spaces dropped): Steuer-ID „••••••••901“. */
export function maskTail(value: string | null | undefined, visible = 3): string {
  if (!value) return ''
  const text = value.replace(/\s+/g, '')
  if (text.length <= visible) return MASK_DOT.repeat(text.length)
  return `${MASK_DOT.repeat(text.length - visible)}${text.slice(-visible)}`
}

/** The payroll values the page shows, masked or in full; empty values are null (the page shows „–“). */
export type PayrollKey = keyof EmployeePayrollDto
export function payrollDisplay(payroll: EmployeePayrollDto, key: PayrollKey, revealed: boolean): string | null {
  const value = payroll[key]
  if (value === null || value === '') return null
  if (key === 'taxClass') return String(value)
  const text = String(value)
  if (key === 'iban') return revealed ? formatIban(text) : maskIban(text)
  if (revealed) return text
  if (key === 'taxId' || key === 'svNumber') return maskTail(text, 3)
  if (key === 'denomination') return FULL_MASK
  return text
}

/** Whether a payroll value is hidden until „anzeigen“ (the others are shown as they are). */
export const MASKED_PAYROLL: readonly PayrollKey[] = ['taxId', 'svNumber', 'iban', 'denomination']

/** The form field a personnel format error belongs to (the page shows the text there). */
export const FIELD_OF_ERROR: Record<PersonnelError, string> = {
  iban_invalid: 'iban', tax_id_invalid: 'taxId', sv_number_invalid: 'svNumber', tax_class_invalid: 'taxClass',
  email_invalid: 'email', postal_code_invalid: 'postalCode', birth_year_invalid: 'birthYear',
  disability_degree_invalid: 'disabilityDegree',
}

/** `{ field: code }` for a server error code that belongs to a field; empty for any other code. */
export function fieldErrorOf(code: string | undefined): Record<string, PersonnelError> {
  return code && code in FIELD_OF_ERROR ? { [FIELD_OF_ERROR[code as PersonnelError]]: code as PersonnelError } : {}
}

// --- Persönliche Daten (employees.personal) ---------------------------------------------------------------------------

/** The form of the personal block; the year as typed (empty = none). */
export interface PersonalFields {
  birthYear: string
  street: string
  postalCode: string
  city: string
  phone: string
  email: string
}

export function personalFieldsOf(saved: EmployeePersonalDto | undefined): PersonalFields {
  return {
    birthYear: saved?.birthYear == null ? '' : String(saved.birthYear),
    street: saved?.street ?? '', postalCode: saved?.postalCode ?? '', city: saved?.city ?? '',
    phone: saved?.phone ?? '', email: saved?.email ?? '',
  }
}

const textOrNull = (value: string) => (String(value).trim() === '' ? null : String(value).trim())

/** The personal block to send; a year that is no whole number is an error at its field (the range the server checks). */
export function personalInput(fields: PersonalFields): { value: EmployeePersonalInput } | { error: 'birth_year_invalid' } {
  const yearText = String(fields.birthYear).trim()
  const birthYear = yearText === '' ? null : Number(yearText)
  if (birthYear !== null && (!/^\d{4}$/.test(yearText) || !Number.isInteger(birthYear))) return { error: 'birth_year_invalid' }
  return {
    value: {
      birthYear, street: textOrNull(fields.street), postalCode: textOrNull(fields.postalCode), city: textOrNull(fields.city),
      phone: textOrNull(fields.phone), email: textOrNull(fields.email),
    },
  }
}

/** The full birth date (ISO) from the birthday selects (0 = none) and the typed year; null unless it is a real date. */
export function fullBirthDate(day: number, month: number, yearText: string): string | null {
  const year = String(yearText).trim()
  if (!day || !month || !/^\d{4}$/.test(year)) return null
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return isValidIsoDate(iso) ? iso : null
}

// --- Staatsangehörigkeit und Schwerbehinderung (employees.sensitive) ----------------------------------------------------

/** Grad der Behinderung: 20 to 100 in steps of 10. */
export const DISABILITY_DEGREES = [20, 30, 40, 50, 60, 70, 80, 90, 100] as const

/** The form of the sensitive block; degree 0 = not chosen, the date '' = none. */
export interface SensitiveFields {
  nationality: string
  disability: boolean
  disabilityDegree: number
  disabilityEqual: boolean
  disabilityUntil: string
}

export function sensitiveFieldsOf(saved: EmployeeSensitiveDto | undefined): SensitiveFields {
  return {
    nationality: saved?.nationality ?? '', disability: saved?.disability ?? false, disabilityDegree: saved?.disabilityDegree ?? 0,
    disabilityEqual: saved?.disabilityEqual ?? false, disabilityUntil: saved?.disabilityUntil ?? '',
  }
}

/** The sensitive block to send; without „Schwerbehinderung“ its details are sent empty (the server clears them too). */
export function sensitiveInput(fields: SensitiveFields): EmployeeSensitiveDto {
  const on = fields.disability
  return {
    nationality: textOrNull(fields.nationality), disability: on,
    disabilityDegree: on && fields.disabilityDegree ? fields.disabilityDegree : null,
    disabilityEqual: on && fields.disabilityEqual,
    disabilityUntil: on && fields.disabilityUntil ? fields.disabilityUntil : null,
  }
}

// --- Lohn und Steuer (employees.payroll) --------------------------------------------------------------------------------

/** The form of „Lohn und Steuer“; tax class 0 = none. */
export interface PayrollFields {
  taxId: string
  taxClass: number
  svNumber: string
  healthInsurer: string
  iban: string
  accountHolder: string
  denomination: string
}

export function payrollFieldsOf(saved: EmployeePayrollDto | null | undefined): PayrollFields {
  return {
    taxId: saved?.taxId ?? '', taxClass: saved?.taxClass ?? 0, svNumber: saved?.svNumber ?? '',
    healthInsurer: saved?.healthInsurer ?? '', iban: formatIban(saved?.iban), accountHolder: saved?.accountHolder ?? '',
    denomination: saved?.denomination ?? '',
  }
}

/** The payroll body, or the format errors per field (the same checks as the server's; empty is always fine). */
export function payrollInput(fields: PayrollFields): { value: EmployeePayrollDto } | { errors: Record<string, PersonnelError> } {
  const taxClass = fields.taxClass ? fields.taxClass : null
  const checks: [string, PersonnelError | null][] = [
    ['taxId', taxIdError(fields.taxId)], ['taxClass', taxClassError(taxClass)],
    ['svNumber', svNumberError(fields.svNumber)], ['iban', ibanError(fields.iban)],
  ]
  const errors = Object.fromEntries(checks.filter((check): check is [string, PersonnelError] => check[1] !== null))
  if (Object.keys(errors).length) return { errors }
  return {
    value: {
      taxId: textOrNull(fields.taxId), taxClass, svNumber: textOrNull(fields.svNumber), healthInsurer: textOrNull(fields.healthInsurer),
      iban: textOrNull(fields.iban), accountHolder: textOrNull(fields.accountHolder), denomination: textOrNull(fields.denomination),
    },
  }
}

// --- Dokumente ----------------------------------------------------------------------------------------------------------

/** The folders the viewer may use, in the page's order (the server answers with the same ones). */
export function visibleFolders(can: (key: PermissionKey) => boolean): EmployeeDocumentFolder[] {
  return EMPLOYEE_DOCUMENT_FOLDERS.filter(folder => can(FOLDER_PERMISSION[folder]))
}

/** Where a personnel file document is served; `download` asks for an attachment instead of showing it. */
export const employeeDocumentUrl = (id: number, download = false): string => `/api/employee-documents/${id}${download ? '?download=1' : ''}`
