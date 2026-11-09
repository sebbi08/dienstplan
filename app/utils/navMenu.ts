// The label texts are imported relative so a test can load this file.
import { de } from '../locales/de'
import type { PermissionKey } from '../../shared/domain/permissions'
import { isManager } from '../../shared/domain/roles'
import type { Role } from '../../shared/types/api'

/**
 * The entries of the main menu, grouped, by the account's permissions. Whoever has office pages (Leitung and Träger)
 * sees the everyday ones directly (`main`), the rarely used ones under "Mehr" (`more`) and, when linked to an employee,
 * their own pages under "Meins" (`mine`). Mitarbeiter have `main` and their own lists and the print templates under
 * "Meins"; the tablet only has
 * `main`. Passwort ändern and Abmelden are added by the layout.
 */

export interface NavEntry {
  label: string
  to: string
  /** Paths starting with this belong to the entry (e.g. every month of the plan). */
  match: string
}

export interface NavMenu {
  main: NavEntry[]
  mine: NavEntry[]
  more: NavEntry[]
  /** Unread messages about changed duties, shown on "Meins" (managers) and on the phone menu button. */
  mineCount: number
  /** Everything that is waiting: unread messages plus open leave requests (planners only). */
  totalCount: number
}

export interface NavViewer {
  /**
   * To tell the tablet apart (its menu is fixed: the tablet role is not part of the permission catalog) and whether the
   * account has a facility without a linked employee (Leitung and Träger always have one).
   */
  role: Role
  /** The account's permissions (useCan). */
  can: (key: PermissionKey) => boolean
  employeeId: number | null
  isPlanner: boolean
  openCount: number
  unread: number
  today: { year: number, month: number }
}

/** The label with the count in brackets, e.g. "Meins (2)"; without a count the plain label. */
export const navLabelWithCount = (label: string, count: number) => (count ? `${label} (${count})` : label)
const entry = (label: string, to: string, match = to): NavEntry => ({ label, to, match })
/** The entries whose condition holds, in their order. */
const shown = (entries: readonly [boolean, NavEntry][]): NavEntry[] => entries.filter(([show]) => show).map(([, navEntry]) => navEntry)

