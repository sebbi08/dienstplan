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
 * „Mitarbeiter“: the staff list (employees.view), „Bewerbungen & Hospitationen“ on the same page (?tab=applicants,
 * visits.applicants.view) and the sick days (employees.sickness).
 */
export const staffAreaTabs = (can: Can): AreaTab[] => only([
  [can('employees.view'), { label: de.nav.employees, to: '/admin/employees' }],
  [can('employees.view') && can('visits.applicants.view'), { label: de.visits.tabs.applicants, to: '/admin/employees', tab: 'applicants' }],
  [can('employees.sickness'), { label: de.nav.sickDays, to: '/admin/employees/sick-days' }],
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
