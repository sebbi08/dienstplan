import { addDays, parseIsoDate, toIsoDate } from './dates'
import type { Role } from '../types/api'
import type { IsoDate } from './types'

export type EmployeeDeleteMode = 'off' | 'provider' | 'managers'

export const EMPLOYEE_DELETE_MODES: readonly EmployeeDeleteMode[] = ['off', 'provider', 'managers']

export interface RetentionSettings {
  timeYears: number
  assessmentYears: number
  /**
   * „Ausgezahlte Überstunden, Verträge, Gehalt“: default 8 years, the period of Buchungsbelege since 1 January 2025
   * (§ 147 Abs. 3 AO, § 257 Abs. 4 HGB as amended by the Bürokratieentlastungsgesetz IV; 10 before, migration 0105).
   */
  paidOvertimeYears: number
  /** Information only: pension-relevant records are kept this long elsewhere. */
  pensionYears: number
  cashYears: number
  /** BEM records (§ 167 Abs. 2 SGB IX): whole years after the process ended (completed, declined, no answer). */
  bemYears: number
  /** Mutterschutz records (MuSchG): whole years after the case ended (§ 27 Abs. 5 MuSchG: kept 2 years). */
  maternityYears: number
  employeeDelete: EmployeeDeleteMode
  /**
   * „Lohnunterlagen bewahrt ein Lohnbüro/Steuerbüro auf“: yes (default) = „Lohn und Steuer“ of someone who left may be
   * deleted the day after leaving, like the other personal data; no = the facility keeps them itself, PAYROLL_YEARS
   * after the end of the leaving year (§ 41 EStG Lohnkonto, § 147 AO).
   */
  payrollOffice: boolean
}

/** Without a Lohnbüro: „Lohn und Steuer“ are kept 6 years after the end of the leaving year (§ 41 EStG, § 147 AO). */
export const PAYROLL_YEARS = 6

export const RETENTION_DEFAULTS: RetentionSettings = {
  timeYears: 2,
  assessmentYears: 3,
  paidOvertimeYears: 8,
  pensionYears: 30,
  cashYears: 10,
  bemYears: 3,
  maternityYears: 2,
  employeeDelete: 'managers',
  payrollOffice: true,
}

export const RETENTION_YEARS_RANGE = { min: 1, max: 40 } as const
/**
 * „Ausgezahlte Überstunden, Verträge, Gehalt“ are kept at least this long: Buchungsbelege 8 years (§ 147 Abs. 3 AO,
 * § 257 Abs. 4 HGB); it also covers the 5 years of the accident reports in it (DGUV Vorschrift 1 § 24 Abs. 6).
 */
export const PAID_OVERTIME_MIN_YEARS = 8
export const RETENTION_CASH_YEARS_RANGE = { min: 1, max: 30 } as const

/** Domain error with a machine-readable code; services map it to a 400. */
export class RetentionSettingsError extends Error {
  constructor(public readonly code: string = 'retention_settings_invalid') {
    super(code)
    this.name = 'RetentionSettingsError'
  }
}

/** 1 January of the year after `years` full years following the year of `date`. */
function firstJanuaryAfter(date: IsoDate, years: number): IsoDate {
  return toIsoDate(parseIsoDate(date).year + years + 1, 1, 1)
}

/**
 * The first day each category of someone who left on `leftOn` may be deleted. `payroll` („Lohn und Steuer“): with a
 * Lohnbüro the day after leaving (with the personal data), without one 1 January after the leaving year + 6 years.
 */
export function retentionDueDates(leftOn: IsoDate, settings: RetentionSettings): {
  immediate: IsoDate; time: IsoDate; assessment: IsoDate; paidOvertime: IsoDate; payroll: IsoDate
} {
  const immediate = addDays(leftOn, 1)
  return {
    immediate,
    time: firstJanuaryAfter(leftOn, settings.timeYears),
    assessment: firstJanuaryAfter(leftOn, settings.assessmentYears),
    // Never below 8 years, also for a lower value stored before (PAID_OVERTIME_MIN_YEARS).
    paidOvertime: firstJanuaryAfter(leftOn, Math.max(settings.paidOvertimeYears, PAID_OVERTIME_MIN_YEARS)),
    payroll: settings.payrollOffice ? immediate : firstJanuaryAfter(leftOn, PAYROLL_YEARS),
  }
}

/**
 * Whether the role may delete a left employee by hand („Endgültig löschen“) under the Träger setting: aus nobody, nur
 * Träger the Träger, Leitung und Träger both. The other guards (own record, Träger account, not left yet) come on top.
 */
export function mayDeleteEmployeeByHand(mode: EmployeeDeleteMode, role: Role | null | undefined): boolean {
  if (mode === 'off') return false
  if (mode === 'provider') return role === 'provider'
  return role === 'provider' || role === 'admin'
}

/** First day a cash box may be deleted, from the date its period starts at; null = nothing to keep, deletable any time. */
export function cashDeletableFrom(lastEntryDate: IsoDate | null, cashYears: number): IsoDate | null {
  return lastEntryDate === null ? null : firstJanuaryAfter(lastEntryDate, cashYears)
}

function years(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new RetentionSettingsError()
  }
  return value
}

/**
 * Whole years 1–40 (cash 1–30) and a delete mode, otherwise retention_settings_invalid. „Ausgezahlte Überstunden,
 * Verträge, Gehalt“ at least PAID_OVERTIME_MIN_YEARS (retention_paid_overtime_too_short); a lower value stored before
 * (`storedPaidOvertimeYears`, kept unchanged) is still accepted – it counts as 8 anyway (retentionDueDates).
 */
export function checkRetentionSettings(input: unknown, storedPaidOvertimeYears?: number): RetentionSettings {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new RetentionSettingsError()
  const raw = input as Record<string, unknown>
  const { min, max } = RETENTION_YEARS_RANGE
  const mode = raw.employeeDelete
  if (!EMPLOYEE_DELETE_MODES.includes(mode as EmployeeDeleteMode)) throw new RetentionSettingsError()
  if (typeof raw.payrollOffice !== 'boolean') throw new RetentionSettingsError()
  const paidOvertimeYears = years(raw.paidOvertimeYears, min, max)
  if (paidOvertimeYears < PAID_OVERTIME_MIN_YEARS && paidOvertimeYears !== storedPaidOvertimeYears) {
    throw new RetentionSettingsError('retention_paid_overtime_too_short')
  }
  return {
    timeYears: years(raw.timeYears, min, max),
    assessmentYears: years(raw.assessmentYears, min, max),
    paidOvertimeYears,
    pensionYears: years(raw.pensionYears, min, max),
    cashYears: years(raw.cashYears, RETENTION_CASH_YEARS_RANGE.min, RETENTION_CASH_YEARS_RANGE.max),
    bemYears: years(raw.bemYears, min, max),
    maternityYears: years(raw.maternityYears, min, max),
    employeeDelete: mode as EmployeeDeleteMode,
    payrollOffice: raw.payrollOffice,
  }
}
