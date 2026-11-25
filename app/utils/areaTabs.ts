import type { LocationQuery, RouteLocationRaw } from 'vue-router'
import type { PermissionKey } from '#shared/domain/permissions'
import { de } from '~/locales/de'

/**
 * Former menu entries that live as a tab of another page now (smaller „Mehr“): Kalender | Schließzeiten, Mitarbeiter |
 * Krankheitstage, Benutzer | Rechte und Rollen. Each tab is a page of its own (its address under the main page), or a
 * `?tab=` of the page; the old addresses send there (`movedLocation`).
 */
export interface AreaTab {
  label: string
  to: string
  /** A tab of the same page chosen by `?tab=` (e.g. „Bewerbungen & Hospitationen“ on Mitarbeiter). */
  tab?: string
}

type Can = (key: PermissionKey) => boolean
const only = (tabs: readonly [boolean, AreaTab][]): AreaTab[] => tabs.filter(([show]) => show).map(([, tab]) => tab)

/** „Kalender“: the year calendar (calendar.edit) and the closures (closures.manage, which comes with it). */
export const calendarTabs = (can: Can): AreaTab[] => only([
  [can('calendar.edit'), { label: de.nav.calendarShort, to: '/admin/calendar' }],
  [can('closures.manage'), { label: de.nav.closures, to: '/admin/calendar/closures' }],
])

/**
 * „Mitarbeitende“: the staff list (employees.view), „Bewerbungen & Hospitationen“ on the same page (?tab=applicants,
 * visits.applicants.view), the sick days (employees.sickness), „Unterschriften“ (the requests to sign,
 * signRequests.manage, with the overdue ones counted) and the employees' accidents of a year (accidents.manage).
 */
export const staffAreaTabs = (can: Can, counts: { signOverdue?: number } = {}): AreaTab[] => only([
  [can('employees.view'), { label: de.nav.employees, to: '/admin/employees' }],
  [can('employees.view') && can('visits.applicants.view'), { label: de.visits.tabs.applicants, to: '/admin/employees', tab: 'applicants' }],
  [can('employees.sickness'), { label: de.nav.sickDays, to: '/admin/employees/sick-days' }],
  [can('signRequests.manage'), { label: de.signRequests.tabLabel(counts.signOverdue ?? 0), to: SIGNATURES_PATH }],
  [can('accidents.manage'), { label: de.nav.accidents, to: ACCIDENTS_TABS.employee.path }],
])

/** „Benutzer & Rechte“: the accounts (users.manage) and the rights of the roles (rights.manage, the Träger's). */
export const userTabs = (can: Can): AreaTab[] => only([
  [can('users.manage'), { label: de.nav.users, to: '/admin/users' }],
  [can('rights.manage'), { label: de.nav.rights, to: '/admin/users/rights' }],
])

/** Whether the tab is the one shown: its page and its `?tab=` (none for the page's main tab). */
export const isAreaTabActive = (tab: AreaTab, route: { path: string; query: LocationQuery }): boolean =>
  route.path === tab.to && (typeof route.query.tab === 'string' ? route.query.tab : undefined) === tab.tab

/** The old addresses of the former menu entries and the tab each one is now. */
export const MOVED_PAGES = {
  '/admin/closures': '/admin/calendar/closures',
  '/admin/sick-days': '/admin/employees/sick-days',
  '/admin/rights': '/admin/users/rights',
} as const

/** Where an old address leads: the new one, keeping the query (e.g. ?year=) and the anchor. */
export function movedLocation(path: string, from: { query: LocationQuery; hash: string }): RouteLocationRaw {
  return { path, query: from.query, hash: from.hash }
}

/** The former tab „Unterschriften“ of „Dokumente“ (`/documents?tab=signatures`): now a tab of Mitarbeitende. */
export const SIGNATURES_PATH = '/admin/employees/signatures'

/** Where `/documents?tab=signatures` leads: the tab of Mitarbeitende, keeping the other query values and the anchor. */
export function signaturesLocation(from: { query: LocationQuery; hash: string }): RouteLocationRaw {
  const { tab: _tab, ...query } = from.query
  return { path: SIGNATURES_PATH, query, hash: from.hash }
}

/** The tabs „Unfälle“ (formerly Mehr → „Unfälle“): the children's in Kinder → Kinder, the employees' on Mitarbeitende. */
export const ACCIDENTS_TABS = {
  child: { path: '/children', query: { tab: 'accidents' } },
  employee: { path: '/admin/employees/accidents', query: {} },
} as const

/** The tab „Unfälle“ for one kind of report, with the year when given (e.g. the link of a reminder). */
export function accidentsTabLink(subject: 'child' | 'employee', year?: string): { path: string; query: Record<string, string> } {
  const { path, query } = ACCIDENTS_TABS[subject]
  return { path, query: year === undefined ? { ...query } : { ...query, year } }
}

/**
 * Where the former page Mehr → „Unfälle“ (`/admin/accidents?year=…&filter=…`) leads: `filter=employee` to the tab of
 * Mitarbeitende, anything else (all, children) to the tab of Kinder – for whoever does not open the children's pages with
 * the own account to the tab of Mitarbeitende instead. The year and the anchor stay.
 */
export function accidentsLocation(from: { query: LocationQuery; hash: string }, viewer: { children: boolean }): RouteLocationRaw {
  const subject = from.query.filter === 'employee' || !viewer.children ? 'employee' : 'child'
  const year = typeof from.query.year === 'string' && /^\d{4}$/.test(from.query.year) ? from.query.year : undefined
  return { ...accidentsTabLink(subject, year), hash: from.hash }
}
