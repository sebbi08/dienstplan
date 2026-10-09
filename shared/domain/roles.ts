import type { Role, SessionUser } from '../types/api'

/** Roles that run the facility: the provider (Träger) and the management (Leitung, key 'admin'). */
export const MANAGER_ROLES: readonly Role[] = ['provider', 'admin']

/** Träger or Leitung: may plan, release, manage employees and settings. */
export function isManager(role: Role | null | undefined): boolean {
  return role !== null && role !== undefined && MANAGER_ROLES.includes(role)
}

/** Träger and Leitung always maintain child records, a Mitarbeiter only with the flag, the tablet never. */
export function mayEditChildren(user: Pick<SessionUser, 'role' | 'canEditChildren'>): boolean {
  return isManager(user.role) || (user.role === 'observer' && user.canEditChildren)
}
