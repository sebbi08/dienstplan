/** The stamp PIN for the shared tablet (stamping and unlocking the child records): exactly this many digits. */
export const PIN_LENGTH = 6
/** Wrong tries in a row that lock the PIN. */
export const MAX_PIN_ATTEMPTS = 5
/** Lock time per lock level: the 1st lock 15 minutes, the 2nd 30; the next one lasts until a manager unlocks the PIN. */
export const PIN_LOCK_MINUTES = [15, 30] as const
/** The lock level from which the PIN stays locked until the Leitung or the Träger unlocks it. */
export const PIN_PERMANENT_LOCK_LEVEL = PIN_LOCK_MINUTES.length + 1

const LOCK_CODES = ['pin_locked', 'pin_locked_long'] as const

/** Whether the text is a well-formed PIN (exactly PIN_LENGTH digits). */
export function isValidPin(pin: string): boolean {
  return pin.length === PIN_LENGTH && /^\d+$/.test(pin)
}

/** The error code of a lock by its level: pin_locked (15 minutes), pin_locked_long (30), pin_locked_permanent. */
export function pinLockCode(level: number): 'pin_locked' | 'pin_locked_long' | 'pin_locked_permanent' {
  return level >= PIN_PERMANENT_LOCK_LEVEL ? 'pin_locked_permanent' : LOCK_CODES[Math.max(level, 1) - 1]!
}

/** The PIN's lock at the moment: the end of a running timed lock, or whether it lasts until a manager unlocks it. */
export function pinLockState(
  lock: { pinLockedUntil: string | null; pinLockLevel: number }, now: Date,
): { pinLockedUntil: string | null; pinLockedPermanently: boolean } {
  const permanent = lock.pinLockLevel >= PIN_PERMANENT_LOCK_LEVEL
  const running = !permanent && lock.pinLockedUntil !== null && lock.pinLockedUntil > now.toISOString()
  return { pinLockedUntil: running ? lock.pinLockedUntil : null, pinLockedPermanently: permanent }
}
