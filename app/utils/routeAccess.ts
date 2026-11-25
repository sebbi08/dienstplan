// Imported relative (no Nuxt aliases) so a test can load this file.
import type { PermissionKey } from '../../shared/domain/permissions'

/** The child pages (list, record, new child …); the tablet shows them only while a person has unlocked it. */
// The info visits (/children/info-visits/…) are no child records: never at the tablet (their routes are for accounts).
export const isChildPagePath = (path: string): boolean =>
  (path === '/children' || path.startsWith('/children/')) && !path.startsWith('/children/info-visits')

/**
 * The pages the shared tablet opens without an unlock: stamping, the general plan and its printout
 * (/print/<year>/<month>), the print templates and „Wissen“ („Dokumente“, only its tabs „Vorlagen“ and „Wissen“ there;
 * /templates is the old address), the team meetings, the notes and the contacts marked for the staff (no child data). No other /print page:
 * the team meetings' and the contacts' printouts are for the staff's and the managers' own devices. The tablet role is
 * not part of the permission catalog, so this stays a rule of its own.
 */
export function tabletMayOpen(path: string): boolean {
  const teamMeetings = path === '/team-meetings' || path.startsWith('/team-meetings/')
  const planPrintout = /^\/print\/\d+\/\d+$/.test(path)
  return path === '/terminal' || path === '/documents' || path === '/templates' || path === '/notes' || path === '/contacts'
    || path.startsWith('/plan/') || planPrintout || teamMeetings
}

/** A prefix starting with "=" matches only that address, any other one the address and the pages below it. */
const within = (path: string, prefix: string) => (prefix.startsWith('=') ? path === prefix.slice(1) : path === prefix || path.startsWith(`${prefix}/`))

/**
 * The key a page needs, by address (first match wins), matching what the page loads from the server; a list when any of
 * its keys opens the page (each key a part of it). Pages not listed are open to every signed-in account
 * (tests/domain/routeAccess.test.ts lists every page, so a new one needs a decision); an unknown address then shows the
 * page-not-found answer.
 */
const PAGE_PERMISSIONS: readonly [prefix: string, key: PermissionKey | readonly PermissionKey[]][] = [
  // Mitarbeiter see the children only at the facility's tablet, the printouts of them nowhere (the tablet never gets
  // to /print).
  // „Infogespräche“ (Kinder → Planung): an info visit's page, for whoever keeps them.
  ['/children/info-visits', 'visits.manage'],
  ['/children', 'children.ownAccount'],
  ['/print/children', 'children.ownAccount'],
  ['/admin/time', 'time.manage'],
  ['/admin/print/time', 'time.manage'],
  // „Bewerbungen & Hospitationen“ (visits.applicants.view, which visits.manage includes): the list on its own and an
  // applicant's page; with the staff list they are the tab of Mitarbeiter.
  ['/admin/employees/applicants', 'visits.applicants.view'],
  // Krankheitstage: a tab of Mitarbeiter (/admin/sick-days, the old address, sends there).
  ['/admin/employees/sick-days', 'employees.sickness'],
  ['/admin/employees', 'employees.view'],
  ['/admin/print/emergency-contacts', 'employees.view'],
  // Old addresses of former menu entries, now tabs (the pages send on to them), with the keys of their new pages.
  ['/admin/sick-days', 'employees.sickness'],
  ['/admin/print/sick-days', 'employees.sickness'],
  ['/admin/print/bem-invitation', 'employees.sickness'],
  ['/admin/leave-planning', 'leave.overview'],
  ['/admin/print/leave-forfeit', 'leave.overview'],
  ['/admin/print/leave-list', 'leave.overview'],
  // Schließzeiten: a tab of Kalender (/admin/closures, the old address, sends there).
  ['/admin/calendar/closures', 'closures.manage'],
  ['/admin/calendar', 'calendar.edit'],
  ['/admin/print/calendar', 'calendar.edit'],
  ['/admin/closures', 'closures.manage'],
  ['/admin/print/early-closures', 'closures.manage'],
  // The old address of „Bögen“, now a tab of „Dokumente“ (the page sends on to it).
  ['/admin/forms', 'formTemplates.manage'],
  ['/admin/print/form-templates', 'formTemplates.manage'],
  ['/admin/print/forms', 'talks.manage'],
  ['/admin/accidents', 'accidents.manage'],
  ['/admin/print/accidents', 'accidents.manage'],
  ['/admin/print/cash', 'cash.view'],
  ['/cash', 'cash.view'],
  // „Benutzer & Rechte“: Rechte und Rollen (the Träger sets the rights of the roles) is its tab /admin/users/rights;
  // /admin/rights, the old address, sends there.
  ['/admin/users/rights', 'rights.manage'],
  ['/admin/users', 'users.manage'],
  ['/admin/rights', 'rights.manage'],
  ['/admin/settings', 'settings.facility'],
  ['/admin/retention', 'retention.delete'],
  // „Dokumente“: the tab „Bögen“ (formTemplates.manage) or the tab „Vorlagen“ (printTemplates.view: managers and, read
  // only, the categories visible to all, Mitarbeiter accounts; the tablet by tabletMayOpen). The page shows the tabs the
  // account may use.
  // The tab „Wissen“ (knowledge.view, every account) as well; its proof of reading („Nachweis“) only for knowledge.manage.
  // The tab „Unterschriften“ (signRequests.manage): the requests to sign sent from the facility.
  ['=/documents', ['printTemplates.view', 'formTemplates.manage', 'knowledge.view', 'signRequests.manage']],
  ['/print/knowledge', 'knowledge.manage'],
  // The old address of the print templates (the page sends on to „Dokumente“ → „Vorlagen“).
  ['=/templates', 'printTemplates.view'],
  // The facility's notes: every account has the key (the tablet reads them by tabletMayOpen).
  ['=/notes', 'notes.view'],
  // „Kontakte“ and its printout: every account has the key (the page shows what the server gives: contacts.manage all,
  // everyone else the contacts marked for the staff); the tablet opens the page by tabletMayOpen, not the printout.
  ['=/contacts', 'contacts.view'],
  ['/print/contacts', 'contacts.view'],
]

/** The tablet's pages that no signed-in account opens: the terminal routes answer only the tablet. */
const TABLET_ONLY = ['/terminal']

/** The keys of which the page at `path` needs one from a signed-in account (not the tablet); empty when every account opens it. */
export function pageKeys(path: string): readonly PermissionKey[] {
  const listed = PAGE_PERMISSIONS.find(([prefix]) => within(path, prefix))
  if (!listed) return []
  return typeof listed[1] === 'string' ? [listed[1]] : listed[1]
}

/**
 * The key the page at `path` needs from a signed-in account (not the tablet); null when every account opens it. For a
 * page any of several keys opens („Dokumente“) the first; pageKeys names them all.
 */
export function pagePermission(path: string): PermissionKey | null {
  return pageKeys(path)[0] ?? null
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
  const keys = pageKeys(path)
  return keys.length === 0 || keys.some(key => viewer.can(key)) ? undefined : '/'
}
