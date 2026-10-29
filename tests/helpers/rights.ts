import { effectivePermissions, type PermissionInput } from '../../shared/domain/permissionBundles'
import { PERMISSION_KEYS, resolvePermissions, ROLE_DEFAULTS, type PermissionKey } from '../../shared/domain/permissions'
import type { Role } from '../../shared/types/api'

/** The per-person flags of Teil 1, before the rights page moved them into bundles. */
export interface LegacyFlags {
  canEditChildren?: boolean
  isLeavePlanner?: boolean
  contractVisibleToAdmins?: boolean
}

/**
 * The rights input that stands for the old flags, as migration 0064 moves them: „darf Kinderakten pflegen“ (Mitarbeiter)
 * → exception childrenEdit (own group), leave planner (Leitung) → exception leavePlan, the contract switch → the
 * Leitung's role setting contractView. A flag of another role counts for nothing, as before.
 */
export function flagsInput(role: Role, flags: LegacyFlags = {}): PermissionInput {
  return {
    role,
    roleBundles: role === 'admin' && flags.contractVisibleToAdmins ? [{ bundle: 'contractView', enabled: true, scope: null }] : [],
    overrides: [
      ...role === 'observer' && flags.canEditChildren ? [{ bundle: 'childrenEdit', effect: 'grant' as const, scope: 'group' as const }] : [],
      ...role === 'admin' && flags.isLeavePlanner ? [{ bundle: 'leavePlan', effect: 'grant' as const, scope: null }] : [],
    ],
  }
}

/** The permissions of a role with the old flags, through the bundles. */
export function flaggedPermissions(role: Role, flags: LegacyFlags = {}): ReadonlySet<PermissionKey> {
  return effectivePermissions(flagsInput(role, flags))
}

/** Teil 1's computation (ROLE_DEFAULTS plus the flags), kept as the reference the bundles must reproduce. */
export function teil1Permissions(role: Role, flags: LegacyFlags = {}): ReadonlySet<PermissionKey> {
  if (role === 'provider') return new Set(PERMISSION_KEYS)
  if (role === 'terminal') return new Set()
  // The Gruppenleitung came with Teil 3: there is no Teil 1 reference to reproduce.
  if (role === 'group_lead') throw new Error('no Teil 1 rights for the Gruppenleitung')
  const granted = [...ROLE_DEFAULTS[role]]
  if (role === 'observer' && flags.canEditChildren) granted.push('children.edit')
  if (role === 'admin' && flags.isLeavePlanner) granted.push('leave.plan')
  if (role === 'admin' && flags.contractVisibleToAdmins) granted.push('employees.contractView')
  return resolvePermissions(granted)
}
