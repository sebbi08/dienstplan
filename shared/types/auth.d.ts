import type { SessionUser } from './api'

declare module '#auth-utils' {
  interface User extends SessionUser {}
  interface UserSession {
    /** ISO timestamp of the login; normal accounts expire USER_SESSION_DAYS after it. */
    loggedInAt?: string
    /** The tablet's token for its child-record unlock (terminal_unlocks.id); the row is the truth, not this value. */
    childUnlock?: string
  }
}

export {}
