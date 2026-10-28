import { can, type PermissionKey } from '../../shared/domain/permissions'
import type { ChildVisibility, GroupAccess, Role } from '../../shared/types/api'
import { ServiceError } from './errors'

/**
 * Who looks at child records, with the rights the access is judged by: a logged-in account, or at the facility's tablet
 * the person who unlocked it (with the permissions of their own account, the Mitarbeiter defaults without one).
 */
export interface ChildViewer {
  /** Account for "changed by"; null for a person without (active) account at the tablet, who cannot change records. */
  id: number | null
  /** The person for "changed by" in the attendance log: at the tablet the one who unlocked, else the account's employee. */
  employeeId: number | null
  /** Their name for the log: the unlocking employee at the tablet; the linked employee's name, else the username. */
  name: string
  /** The role of the person's account ('observer' without one): who they are, not what they may (see `permissions`). */
  role: Role
  /**
   * The account's old column „darf Kinderakten pflegen“ as stored; the right itself is the exception
   * „eintragen und Akten ändern“, which `permissions` holds.
   */
  canEditChildren: boolean
  /**
   * What the person acting may do: the own account's permissions at the office; at the tablet those of the unlocking
   * person's account, the Mitarbeiter defaults for a person without one. Every check on child records asks this set.
   */
  permissions: ReadonlySet<PermissionKey>
  facilityId: number
  /** null = sees every child (children.planned); set at the tablet for everyone else. */
  visibility: ChildVisibility | null
  onTablet: boolean
  /**
   * The groups the viewer works with (see `groupRight`): set at the tablet for home staff of the facility with a group
   * of their own and without children.manage; null = every group (Leitung, Träger, staff without group, helpers, office).
   */
  groups: GroupAccess | null
}

/** A viewer who may change records: it has an account to record as "changed by". */
export type ChildActor = ChildViewer & { id: number }

/** The child permissions that change records and so need an account ("changed by"): their guard gives a ChildActor. */
export type ChildActorKey = 'children.edit' | 'children.manage'
export const CHILD_ACTOR_KEYS: readonly ChildActorKey[] = ['children.edit', 'children.manage']
const ACTOR_KEYS: ReadonlySet<PermissionKey> = new Set(CHILD_ACTOR_KEYS)

/** A viewer who may change records always has an account (the tablet's readers without one may not). */
function asActor(viewer: ChildViewer): ChildActor {
  if (viewer.id === null) throw new ServiceError(403, 'forbidden')
  return viewer as ChildActor
}

/**
 * The viewer with the permission `key` (403 forbidden otherwise); for children.edit and children.manage also with an
 * account (403 forbidden for a person without one at the tablet).
 */
export function asChildPermission(viewer: ChildViewer, key: ChildActorKey): ChildActor
export function asChildPermission(viewer: ChildViewer, key: PermissionKey): ChildViewer
export function asChildPermission(viewer: ChildViewer, key: PermissionKey): ChildViewer {
  if (!can(viewer.permissions, key)) throw new ServiceError(403, 'forbidden')
  return ACTOR_KEYS.has(key) ? asActor(viewer) : viewer
}

/** The viewer as one who maintains child records (children.edit, with an account); 403 forbidden otherwise. */
export function asChildEditor(viewer: ChildViewer): ChildActor {
  return asChildPermission(viewer, 'children.edit')
}

/** The viewer on the Leitung's child pages (children.manage: archive, occupancy, group changes …); 403 forbidden otherwise. */
export function asChildManager(viewer: ChildViewer): ChildActor {
  return asChildPermission(viewer, 'children.manage')
}
