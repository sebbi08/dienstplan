import { groupRight, type GroupRight } from '../../shared/domain/groupAccess'
import { CHILD_ACTOR_KEYS, can, type ChildActorKey, type PermissionKey } from '../../shared/domain/permissions'
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
   * What the person acting may do: the own account's permissions at the office; at the tablet those of the unlocking
   * person's account, the Mitarbeiter defaults for a person without one. Every check on child records asks this set.
   */
  permissions: ReadonlySet<PermissionKey>
  facilityId: number
  /**
   * null = sees every child (children.planned); for everyone else, at the tablet and with the own account, the
   * facility's tablet switches (Vormerkungen, future contracts).
   */
  visibility: ChildVisibility | null
  onTablet: boolean
  /**
   * The groups the viewer sees (see `groupRight`; the scope of children.view): set for home staff of the facility with a
   * group of their own whose „ansehen“ reaches only the own group (scope 'group': the own group and those it may read);
   * null = every group (scope 'facility', the Träger, staff without group, helpers).
   */
  groups: GroupAccess | null
  /**
   * The groups the viewer writes in, per child key (spec Teil 2 §2: every child switch has its own scope): attendance and
   * group book (children.attendance), records (children.edit). null = every group it sees. Left out (viewers built by
   * hand), `groups` decides the writes as well.
   */
  writeGroups?: { attendance: GroupAccess | null; edit: GroupAccess | null }
}

/** The child keys with a group scope. */
export type GroupKey = 'children.view' | 'children.attendance' | 'children.edit'

/**
 * The viewer's right in a group for the key: hidden when the viewer does not see the group (`groups`, the scope of
 * children.view), else for children.attendance and children.edit 'write' where that key's scope reaches the group
 * (`writeGroups`) and 'read' elsewhere. With the defaults (all scopes the same) this is `groupRight(groupId, groups)`.
 */
export function groupRightOf(
  viewer: Pick<ChildViewer, 'groups' | 'writeGroups'>, groupId: number | null, key: GroupKey,
): GroupRight {
  const seen = groupRight(groupId, viewer.groups)
  if (key === 'children.view' || seen === 'none' || !viewer.writeGroups) return seen
  const access = key === 'children.edit' ? viewer.writeGroups.edit : viewer.writeGroups.attendance
  return groupRight(groupId, access) === 'write' ? 'write' : 'read'
}

/** A viewer who may change records: it has an account to record as "changed by". */
export type ChildActor = ChildViewer & { id: number }

export { CHILD_ACTOR_KEYS, type ChildActorKey }
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
