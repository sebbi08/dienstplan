// The label texts are imported relative so a test can load this file.
import { de } from '../locales/de'
import type { Role } from '../../shared/types/api'

/**
 * The entries of the main menu, grouped. Leitung and Träger see the everyday pages directly (`main`), the rarely used ones
 * under "Mehr" (`more`) and, when linked to an employee, their own pages under "Meins" (`mine`). Mitarbeiter and the
 * tablet only have `main`. Passwort ändern and Abmelden are added by the layout.
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
  role: Role
  employeeId: number | null
  isPlanner: boolean
  openCount: number
  unread: number
  today: { year: number, month: number }
}

/** The label with the count in brackets, e.g. "Meins (2)"; without a count the plain label. */
export const navLabelWithCount = (label: string, count: number) => (count ? `${label} (${count})` : label)
const entry = (label: string, to: string, match = to): NavEntry => ({ label, to, match })

export function navMenu(viewer: NavViewer): NavMenu {
  const { year, month } = viewer.today
  const plan = entry(de.nav.plan, `/plan/${year}/${month}`, '/plan')
  if (viewer.role === 'terminal') return { main: [entry(de.nav.stamp, '/terminal'), plan], mine: [], more: [], mineCount: 0, totalCount: 0 }

  const myPlan = entry(navLabelWithCount(de.nav.myPlan, viewer.unread), `/my/plan/${year}/${month}`, '/my/plan')
  const myLeave = entry(de.nav.myLeave, '/my/leave')
  const myRequirements = entry(de.nav.myRequirements, '/my/requirements')
  const open = viewer.isPlanner ? viewer.openCount : 0
  const planning = viewer.isPlanner ? [entry(navLabelWithCount(de.nav.leavePlanning, open), '/admin/leave-planning')] : []

  if (viewer.role === 'provider' || viewer.role === 'admin') {
    // An admin linked to an employee stamps on "Mein Dienstplan", requests leave and sees their own appointments too.
    const mine = viewer.employeeId !== null ? [myPlan, myLeave, myRequirements] : []
    const mineCount = mine.length ? viewer.unread : 0
    return {
      main: [
        plan,
        ...planning,
        entry(de.nav.time, '/admin/time'),
        // Includes the overtime balances and leave accounts of all employees.
        entry(de.nav.employees, '/admin/employees'),
        // Mitarbeiter see the children only at the tablet, so only the managers get the menu entry.
        entry(de.nav.children, '/children'),
        // The short label keeps the header of a laptop on one line.
        entry(de.nav.calendarShort, '/admin/calendar'),
      ],
      mine,
      more: [
        entry(de.nav.closures, '/admin/closures'),
        entry(de.nav.sickDays, '/admin/sick-days'),
        // Blank forms to print; the tablet reaches them from its start page, Mitarbeiter accounts not at all.
        entry(de.nav.templates, '/templates'),
        entry(de.nav.users, '/admin/users'),
        entry(de.nav.settings, '/admin/settings'),
      ],
      mineCount,
      totalCount: mineCount + open,
    }
  }

  return {
    main: [myPlan, plan, myLeave, myRequirements, entry(de.nav.calendar, '/my/calendar')],
    mine: [],
    more: [],
    mineCount: viewer.unread,
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
