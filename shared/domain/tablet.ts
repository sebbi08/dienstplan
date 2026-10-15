/** Minutes without use after which a facility's tablet locks the child records again (the default and the allowed range). */
export const DEFAULT_TABLET_LOCK_MINUTES = 2
export const MIN_TABLET_LOCK_MINUTES = 1
export const MAX_TABLET_LOCK_MINUTES = 30

/** The server accepts an unlock this long after the lock time ran out, so a keep-alive on its way is not refused. */
export const UNLOCK_GRACE_SECONDS = 30

/** After an interaction the tablet sends a keep-alive at most this often. */
export const KEEP_ALIVE_MIN_SECONDS = 15
