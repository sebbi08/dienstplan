/**
 * Stamping at the facility tablet without network (docs/BETRIEB.md „Stempeln ohne Netz am Tablet“): the tablet keeps
 * the stamps with its own clock and sends them later (POST /api/terminal/offline-stamps); the server checks each one
 * (server/services/offlineStamps.ts).
 */

/** A stamp may lie this far in the future of the server's clock (a tablet clock a little ahead). */
export const OFFLINE_FUTURE_TOLERANCE_MINUTES = 5
/** Older stamps are not taken over (they go to the review list instead). */
export const OFFLINE_MAX_AGE_DAYS = 7
/** A tablet clock further off than this gets the mark „Uhrzeit des Tablets wich ab“ on the stamps it sends. */
export const CLOCK_SKEW_LIMIT_MINUTES = 5
/** At most this many stamps per request; the rest follow with the next one. */
export const OFFLINE_BATCH_MAX = 100
/**
 * Wrong PINs of offline stamps do not count toward the PIN lock (an old queue must not lock anybody out). Instead, while
 * a person has this many wrong-PIN offline stamps the Leitung has not checked yet, further offline stamps of that
 * person are not checked at all (they go to the review list), so the offline route cannot be used to try out PINs.
 */
export const OFFLINE_MAX_OPEN_WRONG_PINS = 5

/** What became of an offline stamp: taken over, already known (same client id), put on the review list, or refused. */
export type OfflineStampStatus = 'recorded' | 'duplicate' | 'review' | 'rejected'

/**
 * Why a stamp was not taken over. With a hint on the review list of the time page (Leitung/Träger): a wrong or missing
 * PIN, too many unchecked wrong PINs, a time in the future or too old, and stamps that do not fit the existing records
 * (Kommt while clocked in, Geht without Kommt, inside a recorded period). Without a hint: a person the tablet does not
 * know, who is no longer employed that day, or a day without time tracking.
 */
export type OfflineStampReason =
  | 'pin_invalid' | 'pin_missing' | 'pin_blocked' | 'in_future' | 'too_old'
  | 'already_clocked_in' | 'not_clocked_in' | 'overlap'
  | 'employee_not_found' | 'not_employed' | 'time_tracking_off'

/** The reasons that leave a hint on the review list. */
export const OFFLINE_HINT_REASONS: readonly OfflineStampReason[] = [
  'pin_invalid', 'pin_missing', 'pin_blocked', 'in_future', 'too_old', 'already_clocked_in', 'not_clocked_in', 'overlap',
]

/** Whether a stamp at `stampedAt` may be taken over at `now`: at most 5 minutes ahead and at most 7 days old. */
export function offlineStampTimeCheck(stampedAt: Date, now: Date): 'ok' | 'in_future' | 'too_old' {
  const diff = stampedAt.getTime() - now.getTime()
  if (diff > OFFLINE_FUTURE_TOLERANCE_MINUTES * 60_000) return 'in_future'
  if (-diff > OFFLINE_MAX_AGE_DAYS * 24 * 60 * 60_000) return 'too_old'
  return 'ok'
}

/**
 * How far the tablet's clock is off (whole minutes, positive = ahead), or null when it is within 5 minutes of the
 * server's clock.
 */
export function clockSkewMinutes(clientNow: Date, serverNow: Date): number | null {
  const minutes = Math.round((clientNow.getTime() - serverNow.getTime()) / 60_000)
  return Math.abs(minutes) > CLOCK_SKEW_LIMIT_MINUTES ? minutes : null
}
