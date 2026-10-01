import type { SessionUser } from './api'

declare module '#auth-utils' {
  interface User extends SessionUser {}
  interface UserSession {
    /** ISO timestamp of the login; normal accounts expire USER_SESSION_DAYS after it. */
    loggedInAt?: string
  }
}

export {}
