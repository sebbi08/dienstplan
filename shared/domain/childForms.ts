import { can, type PermissionKey } from './permissions'

export type ChildFormRight = 'none' | 'read' | 'edit'

export interface ChildFormViewer {
  /** What the person acting may do (at the tablet: the unlocking person's permissions). */
  permissions: ReadonlySet<PermissionKey>
  /** True when the request comes from the tablet (an employee unlocked there). */
  onTablet: boolean
  /** The employee unlocked at the tablet, null when nobody is. */
  employeeId: number | null
  /** Whether the viewer may see this child at all (group visibility). */
  canSeeChild: boolean
  /**
   * Whether the child is in the viewer's home group today (the employee's group in this facility). Staff without a home
   * group, helpers from another facility and a child without group: never (unlike the attendance, no „every group“).
   */
  ownGroup: boolean
}

export interface ChildFormChild {
  keyEducatorId: number | null
}

function isKeyEducator(viewer: ChildFormViewer, child: ChildFormChild): boolean {
  return viewer.employeeId !== null && viewer.employeeId === child.keyEducatorId
}

/** With childForms.group the forms of a child of the own group, at the tablet and with the own account. */
function groupEditor(viewer: ChildFormViewer): boolean {
  return viewer.ownGroup && can(viewer.permissions, 'childForms.group')
}

/** Off the tablet only an account with children.ownAccount reaches child data. */
function reachesChild(viewer: ChildFormViewer): boolean {
  return viewer.canSeeChild && (viewer.onTablet || can(viewer.permissions, 'children.ownAccount'))
}

/**
 * Right of a viewer on one child observation form (or, with `form` null, on the child's forms in general).
 * `editors` are the employee ids unlocked for that one form. Whoever has childForms.edit (Träger, Leitung) edits
 * everywhere; with childForms.group (Mitarbeiter by default) the forms of a child of the own group, at the tablet and
 * with the own account; at the tablet also the key educator and the employees unlocked for the form (per-object rules
 * next to the catalog); everyone else who sees the child reads. Accounts without children.ownAccount never reach child
 * data outside the tablet.
 */
export function childFormRight(
  viewer: ChildFormViewer,
  child: ChildFormChild,
  form: { id: number } | null,
  editors: ReadonlySet<number>
): ChildFormRight {
  if (!viewer.canSeeChild) return 'none'
  if (can(viewer.permissions, 'childForms.edit')) return 'edit'
  if (!reachesChild(viewer)) return 'none'
  if (groupEditor(viewer)) return 'edit'
  if (!viewer.onTablet) return 'read'
  if (isKeyEducator(viewer, child)) return 'edit'
  if (form && viewer.employeeId !== null && editors.has(viewer.employeeId)) return 'edit'
  return 'read'
}

/**
 * Whoever has childForms.edit, with childForms.group whoever has the child's group as home group (tablet and own account), or
 * the key educator at the tablet may start a form for the child.
 */
export function canCreateChildForm(viewer: ChildFormViewer, child: ChildFormChild): boolean {
  if (!viewer.canSeeChild) return false
  if (can(viewer.permissions, 'childForms.edit')) return true
  if (!reachesChild(viewer)) return false
  return groupEditor(viewer) || (viewer.onTablet && isKeyEducator(viewer, child))
}

/** Unlocking or revoking editors and deleting a form: childForms.manage (Träger, Leitung). */
export function canManageChildForms(viewer: Pick<ChildFormViewer, 'permissions'>): boolean {
  return can(viewer.permissions, 'childForms.manage')
}
