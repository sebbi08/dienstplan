import type { Role } from '../types/api'
import { isManager } from './roles'

export type ChildFormRight = 'none' | 'read' | 'edit'

export interface ChildFormViewer {
  role: Role
  /** True when the request comes from the tablet (an employee unlocked there). */
  onTablet: boolean
  /** The employee unlocked at the tablet, null when nobody is. */
  employeeId: number | null
  /** Whether the viewer may see this child at all (group visibility). */
  canSeeChild: boolean
}

export interface ChildFormChild {
  keyEducatorId: number | null
}

function isKeyEducator(viewer: ChildFormViewer, child: ChildFormChild): boolean {
  return viewer.employeeId !== null && viewer.employeeId === child.keyEducatorId
}

/**
 * Right of a viewer on one child observation form (or, with `form` null, on the child's forms in general).
 * `editors` are the employee ids unlocked for that one form. Managers edit everywhere; at the tablet the
 * key educator and the employees unlocked for the form edit, everyone else who sees the child reads.
 * Non-managers outside the tablet never reach child data.
 */
export function childFormRight(
  viewer: ChildFormViewer,
  child: ChildFormChild,
  form: { id: number } | null,
  editors: ReadonlySet<number>
): ChildFormRight {
  if (!viewer.canSeeChild) return 'none'
  if (isManager(viewer.role)) return 'edit'
  if (!viewer.onTablet) return 'none'
  if (isKeyEducator(viewer, child)) return 'edit'
  if (form && viewer.employeeId !== null && editors.has(viewer.employeeId)) return 'edit'
  return 'read'
}

/** Managers, or the key educator at the tablet, may start a form for the child. */
export function canCreateChildForm(viewer: ChildFormViewer, child: ChildFormChild): boolean {
  if (!viewer.canSeeChild) return false
  if (isManager(viewer.role)) return true
  return viewer.onTablet && isKeyEducator(viewer, child)
}

/** Unlocking or revoking editors and deleting a form: managers only. */
export function canManageChildForms(viewer: Pick<ChildFormViewer, 'role'>): boolean {
  return isManager(viewer.role)
}
