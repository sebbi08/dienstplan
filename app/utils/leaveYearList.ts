import { todayIso } from '#shared/domain/dates'
import type { LeaveAccount } from '#shared/domain/leave'
import type { LeaveEntryKind, LeaveExtraDaySummary, LeaveYearRangeDto, LeaveYearStatus } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate, formatNumber } from '~/utils/format'

/** The filters of „Alle Anträge und Urlaube“ as the page holds them (null = all). */
export interface LeaveFilter {
  employeeId: number | null
  kind: LeaveEntryKind | null
  status: LeaveYearStatus | null
}

export const LEAVE_KINDS: LeaveEntryKind[] = ['vacation', 'special_leave', 'overtime_off']
export const LEAVE_STATUSES: LeaveYearStatus[] = ['open', 'approved', 'rejected', 'withdrawn', 'direct']
const ALL = 'alle'

/**
 * The filters as one path part of the print view („‹Mitarbeiter›-‹Art›-‹Status›“, „alle“ for none), since the PDF
 * download only takes plain paths.
 */
export function encodeLeaveFilter(filter: Partial<LeaveFilter>): string {
  return [filter.employeeId ?? ALL, filter.kind ?? ALL, filter.status ?? ALL].join('-')
}

/** Reads the print view's path part back; anything unknown counts as „alle“. */
export function decodeLeaveFilter(text: string): LeaveFilter {
  const [employee, kind, status] = text.split('-')
  const id = Number(employee)
  return {
    employeeId: Number.isInteger(id) && id > 0 ? id : null,
    kind: LEAVE_KINDS.find(candidate => candidate === kind) ?? null,
    status: LEAVE_STATUSES.find(candidate => candidate === status) ?? null,
  }
}

/** „Antrag genehmigt am ‹Datum›“, „direkt eingetragen“ or „Schließzeit ‹Bezeichnung›“. */
export function rangeOriginText(range: LeaveYearRangeDto): string {
  const t = de.leaveYearList
  if (range.origin === 'closure') return t.originClosure(range.closureLabel ?? '')
  if (range.origin === 'request') return t.originRequest(range.decidedAt ? formatDate(todayIso(new Date(range.decidedAt))) : '')
  return t.originDirect
}

/**
 * Anspruch (+ Zusatztage with their reasons) (+ Übertrag) · genommen · verplant · frei verfügbar, as the leave account
 * counts them.
 */
export function leaveAccountLine(account: LeaveAccount, hasEntitlement: boolean, extraDays: LeaveExtraDaySummary[] = []): string {
  const t = de.leaveYearList
  const n = formatNumber
  if (!hasEntitlement) return [t.noEntitlement, t.taken(n(account.taken)), t.planned(n(account.planned))].join(' · ')
  const reasons = extraDays.map(extra => extra.reason).join(', ')
  const parts = [
    t.entitlement(n(account.entitlement)),
    ...(account.extraDays ? [`${de.leaveExtraDays.count(account.extraDays)}${reasons ? ` (${reasons})` : ''}`] : []),
    ...(account.carriedOver ? [t.carriedOver(n(account.carriedOver))] : []),
  ]
  return [parts.join(' + '), t.taken(n(account.taken)), t.planned(n(account.planned)), t.available(n(account.available))].join(' · ')
}

/** The ISO timestamp as a date (Berlin), '' for none. */
export function timestampDate(timestamp: string | null): string {
  return timestamp ? formatDate(todayIso(new Date(timestamp))) : ''
}
