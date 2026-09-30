import type { SessionUser } from './api'

declare module '#auth-utils' {
  interface User extends SessionUser {}
}

export {}
