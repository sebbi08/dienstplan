import { and, eq, inArray } from 'drizzle-orm'
import { COUNTS_ONLY_OVERRIDES, countsOnlyApplies } from '../../shared/domain/countsOnly'
import {
  effectiveRights, isRightsRole, type BundleId, type BundleOverride, type BundleScope, type EffectiveRights,
  type RightsRole, type RoleBundleSetting,
} from '../../shared/domain/permissionBundles'
import type { PermissionKey } from '../../shared/domain/permissions'
import type { Role } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, roleBundles, userBundleOverrides, users } from '../db/schema'

/** What the resolver needs to know about an account (a session user or a users row with its resolved facility). */
export interface PermissionSubject {
  id: number
  role: Role
  facilityId: number | null
}

/** The Träger's stored settings for the role (role_bundles); empty for the Träger and the tablet. */
export function roleBundleRows(db: Db, role: Role): RoleBundleSetting[] {
  if (!isRightsRole(role)) return []
  return db.select({ bundle: roleBundles.bundle, enabled: roleBundles.enabled, scope: roleBundles.scope })
    .from(roleBundles).where(eq(roleBundles.role, role)).all()
}

/** The account's stored exceptions (user_bundle_overrides). */
export function bundleOverrideRows(db: Db, userId: number): BundleOverride[] {
  return db.select({ bundle: userBundleOverrides.bundle, effect: userBundleOverrides.effect, scope: userBundleOverrides.scope })
    .from(userBundleOverrides).where(eq(userBundleOverrides.userId, userId)).all()
}

/**
 * The accounts (of those given) whose employee has „Nur Kinderzahlen“ (shared/domain/countsOnly.ts); whether it counts
 * for the account's role decides `countsOnlyApplies`. Accounts without an employee (the Träger's, the tablet's) need
 * no look at the employees.
 */
function countsOnlyAccounts(db: Db, userIds: readonly number[]): Set<number> {
  if (userIds.length === 0) return new Set()
  const linked = db.select({ id: users.id, employeeId: users.employeeId }).from(users)
    .where(inArray(users.id, [...userIds])).all()
    .flatMap(row => (row.employeeId === null ? [] : [{ id: row.id, employeeId: row.employeeId }]))
  if (linked.length === 0) return new Set()
  const flagged = new Set(db.select({ id: employees.id }).from(employees)
    .where(and(inArray(employees.id, linked.map(row => row.employeeId)), eq(employees.countsOnly, true))).all().map(row => row.id))
  return new Set(linked.filter(row => flagged.has(row.employeeId)).map(row => row.id))
}

/** Leave planning holds only in the account's own facility (today's `isPlanner`: a Leitung plans only there). */
const OUTSIDE_OWN_FACILITY: BundleOverride = { bundle: 'leavePlan', effect: 'revoke', scope: null }

/**
 * The account's rights for work in `facilityId` (default: the facility it works in), fresh from the database: the
 * role's settings (else the defaults) and the account's exceptions (see `effectiveRights`). Outside its own facility a
 * Leitung or Mitarbeiter does not plan leave. A Gruppenleitung or Mitarbeiter whose employee has „Nur Kinderzahlen“
 * has no child rights at all, whatever the role and the exceptions say (`COUNTS_ONLY_OVERRIDES`, applied last). The
 * old flags (`can_edit_children`, `leave_planners`, `contract_visible_to_admins`) are not read: migration 0064 moved
 * them into the rights tables.
 */
export function accountRights(
  db: Db, account: PermissionSubject, facilityId: number | null = account.facilityId,
): EffectiveRights {
  if (!isRightsRole(account.role)) return effectiveRights({ role: account.role })
  const overrides = bundleOverrideRows(db, account.id)
  if (facilityId === null || facilityId !== account.facilityId) overrides.push(OUTSIDE_OWN_FACILITY)
  if (countsOnlyApplies(countsOnlyAccounts(db, [account.id]).has(account.id), account.role)) overrides.push(...COUNTS_ONLY_OVERRIDES)
  return effectiveRights({ role: account.role, roleBundles: roleBundleRows(db, account.role), overrides })
}

/**
 * `accountRights` of several accounts at once, each in its own facility: the role settings read once per role and the
 * exceptions of all of them in one query (for lists: the users page, who plans leave in a facility).
 */
export function accountsRights(db: Db, accounts: readonly PermissionSubject[]): Map<number, EffectiveRights> {
  const ids = accounts.filter(account => isRightsRole(account.role)).map(account => account.id)
  const overrides = new Map<number, BundleOverride[]>()
  if (ids.length > 0) {
    for (const row of db.select().from(userBundleOverrides).where(inArray(userBundleOverrides.userId, ids)).all()) {
      overrides.set(row.userId, [...overrides.get(row.userId) ?? [], { bundle: row.bundle, effect: row.effect, scope: row.scope }])
    }
  }
  const countsOnly = countsOnlyAccounts(db, ids)
  const roleRows = new Map<RightsRole, RoleBundleSetting[]>()
  const result = new Map<number, EffectiveRights>()
  for (const account of accounts) {
    if (!isRightsRole(account.role)) {
      result.set(account.id, effectiveRights({ role: account.role }))
      continue
    }
    if (!roleRows.has(account.role)) roleRows.set(account.role, roleBundleRows(db, account.role))
    const own = [...overrides.get(account.id) ?? []]
    if (account.facilityId === null) own.push(OUTSIDE_OWN_FACILITY)
    if (countsOnlyApplies(countsOnly.has(account.id), account.role)) own.push(...COUNTS_ONLY_OVERRIDES)
    result.set(account.id, effectiveRights({ role: account.role, roleBundles: roleRows.get(account.role), overrides: own }))
  }
  return result
}

/** The permission set of `accountRights`. */
export function accountPermissions(
  db: Db, account: PermissionSubject, facilityId: number | null = account.facilityId,
): ReadonlySet<PermissionKey> {
  return accountRights(db, account, facilityId).permissions
}

/**
 * The permissions every account of the role has (its role settings, no exceptions): what the role as such may (the
 * Leitung's contract switch on the employees page). Checks on a request use the acting person's own permissions.
 */
export function rolePermissions(db: Db, role: Role): ReadonlySet<PermissionKey> {
  return effectiveRights({ role, roleBundles: roleBundleRows(db, role) }).permissions
}

/** Stores the role's setting for the bundle (replacing an earlier one). No checks: the rights service validates. */
export function saveRoleBundle(db: Db, role: RightsRole, bundle: BundleId, enabled: boolean, scope: BundleScope | null = null): void {
  db.insert(roleBundles).values({ role, bundle, enabled, scope })
    .onConflictDoUpdate({ target: [roleBundles.role, roleBundles.bundle], set: { enabled, scope } }).run()
}

/**
 * Stores the account's exception for the bundle (replacing an earlier one), or removes it with `effect` null. No
 * checks: the rights service validates.
 */
export function saveBundleOverride(
  db: Db, userId: number, bundle: BundleId, effect: 'grant' | 'revoke' | null, scope: BundleScope | null = null,
): void {
  const where = and(eq(userBundleOverrides.userId, userId), eq(userBundleOverrides.bundle, bundle))
  if (effect === null) {
    db.delete(userBundleOverrides).where(where).run()
    return
  }
  db.insert(userBundleOverrides).values({ userId, bundle, effect, scope })
    .onConflictDoUpdate({ target: [userBundleOverrides.userId, userBundleOverrides.bundle], set: { effect, scope } }).run()
}
