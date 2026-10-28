import { eq } from 'drizzle-orm'
import { effectivePermissions, type PermissionKey } from '../../shared/domain/permissions'
import type { Role } from '../../shared/types/api'
import type { Db } from '../db/client'
import { leavePlanners } from '../db/schema'
import { contractVisibleToAdmins } from './appSettings'

/** What the resolver needs to know about an account (a session user or a users row with its resolved facility). */
export interface PermissionSubject {
  id: number
  role: Role
  canEditChildren: boolean
  facilityId: number | null
}

function inLeavePlanners(db: Db, userId: number): boolean {
  return db.select({ userId: leavePlanners.userId }).from(leavePlanners).where(eq(leavePlanners.userId, userId)).get() !== undefined
}

/**
 * The account's permissions for work in `facilityId` (default: the facility it works in), from its role and today's
 * per-person flags, fresh from the database: `can_edit_children`, the global switch `contract_visible_to_admins`, and
 * `leave_planners`, which counts for a Leitung only in its own facility (today's `isPlanner`).
 */
export function accountPermissions(
  db: Db, account: PermissionSubject, facilityId: number | null = account.facilityId,
): ReadonlySet<PermissionKey> {
  return effectivePermissions({
    role: account.role,
    canEditChildren: account.canEditChildren,
    isLeavePlanner: account.role === 'admin' && facilityId !== null && account.facilityId === facilityId
      && inLeavePlanners(db, account.id),
    contractVisibleToAdmins: account.role === 'admin' && contractVisibleToAdmins(db),
  })
}

/**
 * The permissions every account of the role has (no per-person flags), with the global contract switch: for the
 * services that only get the viewer's role (contract fields, print template edit flags, group read access). In Teil 1
 * the role and the switch decide these answers completely.
 */
export function rolePermissions(db: Db, role: Role): ReadonlySet<PermissionKey> {
  return effectivePermissions({
    role, canEditChildren: false, isLeavePlanner: false, contractVisibleToAdmins: role === 'admin' && contractVisibleToAdmins(db),
  })
}
