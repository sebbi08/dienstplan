import { isValidIsoDate } from './dates'
import type { Qualification } from './staffing/types'
import { monthEnd } from './statutoryLeave'
import { inWindow } from './reminders'
import type { IsoDate } from './types'

/**
 * „Probezeit bis“ of an employee (contract data): the last day of the probation period. A suggestion only, entered and
 * changed by the Träger; the hints never block saving.
 *
 * - Usually up to six months (§ 622 Abs. 3 BGB: the shorter notice period applies only for at most six months).
 * - Trainees (qualification azubi_*): one to four months (§ 20 BBiG).
 */

/** Days before the end from which the Träger and the Leitung are reminded (4 weeks). */
export const PROBATION_NOTICE_DAYS = 28

/** A trainee under the BBiG (Auszubildende; studies are no training under the BBiG). */
export function isTrainee(qualification: Qualification | null | undefined): boolean {
  return qualification?.startsWith('azubi_') ?? false
}

/** The suggested last day: the start plus six months minus a day, for trainees plus four months minus a day. */
export function suggestedProbationUntil(employedSince: IsoDate, qualification: Qualification | null | undefined): IsoDate {
  return monthEnd(employedSince, isTrainee(qualification) ? 4 : 6)
}

/**
 * `tooLong`: more than six months after the start (§ 622 Abs. 3 BGB); `traineeTooLong` / `traineeTooShort`: for a trainee
 * more than four or less than one month (§ 20 BBiG); `beforeStart`: ends before the start. null = fine, or no start.
 */
export type ProbationHint = 'tooLong' | 'traineeTooLong' | 'traineeTooShort' | 'beforeStart'

export function probationHint(
  employedSince: IsoDate | null, until: IsoDate | null, qualification: Qualification | null | undefined,
): ProbationHint | null {
  if (!employedSince || !until || !isValidIsoDate(employedSince) || !isValidIsoDate(until)) return null
  if (until < employedSince) return 'beforeStart'
  if (isTrainee(qualification)) {
    if (until > monthEnd(employedSince, 4)) return 'traineeTooLong'
    return until < monthEnd(employedSince, 1) ? 'traineeTooShort' : null
  }
  return until > monthEnd(employedSince, 6) ? 'tooLong' : null
}

/** A real ISO date from 1970 up to 2100 (checked by the server: 400 probation_until_invalid). */
export function isPlausibleProbationUntil(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && isValidIsoDate(value) && value >= '1970-01-01' && value <= '2100-12-31'
}

/** The probation period is still running today (its last day included). */
export function probationRunning(until: IsoDate | null, today: IsoDate): boolean {
  return until !== null && until >= today
}

/** The reminder „Probezeit von ‹Name› endet am …“: from 28 days before through the last day (null before and after). */
export function probationReminderState(until: IsoDate, today: IsoDate): 'upcoming' | 'today' | null {
  const state = inWindow(until, PROBATION_NOTICE_DAYS, today)
  return state === 'upcoming' || state === 'today' ? state : null
}
