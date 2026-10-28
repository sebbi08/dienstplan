// Imported relative (no Nuxt aliases) so a test can load this file.
import type { PermissionKey } from '../../shared/domain/permissions'

/** The child pages (list, record, new child …); the tablet shows them only while a person has unlocked it. */
export const isChildPagePath = (path: string): boolean => path === '/children' || path.startsWith('/children/')

/**
 * The pages the shared tablet opens without an unlock: stamping, the general plan, the print templates and the team
 * meetings (no child data). Never /print: the team meetings' printout is for the staff's and the managers' own devices.
 * The tablet role is not part of the permission catalog, so this stays a rule of its own.
 */
export function tabletMayOpen(path: string): boolean {
  const teamMeetings = path === '/team-meetings' || path.startsWith('/team-meetings/')
  return path === '/terminal' || path === '/templates' || path.startsWith('/plan/') || teamMeetings
}

/** A prefix starting with "=" matches only that address, any other one the address and the pages below it. */
const within = (path: string, prefix: string) => (prefix.startsWith('=') ? path === prefix.slice(1) : path === prefix || path.startsWith(`${prefix}/`))

/**
 * The key a page needs, by address (first match wins), matching what the page loads from the server. Pages not listed
 * are open to every signed-in account (tests/domain/routeAccess.test.ts lists every page, so a new one needs a decision);
 * an unknown address then shows the page-not-found answer.
 */
const PAGE_PERMISSIONS: readonly [prefix: string, key: PermissionKey][] = [
  // Mitarbeiter see the children only at the facility's tablet, the printouts of them nowhere (the tablet never gets
  // to /print).
  ['/children', 'children.ownAccount'],
  ['/print/children', 'children.ownAccount'],
  ['/admin/time', 'time.manage'],
  ['/admin/print/time', 'time.manage'],
  ['/admin/employees', 'employees.view'],
  ['/admin/print/emergency-contacts', 'employees.view'],
  ['/admin/sick-days', 'employees.sickness'],
  ['/admin/print/sick-days', 'employees.sickness'],
  ['/admin/leave-planning', 'leave.overview'],
  ['/admin/calendar', 'calendar.edit'],
  ['/admin/print/calendar', 'calendar.edit'],
  ['/admin/closures', 'closures.manage'],
  ['/admin/print/early-closures', 'closures.manage'],
  ['/admin/forms', 'formTemplates.manage'],
  ['/admin/print/form-templates', 'formTemplates.manage'],
  ['/admin/print/forms', 'talks.manage'],
  ['/admin/print/cash', 'cash.view'],
  ['/cash', 'cash.view'],
  ['/admin/users', 'users.manage'],
  // Rechte und Rollen: the Träger sets the rights of the roles.
  ['/admin/rights', 'rights.manage'],
  ['/admin/settings', 'settings.facility'],
  ['/admin/retention', 'retention.delete'],
  // The print templates: managers, the tablet and (read only, the categories visible to all) Mitarbeiter accounts.
  ['=/templates', 'printTemplates.view'],
]

/** The tablet's pages that no signed-in account opens: the terminal routes answer only the tablet. */
const TABLET_ONLY = ['/terminal']

/** The key the page at `path` needs from a signed-in account (not the tablet); null when every account opens it. */
export function pagePermission(path: string): PermissionKey | null {
  const listed = PAGE_PERMISSIONS.find(([prefix]) => within(path, prefix))
  return listed ? listed[1] : null
}

/** A page only the tablet opens (its start page); every account goes to the start page instead. */
export function tabletOnlyPage(path: string): boolean {
  return TABLET_ONLY.includes(path)
}

export interface AccountViewer {
  mustChangePassword: boolean
  can: (key: PermissionKey) => boolean
}

/** Where a signed-in account (not the tablet) goes instead of `path`; undefined when it may open the page. */
export function accountRedirect(path: string, viewer: AccountViewer): string | undefined {
  if (viewer.mustChangePassword && path !== '/account/password') return '/account/password'
  if (tabletOnlyPage(path)) return '/'
  const key = pagePermission(path)
  return key === null || viewer.can(key) ? undefined : '/'
}
