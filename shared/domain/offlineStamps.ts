/**
 * Stamping at the facility tablet without network (docs/BETRIEB.md „Stempeln ohne Netz am Tablet“): the tablet keeps
 * the stamps with its own clock and sends them later (POST /api/terminal/offline-stamps); the server checks each one
 * (server/services/offlineStamps.ts).
 */

/** A stamp may lie this far in the future of the server's clock (a tablet clock a little ahead). */
export const OFFLINE_FUTURE_TOLERANCE_MINUTES = 5
/** A tablet clock known to be ahead (from the same request) widens that tolerance by its difference, at most this much. */
export const OFFLINE_SKEW_TOLERANCE_MAX_MINUTES = 60
/** Older stamps are not taken over (they go to the review list instead). */
export const OFFLINE_MAX_AGE_DAYS = 7
/** A tablet clock further off than this gets the mark „Uhrzeit des Tablets wich ab“ on the stamps it sends. */
export const CLOCK_SKEW_LIMIT_MINUTES = 5
/** At most this many stamps per request; the rest follow with the next one. */
export const OFFLINE_BATCH_MAX = 50
/** At most this many PIN checks per request (scrypt is slow); stamps beyond stay in the tablet's queue for the next one. */
export const OFFLINE_PIN_CHECKS_MAX = 10
/** At most this many requests per tablet account and minute. */
export const OFFLINE_REQUESTS_PER_MINUTE = 10
/** At most this many open hints per person; further ones are kept as checked (in the log, not on the list). */
export const OFFLINE_MAX_OPEN_HINTS = 20

/** What became of an offline stamp: taken over, already known (same client id), put on the review list, or refused. */
export type OfflineStampStatus = 'recorded' | 'duplicate' | 'review' | 'rejected'

/**
 * What the tablet is told: `done` (taken over, or known already) or `rejected` (anything else). No reason, so the
 * answer does not tell whether a PIN was right.
 */
export type OfflineTabletStatus = 'done' | 'rejected'

/**
 * Why a stamp was not taken over. With a hint on the review list of the time page (Leitung/Träger): a wrong or missing
 * PIN, a locked PIN, a time in the future or too old, stamps that do not fit the existing records (Kommt while clocked
 * in, Geht without Kommt, before a later recorded period) and stamps the server failed to handle. Without a hint: a
 * person who is no longer employed that day, or a day without time tracking (a person the tablet does not know is
 * refused without being stored).
 */
export type OfflineStampReason =
  | 'pin_invalid' | 'pin_missing' | 'pin_locked' | 'in_future' | 'too_old'
  | 'already_clocked_in' | 'not_clocked_in' | 'overlap' | 'failed'
  | 'employee_not_found' | 'not_employed' | 'time_tracking_off'

/** The reasons that leave a hint on the review list. */
export const OFFLINE_HINT_REASONS: readonly OfflineStampReason[] = [
  'pin_invalid', 'pin_missing', 'pin_locked', 'in_future', 'too_old', 'already_clocked_in', 'not_clocked_in', 'overlap', 'failed',
]

/**
 * Whether a stamp at `stampedAt` may be taken over at `now`: at most 5 minutes ahead (plus the tablet's known lead
 * `skewMinutes`, at most 60) and at most 7 days old.
 */
export function offlineStampTimeCheck(stampedAt: Date, now: Date, skewMinutes: number | null = null): 'ok' | 'in_future' | 'too_old' {
  const diff = stampedAt.getTime() - now.getTime()
  const lead = Math.min(Math.max(skewMinutes ?? 0, 0), OFFLINE_SKEW_TOLERANCE_MAX_MINUTES)
  if (diff > (OFFLINE_FUTURE_TOLERANCE_MINUTES + lead) * 60_000) return 'in_future'
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

/** The tablet's answer for an outcome: only taken over or known already counts as done. */
export function tabletStatus(status: OfflineStampStatus): OfflineTabletStatus {
  return status === 'recorded' || status === 'duplicate' ? 'done' : 'rejected'
}
