import { PIN_LOCK_MINUTES } from '#shared/domain/pin'
import type { EmployeeDetailDto } from '#shared/types/api'
import { de } from '../locales/de'
import { errorCode, errorMessage } from './errors'

/** The time of day of a timestamp in Berlin, e.g. "14:35" (PIN locks last at most 30 minutes). */
function clockTime(timestamp: string): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp))
}

/**
 * The tablet's text for a failed PIN try (stamping and unlocking the child records): the try that locks the PIN names
 * the lock time („PIN für 15 Minuten gesperrt.“), every later try during the lock its end („PIN gesperrt bis 14:35.“).
 */
export function pinFailureText(error: unknown): string {
  const code = errorCode(error)
  const details = (error as { data?: { data?: { details?: { lockedUntil?: unknown; newLock?: unknown } } } } | null)?.data?.data?.details
  if ((code === 'pin_locked' || code === 'pin_locked_long') && details?.newLock === false && typeof details.lockedUntil === 'string') {
    return de.terminal.pinLockedUntil(clockTime(details.lockedUntil))
  }
  return errorMessage(error)
}

/**
 * What the employee page says about the PIN locks (null = nothing to say): a running or lasting lock, and how many locks
 * there were since the last right PIN with what the next one does – also after a timed lock has run out.
 * `locked` = the PIN cannot be used right now.
 */
export function pinStateText(
  pin: Pick<EmployeeDetailDto, 'hasPin' | 'pinLockLevel' | 'pinLockedUntil' | 'pinLockedPermanently'>,
): { locked: boolean; text: string } | null {
  if (!pin.hasPin || pin.pinLockLevel === 0) return null
  if (pin.pinLockedPermanently) return { locked: true, text: de.employees.pinLockedPermanently }
  const escalation = de.employees.pinEscalation(pin.pinLockLevel, PIN_LOCK_MINUTES[pin.pinLockLevel] ?? null)
  if (pin.pinLockedUntil) return { locked: true, text: `${de.employees.pinLockedUntil(clockTime(pin.pinLockedUntil))} ${escalation}` }
  return { locked: false, text: escalation }
}
