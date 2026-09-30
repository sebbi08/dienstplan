import type { CodeKey, CreditMode, DomainEntry, IsoDate } from '../../shared/domain/types'

export function shift(
  employeeId: number, date: IsoDate, start: number, end: number,
  breakStart: number | null = null, breakEnd: number | null = null,
  extra: Partial<DomainEntry> = {},
): DomainEntry {
  return {
    employeeId, date, kind: 'shift', codeKey: null, creditMode: 'timed',
    start, end, breakStart, breakEnd, countsAsStaff: true, ...extra,
  }
}

export function special(employeeId: number, date: IsoDate, start: number, end: number): DomainEntry {
  return shift(employeeId, date, start, end, null, null, { kind: 'special' })
}

export function code(
  employeeId: number, date: IsoDate, codeKey: CodeKey, creditMode: CreditMode,
  start: number | null = null, end: number | null = null,
): DomainEntry {
  return {
    employeeId, date, kind: 'code', codeKey, creditMode,
    start, end, breakStart: null, breakEnd: null, countsAsStaff: true,
  }
}

/** Standard shifts from the spec, in minutes. */
export const F1 = [420, 795, null, null] as const
export const F2 = [450, 945, 700, 730] as const
export const M = [465, 960, 700, 730] as const
export const S = [525, 1020, 730, 760] as const
