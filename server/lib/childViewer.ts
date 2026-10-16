import { isManager, mayEditChildren } from '../../shared/domain/roles'
import type { ChildVisibility, GroupAccess, Role } from '../../shared/types/api'
import { ServiceError } from './errors'

/**
 * Who looks at child records, with the rights the access is judged by: a logged-in account, or at the facility's tablet
 * the person who unlocked it (with the rights of their own account, read-only without one).
 */
export interface ChildViewer {
  /** Account for "changed by"; null for a person without (active) account at the tablet, who can only read. */
  id: number | null
  /** The person for "changed by" in the attendance log: at the tablet the one who unlocked, else the account's employee. */
  employeeId: number | null
  /** Their name for the log: the unlocking employee at the tablet; the linked employee's name, else the username. */
  name: string
  role: Role
  canEditChildren: boolean
  facilityId: number
  /** null = sees every child (managers); set at the tablet for everyone else. */
  visibility: ChildVisibility | null
  onTablet: boolean
  /**
   * The groups the viewer works with (see `groupRight`): set at the tablet for home staff of the facility with a group
   * of their own and without manager rights; null = every group (Leitung, Träger, staff without group, helpers, office).
   */
  groups: GroupAccess | null
}

/** A viewer who may change records: it has an account to record as "changed by". */
export type ChildActor = ChildViewer & { id: number }

/** A viewer who may change records always has an account (the tablet's readers without one may not). */
function asActor(viewer: ChildViewer): ChildActor {
  if (viewer.id === null) throw new ServiceError(403, 'forbidden')
  return viewer as ChildActor
}

/** The viewer as one who maintains child records (managers, Mitarbeiter with the permission at the tablet); 403 forbidden otherwise. */
export function asChildEditor(viewer: ChildViewer): ChildActor {
  if (!mayEditChildren(viewer)) throw new ServiceError(403, 'forbidden')
  return asActor(viewer)
}

/** The viewer as Träger or Leitung on the child pages (archive, occupancy, group changes …); 403 forbidden otherwise. */
export function asChildManager(viewer: ChildViewer): ChildActor {
  if (!isManager(viewer.role)) throw new ServiceError(403, 'forbidden')
  return asActor(viewer)
}
