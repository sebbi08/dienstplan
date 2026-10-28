import type { Role } from '../types/api'
import type { PermissionKey } from './permissions'

/** Roles that run the facility: the provider (Träger) and the management (Leitung, key 'admin'). */
export const MANAGER_ROLES: readonly Role[] = ['provider', 'admin']

/** Träger or Leitung: may plan, release, manage employees and settings. */
export function isManager(role: Role | null | undefined): boolean {
  return role !== null && role !== undefined && MANAGER_ROLES.includes(role)
}

/**
 * The roles whose accounts the actor creates, changes, deactivates and resets (users.manage): the Träger
 * (users.providerAccounts) every role; a Leitung, as before, Leitung, Mitarbeiter and tablet accounts; anyone else who
 * was given „Zugänge verwalten“ only the tablet accounts: a Mitarbeiter account could otherwise be reset and signed in
 * with, and so carry rights its manager does not hold. The server checks this; the users page offers only these.
 */
export function manageableRoles(role: Role | undefined, has: (key: PermissionKey) => boolean): readonly Role[] {
  if (has('users.providerAccounts')) return ['provider', 'admin', 'observer', 'terminal']
  return role === 'admin' ? ['admin', 'observer', 'terminal'] : ['terminal']
}

/**
 * Why the actor cannot change an account (role, link, active, Save; the server answers 403 for each), null when it can:
 * 'own' for the own account of anyone but the Träger (own_account), 'provider' for a Träger account of a non-Träger
 * (provider_only), 'role' for any other role outside `manageableRoles` (role_not_manageable).
 */
export function accountLock(
  actor: { id: number | undefined; role: Role | undefined }, has: (key: PermissionKey) => boolean,
  account: { id: number; role: Role },
): 'own' | 'provider' | 'role' | null {
  if (account.id === actor.id && !has('users.providerAccounts')) return 'own'
  if (account.role === 'provider' && !has('users.providerAccounts')) return 'provider'
  return manageableRoles(actor.role, has).includes(account.role) ? null : 'role'
}
