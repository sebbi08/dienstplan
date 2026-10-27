import { addDays, parseIsoDate, toIsoDate } from './dates'
import type { IsoDate } from './types'

export type EmployeeDeleteMode = 'off' | 'provider' | 'managers'

export const EMPLOYEE_DELETE_MODES: readonly EmployeeDeleteMode[] = ['off', 'provider', 'managers']

export interface RetentionSettings {
  timeYears: number
  assessmentYears: number
  paidOvertimeYears: number
  /** Information only: pension-relevant records are kept this long elsewhere. */
  pensionYears: number
  cashYears: number
  employeeDelete: EmployeeDeleteMode
}

export const RETENTION_DEFAULTS: RetentionSettings = {
  timeYears: 2,
  assessmentYears: 3,
  paidOvertimeYears: 10,
  pensionYears: 30,
  cashYears: 10,
  employeeDelete: 'managers',
}

export const RETENTION_YEARS_RANGE = { min: 1, max: 40 } as const
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

export function retentionDueDates(leftOn: IsoDate, settings: RetentionSettings): {
  immediate: IsoDate; time: IsoDate; assessment: IsoDate; paidOvertime: IsoDate
} {
  return {
    immediate: addDays(leftOn, 1),
    time: firstJanuaryAfter(leftOn, settings.timeYears),
    assessment: firstJanuaryAfter(leftOn, settings.assessmentYears),
    paidOvertime: firstJanuaryAfter(leftOn, settings.paidOvertimeYears),
  }
}

/** First day a cash box may be deleted; null = no entries, deletable any time. */
export function cashDeletableFrom(lastEntryDate: IsoDate | null, cashYears: number): IsoDate | null {
  return lastEntryDate === null ? null : firstJanuaryAfter(lastEntryDate, cashYears)
}

function years(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new RetentionSettingsError()
  }
  return value
}

export function checkRetentionSettings(input: unknown): RetentionSettings {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new RetentionSettingsError()
  const raw = input as Record<string, unknown>
  const { min, max } = RETENTION_YEARS_RANGE
  const mode = raw.employeeDelete
  if (!EMPLOYEE_DELETE_MODES.includes(mode as EmployeeDeleteMode)) throw new RetentionSettingsError()
  return {
    timeYears: years(raw.timeYears, min, max),
    assessmentYears: years(raw.assessmentYears, min, max),
    paidOvertimeYears: years(raw.paidOvertimeYears, min, max),
    pensionYears: years(raw.pensionYears, min, max),
    cashYears: years(raw.cashYears, RETENTION_CASH_YEARS_RANGE.min, RETENTION_CASH_YEARS_RANGE.max),
    employeeDelete: mode as EmployeeDeleteMode,
  }
}
