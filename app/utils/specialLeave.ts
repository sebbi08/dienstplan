// The Sonderurlaub periods of a leave account and their reason texts. The texts are imported relative so a test can load
// this file; shared code comes as a value only through #shared (a relative value import breaks the build).
import { isSpecialLeaveReason } from '#shared/domain/specialLeave'
import type { LeaveEntryRange } from '#shared/types/api'
import { de } from '../locales/de'

/** The periods of Sonderurlaub (they have their own list with the reasons). */
export const specialRanges = (ranges: readonly LeaveEntryRange[]) => ranges.filter(range => range.kind === 'special_leave')
/** Every other period (Urlaub, ÜF). */
export const otherRanges = (ranges: readonly LeaveEntryRange[]) => ranges.filter(range => range.kind !== 'special_leave')
/** The days of Sonderurlaub in the list. */
export const specialDays = (ranges: readonly LeaveEntryRange[]) => specialRanges(ranges).reduce((sum, range) => sum + range.days, 0)

/** „Umzug aus dienstlichem Grund (1 Tag) – Text“; empty without a reason (or without the right to see it). */
export function specialLeaveReasonText(range: LeaveEntryRange): string {
  const key = range.reason?.key
  const label = key && isSpecialLeaveReason(key) ? de.specialLeave.reasons[key] : ''
  return [label, range.reason?.text ?? ''].filter(Boolean).join(' – ')
}
