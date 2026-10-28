import type { PermissionKey } from '../domain/permissions'
import type { SessionPayloadUser } from './api'

declare module '#auth-utils' {
  interface User extends SessionPayloadUser {}
  interface UserSession {
    /** ISO timestamp of the login; normal accounts expire USER_SESSION_DAYS after it. */
    loggedInAt?: string
    /**
     * The account's effective permissions, for what the pages show (useCan): added fresh by server/plugins/sessionCheck.ts
     * to every answer of GET /api/_auth/session, never stored in the session cookie (no route puts it there). The
     * tablet has none (its pages follow the terminal role and, for child records, the unlocking person's rights).
     */
    permissions?: PermissionKey[]
  }
  /** Server-only part of the session: never sent to the browser (not in /api/_auth/session, not in the page payload). */
  interface SecureSessionData {
    /** The tablet's token for its child-record unlock (terminal_unlocks.id); the row is the truth, not this value. */
    childUnlock?: string
  }
}

export {}