export function navMenu(viewer: NavViewer): NavMenu {
  const { can } = viewer
  const { year, month } = viewer.today
  const plan = entry(de.nav.plan, `/plan/${year}/${month}`, '/plan')
  // The team meetings (Teamsitzungen) are for every member of the facility, the tablet included (no child data).
  const teamMeetings = entry(de.nav.teamMeetings, '/team-meetings')
  // The facility's notes (Notizen): read by every member of the facility and the tablet.
  const notes = entry(de.nav.notes, '/notes')
  if (viewer.role === 'terminal') {
    return { main: [entry(de.nav.stamp, '/terminal'), plan, teamMeetings, notes], mine: [], more: [], mineCount: 0, totalCount: 0 }
  }

  const myPlan = entry(navLabelWithCount(de.nav.myPlan, viewer.unread), `/my/plan/${year}/${month}`, '/my/plan')
  const myLeave = entry(de.nav.myLeave, '/my/leave')
  const myRequirements = entry(de.nav.myRequirements, '/my/requirements')
  // The own staff talks: self-assessments to fill in and assessments released to read.
  const myTalks = entry(de.nav.myTalks, '/my/talks')
  const plans = shown([[can('plan.view'), plan]])
  // The calendar to edit, or the own view of it (the short label keeps the header of a laptop on one line).
  const calendar = can('calendar.edit') ? entry(de.nav.calendarShort, '/admin/calendar') : entry(de.nav.calendarShort, '/my/calendar')
  // Writing in the team meetings needs a facility: a staff account without an employee belongs to none.
  const teamPages = shown([
    [can('teamMeetings.manage') || (can('teamMeetings.write') && viewer.employeeId !== null), teamMeetings],
    // The notes are a facility's too: Leitung and Träger always have one, everyone else through the linked employee.
    [can('notes.view') && (isManager(viewer.role) || viewer.employeeId !== null), notes],
  ])
  // Every office entry shows with the key its page needs (utils/routeAccess.ts).
  const office = shown([
    [can('time.manage'), entry(de.nav.time, '/admin/time')],
    // Includes the overtime balances and leave accounts of all employees.
    [can('employees.view'), entry(de.nav.employees, '/admin/employees')],
    // Mitarbeiter see the children only at the tablet, so the entry needs access with the own account.
    [can('children.ownAccount'), entry(de.nav.children, '/children')],
    // The cash books of the facility and its groups.
    [can('cash.view'), entry(de.nav.cash, '/cash')],
  ])
  // Blank forms to print: under "Mehr" for the managers, under "Meins" for Mitarbeiter (read only); the tablet reaches
  // them from its start page.
  const templates = shown([[can('printTemplates.view'), entry(de.nav.templates, '/templates')]])
  const officeMore = shown([
    [can('closures.manage'), entry(de.nav.closures, '/admin/closures')],
    [can('employees.sickness'), entry(de.nav.sickDays, '/admin/sick-days')],
  ])
  const adminMore = shown([
    // The templates of staff talks, child observations and team meetings.
    [can('formTemplates.manage'), entry(de.nav.forms, '/admin/forms')],
    [can('users.manage'), entry(de.nav.users, '/admin/users')],
    // The rights of Leitung and Mitarbeiter: the Träger's.
    [can('rights.manage'), entry(de.nav.rights, '/admin/rights')],
    [can('settings.facility'), entry(de.nav.settings, '/admin/settings')],
    // Deleting data after its retention period (all facilities on one page): the Träger's.
    [can('retention.delete'), entry(de.nav.retention, '/admin/retention')],
  ])

  // The print templates alone make no office account: Mitarbeiter read them as well.
  if (office.length > 0 || officeMore.length > 0 || adminMore.length > 0 || can('calendar.edit')) {
    const more = [...officeMore, ...templates, ...adminMore]
    // With office pages (Leitung, Träger): the everyday ones in the row, the rest under "Mehr"; linked to an employee
    // also the own pages under "Meins" (stamping on "Mein Dienstplan", leave requests, own appointments).
    const open = viewer.isPlanner ? viewer.openCount : 0
    const planning = viewer.isPlanner ? [entry(navLabelWithCount(de.nav.leavePlanning, open), '/admin/leave-planning')] : []
    const mine = viewer.employeeId !== null ? [myPlan, myLeave, myRequirements, myTalks] : []
    const mineCount = mine.length ? viewer.unread : 0
    return {
      main: [...plans, ...planning, ...office, calendar, ...teamPages],
      mine,
      more,
      mineCount,
      totalCount: mineCount + open,
    }
  }

  return {
    // Seven entries in a row no longer fit the header of a tablet (1024 px), so the own lists sit under "Meins" like the
    // managers' ones; "Mein Dienstplan" (with the unread count) stays in the row.
    main: [myPlan, ...plans, calendar, ...teamPages],
    // The templates are the facility's: a staff account without an employee belongs to none.
    mine: [myLeave, myRequirements, myTalks, ...(viewer.employeeId !== null ? templates : [])],
    more: [],
    mineCount: 0,
    totalCount: viewer.unread,
  }
}

/** Whether the page at `path` belongs to the entry (the entry itself or a page below it). */
export function isEntryActive(path: string, navEntry: NavEntry): boolean {
  return path === navEntry.match || path.startsWith(`${navEntry.match}/`)
}

/** Whether the page at `path` belongs to one of the entries, so the "Mehr"/"Meins" button shows as active. */
export function isGroupActive(path: string, entries: readonly NavEntry[]): boolean {
  return entries.some(navEntry => isEntryActive(path, navEntry))
}
