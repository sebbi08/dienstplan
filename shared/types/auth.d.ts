import type { SessionPayloadUser } from './api'

declare module '#auth-utils' {
  interface User extends SessionPayloadUser {}
  interface UserSession {
    /** ISO timestamp of the login; normal accounts expire USER_SESSION_DAYS after it. */
    loggedInAt?: string
  }
  /** Server-only part of the session: never sent to the browser (not in /api/_auth/session, not in the page payload). */
  interface SecureSessionData {
    /** The tablet's token for its child-record unlock (terminal_unlocks.id); the row is the truth, not this value. */
    childUnlock?: string
  }
}

export {}
