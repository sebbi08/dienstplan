// The label texts are imported relative so a test can load this file.
import { de } from '../locales/de'
import type { PermissionKey } from '../../shared/domain/permissions'
import type { Role } from '../../shared/types/api'

/**
 * The entries of the main menu, grouped, by the account's permissions. Whoever has office pages (Leitung and Träger)
 * sees the everyday ones directly (`main`, with „Dokumente“ and its count), the rarely used ones under "Mehr" (`more`)
 * and, when linked to an employee, their own pages under "Meins" (`mine`). Schließzeiten sit in „Kalender“,
 * Krankheitstage in „Mitarbeiter“, Benutzer and Rechte together in „Benutzer & Rechte“ (tabs there). Mitarbeiter have
 * `main` and their own lists and "Dokumente" under "Meins"; the tablet only has „Start“ (its start page is the one hub).
 * Passwort ändern and Abmelden are added by the layout.
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
  /**
   * What waits under "Meins", shown there and on the phone menu button: unread messages about changed duties (managers),
   * open requests to sign and, for Mitarbeiter (whose „Dokumente“ sits there), the entries of „Wissen“ to confirm.
   */
  mineCount: number
  /** What waits under "Mehr" (nothing counted sits there any more since „Dokumente“ moved into the row). */
  moreCount: number
  /** Everything that is waiting: unread messages, open leave requests (planners only) and the count of "Mehr". */
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
  /**
   * The facility has contacts marked for the staff (GET /api/contacts/staff-count): then „Kontakte“ shows for accounts
   * without contacts.manage too.
   */
  staffContacts?: boolean
  /** Entries of „Wissen“ the account's employee still has to confirm (GET /api/knowledge/open-count), counted at „Dokumente“. */
  knowledgeOpen?: number
  /** Requests to sign the account's employee still has open (GET /api/my/sign-requests/count), at „Zu unterschreiben“. */
  signOpen?: number
  /** Overdue requests to sign of the facility (GET /api/sign-requests/overdue-count, signRequests.manage), counted at „Dokumente“. */
  signOverdue?: number
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
  // The tablet: its start page is the one hub (stamping, children, documents, plan, team meetings, notes … as tiles), so
  // the header only leads back there.
  if (viewer.role === 'terminal') {
    return { main: [entry(de.nav.tabletStart, '/terminal')], mine: [], more: [], mineCount: 0, moreCount: 0, totalCount: 0 }
  }

  const myPlan = entry(navLabelWithCount(de.nav.myPlan, viewer.unread), `/my/plan/${year}/${month}`, '/my/plan')
  const myLeave = entry(de.nav.myLeave, '/my/leave')
  const myRequirements = entry(de.nav.myRequirements, '/my/requirements')
  // The own staff talks: self-assessments to fill in and assessments released to read.
  const myTalks = entry(de.nav.myTalks, '/my/talks')
  // The accident reports about oneself (and filling one in): only with a linked employee.
  const myAccidents = viewer.employeeId !== null ? [entry(de.nav.myAccidents, '/my/accidents')] : []
  // The documents to sign (Zum Unterschreiben senden), with the open ones counted: only with a linked employee.
  const signOpen = viewer.employeeId !== null ? viewer.signOpen ?? 0 : 0
  const mySign = viewer.employeeId !== null ? [entry(navLabelWithCount(de.nav.mySign, signOpen), '/my/sign')] : []
  const plans = shown([[can('plan.view'), plan]])
  // The calendar to edit, or the own view of it (the short label keeps the header of a laptop on one line).
  const calendar = can('calendar.edit') ? entry(de.nav.calendarShort, '/admin/calendar') : entry(de.nav.calendarShort, '/my/calendar')
  // Writing in the team meetings needs a facility: a staff account without an employee belongs to none.
  const teamPages = shown([
    [can('teamMeetings.manage') || (can('teamMeetings.write') && viewer.employeeId !== null), teamMeetings],
    // The notes are a facility's too: Leitung and Träger always have one, everyone else through the linked employee.
    // (The roles are compared here: a value import of shared/domain through the relative path breaks the server build.)
    [can('notes.view') && (viewer.role === 'admin' || viewer.role === 'provider' || viewer.employeeId !== null), notes],
  ])
  // Every office entry shows with the key its page needs (utils/routeAccess.ts).
  const office = shown([
    [can('time.manage'), entry(de.nav.time, '/admin/time')],
    // Includes the overtime balances and leave accounts of all employees.
    [can('employees.view'), entry(de.nav.employees, '/admin/employees')],
    // Mitarbeiter see the children only at the tablet, so the entry needs access with the own account.
    [can('children.ownAccount'), entry(de.nav.children, '/children')],
  ])
  // The cash books of the facility and its groups: monthly work, so under "Mehr" (the row holds „Dokumente“ now).
  const cash = shown([[can('cash.view'), entry(de.nav.cash, '/cash')]])
  // "Dokumente": the form templates (tab „Bögen“: staff talks, child observations, team meetings, accident reports;
  // formTemplates.manage), the blank forms to print (tab „Vorlagen“; printTemplates.view) and „Wissen“ (knowledge.view, every
  // account). In the row for the managers (with its count), under "Meins" for Mitarbeiter (read only); the tablet reaches
  // them from its start page.
  const formsManager = can('formTemplates.manage')
  const documentsCount = (viewer.knowledgeOpen ?? 0) + (viewer.signOverdue ?? 0)
  const documents = shown([[formsManager || can('printTemplates.view') || can('knowledge.view'), entry(navLabelWithCount(de.nav.documents, documentsCount), '/documents')]])
  // „Kontakte“, the facility's address book: whoever maintains it, everyone else once there are contacts for the staff.
  const contactsEntry = entry(de.contacts.title, '/contacts')
  const contacts = shown([[can('contacts.manage') || !!viewer.staffContacts, contactsEntry]])
  // „Bewerbungen & Hospitationen“ without the staff list (e.g. a Gruppenleitung with the applicants' view); with it they
  // are a tab of „Mitarbeiter“, and the info visits a tab of Kinder → Planung.
  const applicants = shown([[!can('employees.view') && can('visits.applicants.view'), entry(de.visits.tabs.applicants, '/admin/employees/applicants')]])
  const adminMore = shown([
    // All accident reports of the facility (children and employees) with the year's list.
    [can('accidents.manage'), entry(de.nav.accidents, '/admin/accidents')],
    // „Benutzer & Rechte“: the accounts (users.manage) and, for the Träger, the rights of the roles (rights.manage) as tabs.
    [can('users.manage') || can('rights.manage'), entry(de.nav.usersRights, can('users.manage') ? '/admin/users' : '/admin/users/rights', '/admin/users')],
    [can('settings.facility'), entry(de.nav.settings, '/admin/settings')],
    // Deleting data after its retention period (all facilities on one page): the Träger's.
    [can('retention.delete'), entry(de.nav.retention, '/admin/retention')],
  ])

  // The print templates alone make no office account: Mitarbeiter read them as well (the form templates do).
  // (Schließzeiten and Krankheitstage are tabs of „Kalender“ and „Mitarbeiter“ now; their keys still make an office account.)
  const officeKeys = can('closures.manage') || can('employees.sickness') || cash.length > 0
  if (office.length > 0 || officeKeys || adminMore.length > 0 || formsManager || can('calendar.edit')) {
    const more = [...contacts, ...cash, ...applicants, ...adminMore]
    // With office pages (Leitung, Träger): the everyday ones in the row, the rest under "Mehr"; linked to an employee
    // also the own pages under "Meins" (stamping on "Mein Dienstplan", leave requests, own appointments).
    // "Urlaubsplanung": the planners with their open requests; whoever sees the leave overview too, for the notice on
    // remaining leave (also while leave requests are off).
    const open = viewer.isPlanner ? viewer.openCount : 0
    const planning = viewer.isPlanner || can('leave.overview')
      ? [entry(navLabelWithCount(de.nav.leavePlanning, open), '/admin/leave-planning')]
      : []
    const mine = viewer.employeeId !== null ? [myPlan, ...mySign, myLeave, myRequirements, myTalks, ...myAccidents] : []
    const mineCount = mine.length ? viewer.unread + signOpen : 0
    const documentsShown = documents.length ? documentsCount : 0
    return {
      main: [...plans, ...planning, ...office, calendar, ...teamPages, ...documents],
      mine,
      more,
      mineCount,
      moreCount: 0,
      totalCount: mineCount + open + documentsShown,
    }
  }

  return {
    // Seven entries in a row no longer fit the header of a tablet (1024 px), so the own lists sit under "Meins" like the
    // managers' ones; "Mein Dienstplan" (with the unread count) stays in the row.
    main: [myPlan, ...plans, calendar, ...teamPages],
    // The templates are the facility's: a staff account without an employee belongs to none.
    mine: [...mySign, myLeave, myRequirements, myTalks, ...myAccidents, ...(viewer.employeeId !== null ? [...documents, ...contacts] : []), ...applicants],
    more: [],
    // „Dokumente“ sits under "Meins" here, so its count (entries of „Wissen“ to confirm) counts there too.
    mineCount: signOpen + (viewer.employeeId !== null && documents.length ? documentsCount : 0),
    moreCount: 0,
    totalCount: viewer.unread + signOpen + (viewer.employeeId !== null && documents.length ? documentsCount : 0),
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
