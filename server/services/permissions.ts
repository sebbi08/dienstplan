import { and, eq } from 'drizzle-orm'
import {
  effectiveRights, type BundleId, type BundleOverride, type BundleScope, type EffectiveRights, type RightsRole,
  type RoleBundleSetting,
} from '../../shared/domain/permissionBundles'
import type { PermissionKey } from '../../shared/domain/permissions'
import type { Role } from '../../shared/types/api'
import type { Db } from '../db/client'
import { roleBundles, userBundleOverrides } from '../db/schema'

/** What the resolver needs to know about an account (a session user or a users row with its resolved facility). */
export interface PermissionSubject {
  id: number
  role: Role
  facilityId: number | null
}

function isRightsRole(role: Role): role is RightsRole {
  return role === 'admin' || role === 'observer'
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

/** Leave planning holds only in the account's own facility (today's `isPlanner`: a Leitung plans only there). */
const OUTSIDE_OWN_FACILITY: BundleOverride = { bundle: 'leavePlan', effect: 'revoke', scope: null }

/**
 * The account's rights for work in `facilityId` (default: the facility it works in), fresh from the database: the
 * role's settings (else the defaults) and the account's exceptions (see `effectiveRights`). Outside its own facility a
 * Leitung or Mitarbeiter does not plan leave. The old flags (`can_edit_children`, `leave_planners`,
 * `contract_visible_to_admins`) are not read: migration 0064 moved them into the rights tables.
 */
export function accountRights(
  db: Db, account: PermissionSubject, facilityId: number | null = account.facilityId,
): EffectiveRights {
  if (!isRightsRole(account.role)) return effectiveRights({ role: account.role })
  const overrides = bundleOverrideRows(db, account.id)
  if (facilityId === null || facilityId !== account.facilityId) overrides.push(OUTSIDE_OWN_FACILITY)
  return effectiveRights({ role: account.role, roleBundles: roleBundleRows(db, account.role), overrides })
}

/** The permission set of `accountRights`. */
export function accountPermissions(
  db: Db, account: PermissionSubject, facilityId: number | null = account.facilityId,
): ReadonlySet<PermissionKey> {
  return accountRights(db, account, facilityId).permissions
}

/**
 * The permissions every account of the role has (its role settings, no exceptions): for the services that only get
 * the viewer's role (contract fields, print template edit flags, group read access).
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
