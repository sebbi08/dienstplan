import type { ChildVisibility, Role } from '../../shared/types/api'

/**
 * Who looks at child records, with the rights the access is judged by: a logged-in account, or at the facility's tablet
 * the person who unlocked it (with the rights of their own account, read-only without one).
 */
export interface ChildViewer {
  /** Account for "changed by"; null for a person without (active) account at the tablet, who can only read. */
  id: number | null
  role: Role
  canEditChildren: boolean
  facilityId: number
  /** null = sees every child (managers); set at the tablet for everyone else. */
  visibility: ChildVisibility | null
  onTablet: boolean
}

/** A viewer who may change records: it has an account to record as "changed by". */
export type ChildActor = ChildViewer & { id: number }
