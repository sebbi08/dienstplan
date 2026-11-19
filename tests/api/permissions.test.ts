import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACTORS as SCRIPT_ACTORS, DEFAULTS as SCRIPT_DEFAULTS, routeFiles, tabletPasses } from '../../scripts/route-access-snapshot.mjs'
import { PERMISSION_KEYS, PERMISSIONS, type PermissionKey } from '../../shared/domain/permissions'

const API_DIR = join(process.cwd(), 'server', 'api')

/**
 * Every route checks one permission (`requirePermission(event, '<key>'`, on the child pages
 * `requireChildPermission(event, '<key>')`), or keeps one of the fixed guards below. Who gets in under the role defaults
 * (at the tablet: the unlocking person's) must equal who got in before the switch (tests/fixtures/route-access-before.json,
 * frozen from the old role guards; Rechte und Rollen Teil 1, review focus 1).
 */

/** The accident reports about employees that go through requireUser( (the service checks accidents.manage or the own employee). */
const EMPLOYEE_ACCIDENT_ROUTES = [
  'my/accidents.get.ts', 'my/accidents.post.ts', 'employee-accidents/[formId].get.ts', 'employee-accidents/[formId].put.ts',
  'employee-accidents/[formId].delete.ts', 'employee-accidents/[formId]/attachments.post.ts',
  'employee-accident-attachments/[id]/file.get.ts', 'employee-accident-attachments/[id].delete.ts',
]
/**
 * Fixed: any signed-in account (Träger, Leitung, Mitarbeiter; never the tablet), checked with requireUser(. The own
 * data follows from the session alone (`user.employeeId`), so these need no permission.
 */
const USER_ROUTES = [
  'auth/password.post.ts',
  'my/plan/[year]/[month].get.ts',
  'my/leave.get.ts',
  'my/time.get.ts',
  'my/time/stamp.post.ts',
  'my/notifications.get.ts',
  'my/notifications/read.post.ts',
  // The module state and the own planner flag (the menu); planner lists only for managers (service).
  'leave-settings.get.ts',
  'my/leave-requests.get.ts',
  'my/leave-requests.post.ts',
  'my/leave-requests/preview.get.ts',
  'my/leave-requests/[id]/withdraw.post.ts',
  // The own notice on remaining leave and its „Gelesen“: the employee follows from the session alone.
  'my/leave-forfeit.get.ts',
  'my/leave-forfeit/read.post.ts',
  // Renders a print page with the caller's cookie; that page's API calls check the permissions.
  'pdf.get.ts',
  // The facility name in the header (the own facility; the Träger's switcher lists all of them).
  'facilities.get.ts',
  'my/calendar.get.ts',
  'my/requirements.get.ts',
  // The consent that colleagues see the own emergency contacts at the tablet: only the employee themselves, from the session.
  'my/emergency-consent.get.ts', 'my/emergency-consent.put.ts', 'my/emergency-contacts.get.ts',
  // The employee's own staff talks (spec Bögen §3): only their own, only released forms.
  'my/talks/index.get.ts', 'my/talks/forms/[formId].get.ts', 'my/talks/forms/[formId].put.ts',
  'my/talks/forms/[formId]/submit.post.ts',
  // Accident reports about employees: the own ones („Meine Unfälle“), and for accidents.manage the facility's; the
  // service decides per report (another employee's is 404). Never the tablet.
  ...EMPLOYEE_ACCIDENT_ROUTES,
]
/** Fixed: only the shared stamp tablet, checked with requireTerminal(. */
const TERMINAL_ROUTES = [
  'terminal/status.get.ts', 'terminal/stamp.post.ts', 'terminal/children/unlock.post.ts', 'terminal/children/lock.post.ts',
  'terminal/children/keep-alive.post.ts', 'terminal/children/status.get.ts',
  // The consenting colleagues' emergency contacts: the service asks for the unlock like the child data.
  'terminal/staff-emergency-contacts.get.ts',
  // The tablet's offline queue (stamps kept without network, sent later): the tablet only, never an account.
  'terminal/offline-stamps.post.ts',
]
/** Routes that need no session at all. */
const PUBLIC_ROUTES = ['health.get.ts', 'auth/login.post.ts']

/** The child observation forms (Beobachtungsbögen), among the child view routes. */
const CHILD_FORM_ROUTES = [
  'children/[id]/forms/index.get.ts', 'children/[id]/forms/index.post.ts', 'child-forms/[formId].get.ts',
  'child-forms/[formId].put.ts', 'child-forms/[formId].delete.ts', 'child-forms/[formId]/editors.get.ts',
  'child-forms/[formId]/editors.put.ts',
]
/**
 * The child pages check with requireChildPermission(: an account needs children.ownAccount besides the key (403
 * children_tablet_only), the tablet an unlock (403 tablet_locked), and there the unlocking person's permissions count.
 * children.view: whoever looks at child records (the services decide per group and per form who reads and who writes).
 */
const CHILD_VIEW_ROUTES = [
  'care-types/index.get.ts', 'document-types/index.get.ts', 'children/index.get.ts', 'children/planned.get.ts', 'children/birthdays.get.ts', 'children/groups.get.ts',
  'children/open.get.ts', 'children/staff.get.ts', 'children/school-cutoff.get.ts', 'children/[id].get.ts', 'child-documents/[id]/file.get.ts', 'child-documents/overview.get.ts',
  // The Excel-like overview: the tablet lock for staff like the records (spec Übersicht §3).
  'children/overview.get.ts',
  'attendance/day.get.ts', 'attendance/history.get.ts', 'attendance/month.get.ts',
  'group-book/week.get.ts', 'group-book/history.get.ts',
  'children/reminders.get.ts',
  // Observation forms: whoever sees the record reads them; the service decides per form who edits (spec Bögen §4).
  ...CHILD_FORM_ROUTES,
  // Accident reports about a child: whoever sees the record reads them and their attachments.
  'children/[id]/accidents/index.get.ts', 'child-accidents/[formId].get.ts', 'child-accident-attachments/[id]/file.get.ts',
  // § 34 IfSG: the rules for the dialogs (diseases, readmission, date rules).
  'ifsg/rules.get.ts',
  // The local health office's documents: every child viewer reads them in the app, at the tablet never as a download.
  'ifsg/documents/index.get.ts', 'ifsg/documents/[id]/file.get.ts',
]
/**
 * children.attendance: attendance (every child viewer writes it, spec Anwesenheit §7), the group books and the
 * development documentation's done/undo; the service decides by the group rights (spec Erinnerungen §2.3).
 */
const CHILD_ATTENDANCE_ROUTES = [
  'attendance/arrive.post.ts', 'attendance/leave.post.ts', 'attendance/announcements/index.post.ts',
  'attendance/announcements/[id].delete.ts', 'attendance/absence.put.ts', 'attendance/day.put.ts', 'attendance/stays/[id].put.ts',
  'attendance/stays/[id].delete.ts', 'attendance/month-remark.put.ts',
  // „Gruppen zusammenlegen“ and „Zusammenlegung beenden“: whoever stamps in the day list, any groups of the facility.
  'attendance/merges/index.post.ts', 'attendance/merges/[id].delete.ts',
  'group-book/week.put.ts', 'group-book/day.put.ts',
  'children/[id]/development-docs.post.ts', 'children/development-docs/[id].delete.ts',
  // Notes: written by whoever keeps the attendance, with its group scope; the service lets only the author, Leitung
  // and Träger change and delete one.
  'children/[id]/notes.post.ts', 'children/notes/[id].put.ts', 'children/notes/[id].delete.ts',
  // Accident reports about a child: written like the notes; the service lets only the author, Leitung and Träger change one.
  'children/[id]/accidents/index.post.ts', 'child-accidents/[formId].put.ts', 'child-accidents/[formId]/attachments.post.ts',
  'child-accident-attachments/[id].delete.ts',
  // § 34 IfSG cases: entered, corrected and readmitted by whoever keeps the attendance; the service lets only the child's
  // own group and the managers, and keeps the health office fields to the managers.
  'ifsg/cases/index.post.ts', 'ifsg/cases/[id].put.ts', 'ifsg/cases/[id]/readmit.post.ts', 'ifsg/cases/[id]/declaration.get.ts',
]
/** children.edit: maintaining child records (Leitung, Träger; at the tablet Mitarbeiter with the flag). */
const CHILD_EDITOR_ROUTES = [
  'children/index.post.ts', 'children/[id]/master.put.ts', 'children/[id]/health.put.ts',
  'children/[id]/consents.put.ts', 'children/[id]/confirm.post.ts', 'children/[id]/contacts.post.ts', 'children/[id]/contacts/order.post.ts',
  'child-contacts/[id].put.ts', 'child-contacts/[id].delete.ts',
  'children/[id]/documents.post.ts', 'child-documents/[id].put.ts', 'child-documents/[id].delete.ts',
  // Parent meetings: the record section's rights; the service keeps the note to Leitung and Träger (spec Elterngespräche §1).
  'children/[id]/meetings.post.ts', 'children/meetings/[id].put.ts', 'children/meetings/[id].delete.ts',
]
/** children.manage: the Leitung's child pages, at the office or at the unlocked tablet. */
const CHILD_MANAGER_ROUTES = [
  'children/[id].delete.ts', 'children/archive.get.ts', 'children/occupancy.get.ts', 'children/school-children.get.ts',
  'children/[id]/group-change.post.ts', 'child-group-changes/[id].put.ts', 'child-group-changes/[id].delete.ts',
  'children/[id]/leave.post.ts', 'children/[id]/unleave.post.ts', 'children/age-limit-warnings.get.ts',
  // § 34 IfSG: the overview with the children's names, deleting a case entered by mistake, the parents' notice.
  'ifsg/cases/index.get.ts', 'ifsg/cases/[id].delete.ts', 'ifsg/cases/[id]/notice.get.ts',
  // A cluster (§ 34 Abs. 6 Satz 2) reported to the health office.
  'ifsg/clusters/ack.post.ts',
]
/** accidents.manage: deleting an accident report about a child (Leitung, Träger; at the office or the unlocked tablet). */
const CHILD_ACCIDENT_MANAGER_ROUTES = ['child-accidents/[formId].delete.ts']
/** Each child route with the one permission it checks. */
const CHILD_ROUTES: Record<string, PermissionKey> = Object.fromEntries([
  ...CHILD_ACCIDENT_MANAGER_ROUTES.map(route => [route, 'accidents.manage']),
  ...CHILD_VIEW_ROUTES.map(route => [route, 'children.view']),
  ...CHILD_ATTENDANCE_ROUTES.map(route => [route, 'children.attendance']),
  ...CHILD_EDITOR_ROUTES.map(route => [route, 'children.edit']),
  ...CHILD_MANAGER_ROUTES.map(route => [route, 'children.manage']),
])

/**
 * Routes without a facility of their own (`facility: 'none'`) act on any facility, so their permission must stay with
 * the Träger (providerOnly); the exceptions check the facility themselves.
 */
const FACILITY_FREE_EXCEPTIONS: Record<string, string> = {
  'groups/[id]/school-children.put.ts': 'refuses a group of another facility unless the user may edit other facilities',
}

const ACTORS = SCRIPT_ACTORS as string[]
/** The roles of the rights page (Teil 3 added the Gruppenleitung). */
const RIGHTS_ROLES = ['admin', 'group_lead', 'observer'] as const
const TABLET_PEOPLE = ACTORS.filter(actor => actor.startsWith('tablet:'))

/** The role defaults and the tablet model of scripts/route-access-snapshot.mjs (one copy of it). */
const DEFAULTS = SCRIPT_DEFAULTS as Record<typeof RIGHTS_ROLES[number], ReadonlySet<PermissionKey>>
const tabletPassesChild = tabletPasses as (actor: string, key: PermissionKey) => boolean
const PROVIDER_ONLY = new Set(PERMISSIONS.filter(permission => permission.providerOnly).map(permission => permission.key))

const OLD_GUARDS = /require(Admin|Provider|TemplateReader|ChildReader|ChildEditor|ChildManager)\(/
const PERMISSION_CALL = /requirePermission\(event, '([^']+)'(?:, (\{[^}]*\}))?\)/g
const CHILD_PERMISSION_CALL = /requireChildPermission\(event, '([^']+)'\)/g

const routes = routeFiles() as string[]
const fixture = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'route-access-before.json'), 'utf8')) as
  Record<string, string[]>

function source(route: string): string {
  return readFileSync(join(API_DIR, route), 'utf8')
}

/** The route's permission checks: key and options text. */
function permissionCalls(route: string): { key: string; options: string }[] {
  return [...source(route).matchAll(PERMISSION_CALL)].map(([, key, options]) => ({ key: key!, options: options ?? '' }))
}

/** Who passes `requirePermission(event, key, options)` under the role defaults (the Träger has every key). */
function permissionActors(key: PermissionKey, options: string): string[] {
  const actors = ['provider', ...RIGHTS_ROLES.filter(role => DEFAULTS[role].has(key))]
  if (/allowTerminal: true/.test(options)) actors.push('terminal')
  return actors
}

/**
 * Who passes `requireChildPermission(event, key)` under the role defaults: an account with children.ownAccount and
 * the key, the tablet unlocked by a person with the key; the keys that change records also need an account.
 */
function childPermissionActors(key: PermissionKey): string[] {
  const office = ['provider', ...RIGHTS_ROLES
    .filter(role => DEFAULTS[role].has('children.ownAccount') && DEFAULTS[role].has(key))]
  return [...office, ...TABLET_PEOPLE.filter(actor => tabletPassesChild(actor, key))]
}

/** Who passes the fixed guards. */
function guardActors(route: string): string[] {
  if (PUBLIC_ROUTES.includes(route)) return ['anonymous', 'provider', ...RIGHTS_ROLES, 'terminal']
  if (TERMINAL_ROUTES.includes(route)) return ['terminal']
  if (USER_ROUTES.includes(route)) return ['provider', ...RIGHTS_ROLES]
  throw new Error(`${route}: no fixed guard`)
}

/** The tablet unlocked by someone passes wherever the tablet as such passes. */
function expanded(actors: string[]): string[] {
  const all = actors.includes('terminal') ? [...actors, ...TABLET_PEOPLE] : actors
  return ACTORS.filter(actor => all.includes(actor))
}

describe('API route permissions', () => {
  it('finds the API routes, and every listed route exists once', () => {
    expect(routes).toHaveLength(Object.keys(fixture).length)
    const fixed = [...USER_ROUTES, ...TERMINAL_ROUTES, ...PUBLIC_ROUTES, ...Object.keys(CHILD_ROUTES)]
    expect(new Set(fixed).size).toBe(fixed.length)
    for (const route of fixed) expect(routes).toContain(route)
    for (const route of Object.keys(FACILITY_FREE_EXCEPTIONS)) expect(routes).toContain(route)
    const childLists = [CHILD_VIEW_ROUTES, CHILD_ATTENDANCE_ROUTES, CHILD_EDITOR_ROUTES, CHILD_MANAGER_ROUTES, CHILD_ACCIDENT_MANAGER_ROUTES].flat()
    expect(childLists).toHaveLength(Object.keys(CHILD_ROUTES).length)
  })

  it.each(routes)('%s lets in exactly who got in before the switch', (route) => {
    const code = source(route)
    expect(code, 'the role guards are gone').not.toMatch(OLD_GUARDS)
    const calls = permissionCalls(route)
    const childCalls = [...code.matchAll(CHILD_PERMISSION_CALL)].map(([, key]) => key!)
    if (PUBLIC_ROUTES.includes(route)) {
      expect(code).not.toMatch(/require(User|Terminal|Permission|ChildPermission)\(/)
    }
    else if (TERMINAL_ROUTES.includes(route)) {
      expect(code).toContain('requireTerminal(')
      expect(code).not.toMatch(/require(User|Permission|ChildPermission)\(/)
    }
    else if (USER_ROUTES.includes(route)) {
      expect(code).toContain('requireUser(')
      expect(code).not.toMatch(/allowTerminal|require(Terminal|Permission|ChildPermission)\(/)
    }
    else if (route in CHILD_ROUTES) {
      expect(childCalls, `${route}: one child permission, the declared one`).toEqual([CHILD_ROUTES[route]])
      expect(code.match(/requireChildPermission\(/g), 'one child permission check, written in one call').toHaveLength(1)
      expect(code).not.toMatch(/require(User|Terminal|Permission)\(/)
      expect(calls).toHaveLength(0)
      expect(expanded(childPermissionActors(CHILD_ROUTES[route]!)), route).toEqual(expanded(fixture[route]!))
      return
    }
    else {
      expect(calls, 'new routes must check exactly one permission: requirePermission(event, \'<key>\'').toHaveLength(1)
      expect(code.match(/requirePermission\(/g), 'one permission check, written in one call').toHaveLength(1)
      expect(code).not.toMatch(/require(User|Terminal|ChildPermission)\(/)
      const [{ key, options }] = calls as [{ key: string; options: string }]
      expect(PERMISSION_KEYS as readonly string[], route).toContain(key)
      expect(expanded(permissionActors(key as PermissionKey, options)), route).toEqual(expanded(fixture[route]!))
      if (/facility: 'none'/.test(options) && !(route in FACILITY_FREE_EXCEPTIONS)) {
        expect(PROVIDER_ONLY.has(key as PermissionKey), `${route}: ${key} works across facilities`).toBe(true)
      }
      return
    }
    expect(calls).toHaveLength(0)
    expect(childCalls).toHaveLength(0)
    expect(expanded(guardActors(route)), route).toEqual(expanded(fixture[route]!))
  })

  it('keeps no role guard in server/utils/auth.ts', () => {
    const auth = readFileSync(join(process.cwd(), 'server', 'utils', 'auth.ts'), 'utf8')
    expect(auth).not.toMatch(/export async function require(Admin|Provider|TemplateReader|ChildReader|ChildEditor|ChildManager)\b/)
    expect(auth).toMatch(/export async function requirePermission\(/)
    expect(auth).toMatch(/export async function requireChildPermission\(/)
  })

  it('decides on child records by the permissions of the person acting, never by the role', () => {
    // At the tablet the viewer carries the unlocking person's permissions (tabletUnlock.ts viewerFor); the role stays
    // only to name who they are.
    const files = ['server/lib/childRecord.ts', 'server/lib/childViewer.ts', 'shared/domain/childForms.ts',
      ...['ageLimits', 'capacityWarnings', 'childAttendance', 'childContacts', 'childDocuments', 'childForms', 'childGroupChanges',
        'children', 'groupBook', 'groups', 'parentMeetings', 'reminders', 'tabletUnlock']
        .map(name => `server/services/${name}.ts`)]
    for (const file of files) {
      const code = readFileSync(join(process.cwd(), file), 'utf8')
      expect(code, file).not.toMatch(/\bisManager\(|\bmayEditChildren\(|\b(viewer|actor|reader|editor|manager)\.role\b|rolePermissions\(/)
      // Neither the account's role compared nor the old column „darf Kinderakten pflegen“ read.
      expect(code, file).not.toMatch(/\baccount\??\.role\s*[!=]==|\.canEditChildren\b|can_edit_children/)
    }
  })

  it('checks the facility-free exceptions themselves', () => {
    const code = source('groups/[id]/school-children.put.ts')
    expect(code).toContain("requirePermission(event, 'children.schoolSettings', { facility: 'none' })")
    expect(code).toContain("can(user.permissions, 'settings.otherFacility')")
  })

  it('opens the mandatory appointments to managers only, apart from the read-only own view', () => {
    const touching = routes.filter(route => /requirement|training/i.test(route) || source(route).includes('services/requirements\''))
    expect(touching).toHaveLength(12)
    for (const route of touching) {
      const code = source(route)
      if (route === 'my/requirements.get.ts') {
        // The own view takes nothing from the request: whose records it shows follows from the session alone.
        expect(code).toContain('requireUser(')
        expect(code).toContain('getMyRequirements(')
        expect(code).not.toMatch(/getRouterParam|getValidated|readValidatedBody|readBody|getQuery/)
      }
      else {
        expect(permissionCalls(route).map(call => call.key), route)
          .toEqual([expect.stringMatching(/^(employees\.view|employees\.edit|settings\.facility)$/)])
        expect(code, route).not.toContain("facility: 'none'")
        expect(code, route).toContain('.facilityId')
      }
    }
  })

  it('keeps the employees\' children to the personal data right, the Kinderkrankentage to the sick days, the values to the Träger', () => {
    expect(permissionCalls('employees/[id]/children.get.ts')).toEqual([{ key: 'employees.personal', options: '' }])
    // Changing needs employees.edit here and employees.personal in the service (403 forbidden).
    expect(permissionCalls('employees/[id]/children.put.ts')).toEqual([{ key: 'employees.edit', options: '' }])
    expect(source('employees/[id]/children.put.ts')).toContain('admin.permissions')
    expect(permissionCalls('employees/[id]/child-sick-days.get.ts')).toEqual([{ key: 'employees.sickness', options: '' }])
    for (const route of ['employees/[id]/children.get.ts', 'employees/[id]/children.put.ts', 'employees/[id]/child-sick-days.get.ts']) {
      expect(source(route), route).toContain('.facilityId')
      expect(fixture[route], route).toEqual(['provider', 'admin'])
    }
    expect(permissionCalls('child-sick-settings.get.ts')).toEqual([{ key: 'settings.facility', options: '' }])
    expect(permissionCalls('child-sick-settings.put.ts')).toEqual([{ key: 'settings.absenceCodes', options: '' }])
    expect(PROVIDER_ONLY.has('settings.absenceCodes')).toBe(true)
    expect(fixture['child-sick-settings.put.ts']).toEqual(['provider'])
    // The parent status rides only with „Lohn und Steuer“.
    expect(permissionCalls('employees/[id]/payroll.get.ts')).toEqual([{ key: 'employees.payroll', options: '' }])
  })

  it('opens the Mutterschutz cases to whoever has the sick days right, in the active facility, never about themselves', () => {
    const touching = routes.filter(route => /(^|\/)maternity/.test(route) || source(route).includes('services/maternity\''))
    expect(touching).toEqual([
      'employees/[id]/maternity.get.ts', 'employees/[id]/maternity.post.ts', 'maternity/[id].delete.ts', 'maternity/[id].put.ts',
      'maternity/[id]/ban-check.put.ts', 'maternity/[id]/book.post.ts',
    ])
    for (const route of touching) {
      const code = source(route)
      // Health data: Leitung and Träger by default, never a Mitarbeiter or the tablet; never the viewer's own case. Booking
      // the plan checks plan.edit in the service.
      expect(permissionCalls(route), route).toEqual([{ key: 'employees.sickness', options: '' }])
      expect(code, route).toContain('admin.facilityId')
      expect(code, route).toContain('ownEmployeeId: admin.employeeId')
      expect(code, route).not.toMatch(/allowTerminal|facility: 'none'/)
      expect(fixture[route], route).toEqual(['provider', 'admin'])
    }
  })

  it('lets the Leitung read how 24 and 31 December count as leave; only the Träger changes it (Leitung 403)', () => {
    expect(permissionCalls('leave-counting.get.ts')).toEqual([{ key: 'settings.facility', options: '' }])
    expect(permissionCalls('leave-counting.put.ts')).toEqual([{ key: 'leave.configure', options: '' }])
    expect(PROVIDER_ONLY.has('leave.configure')).toBe(true)
    expect(fixture['leave-counting.get.ts']).toEqual(['provider', 'admin'])
    expect(fixture['leave-counting.put.ts']).toEqual(['provider'])
    // The facility of the request: for the Träger on the settings pages the one „Einstellungen für“ names.
    expect(source('leave-counting.put.ts')).toContain('provider.facilityId')
  })

  it('gives the employee list its extras (next level, appointments, leave notice) to employees.view and sorts the parts by the viewer\'s rights in the service', () => {
    expect(permissionCalls('employees/list-extras.get.ts')).toEqual([{ key: 'employees.view', options: '' }])
    expect(source('employees/list-extras.get.ts')).toContain('viewer.facilityId')
    expect(source('employees/list-extras.get.ts')).toContain('viewer.permissions')
    expect(fixture['employees/list-extras.get.ts']).toEqual(['provider', 'admin'])
  })
  it('keeps the consent to show emergency contacts at the tablet to the employee, the written record to Leitung, the list to the unlocked tablet', () => {
    // The employee follows from the session alone: nothing from the request names them.
    for (const route of ['my/emergency-consent.get.ts', 'my/emergency-consent.put.ts', 'my/emergency-contacts.get.ts']) {
      expect(source(route), route).toContain('requireUser(event)')
      expect(source(route), route).not.toMatch(/getRouterParam|getValidatedRouterParams|employeeId/)
    }
    expect(permissionCalls('employees/[id]/emergency-consent.get.ts')).toEqual([{ key: 'employees.view', options: '' }])
    expect(permissionCalls('employees/[id]/emergency-consent.put.ts')).toEqual([{ key: 'employees.edit', options: '' }])
    for (const route of ['employees/[id]/emergency-consent.get.ts', 'employees/[id]/emergency-consent.put.ts']) {
      expect(source(route), route).toContain('.facilityId')
      expect(fixture[route], route).toEqual(['provider', 'admin'])
    }
    // Only the tablet, and only through the same unlock check as the child data.
    const list = source('terminal/staff-emergency-contacts.get.ts')
    expect(list).toContain('requireTerminal(event)')
    expect(list).toContain('childUnlockToken(event)')
    expect(readFileSync(join(process.cwd(), 'server', 'services', 'staffEmergencyConsent.ts'), 'utf8')).toContain('tabletChildViewer(')
  })

  it('lets Leitung and Träger set the notice on remaining leave, and see who read it with the leave overview', () => {
    expect(permissionCalls('leave-forfeit-settings.get.ts')).toEqual([{ key: 'settings.facility', options: '' }])
    expect(permissionCalls('leave-forfeit-settings.put.ts')).toEqual([{ key: 'settings.facility', options: '' }])
    expect(permissionCalls('leave-forfeit.get.ts')).toEqual([{ key: 'leave.overview', options: '' }])
    for (const route of ['leave-forfeit-settings.get.ts', 'leave-forfeit-settings.put.ts', 'leave-forfeit.get.ts']) {
      expect(fixture[route], route).toEqual(['provider', 'admin'])
      expect(source(route), route).toContain('admin.facilityId')
    }
    // „Gelesen“ only by the employee themselves: nothing from the request names the employee.
    for (const route of ['my/leave-forfeit.get.ts', 'my/leave-forfeit/read.post.ts']) {
      expect(source(route), route).toContain('requireUser(event)')
      expect(source(route), route).not.toMatch(/getRouterParam|employeeId/)
    }
  })

  it('guards „Alle Anträge und Urlaube“ as the planning page: leave overview, the planner checked in the service', () => {
    for (const route of ['leave-planning.get.ts', 'leave-planning/all.get.ts']) {
      expect(permissionCalls(route), route).toEqual([{ key: 'leave.overview', options: '' }])
      expect(fixture[route], route).toEqual(['provider', 'admin'])
      expect(source(route), route).toContain('user.facilityId')
    }
    expect(readFileSync(join(process.cwd(), 'server', 'services', 'leaveYearList.ts'), 'utf8')).toContain('requirePlanner(db, user, facilityId)')
  })

  it('lets only Leitung and Träger change the local health office rules and documents (settings.facility)', () => {
    for (const route of ['ifsg/local-rules/index.get.ts', 'ifsg/local-rules/index.post.ts', 'ifsg/local-rules/[key].put.ts',
      'ifsg/local-rules/[key].delete.ts', 'ifsg/local-rules/preset.post.ts', 'ifsg/documents/index.post.ts', 'ifsg/documents/[id].delete.ts',
      'ifsg/settings.get.ts', 'ifsg/settings.put.ts']) {
      expect(permissionCalls(route), route).toEqual([{ key: 'settings.facility', options: '' }])
      expect(fixture[route], route).toEqual(['provider', 'admin'])
      expect(source(route), route).toContain('admin.facilityId')
    }
  })

  it('opens the meal settings to managers of the active facility only', () => {
    const touching = routes.filter(route => /^meals\//.test(route) || source(route).includes('services/meals\''))
    expect(touching).toEqual(['meals/[id].delete.ts', 'meals/[id].put.ts', 'meals/index.get.ts', 'meals/index.post.ts',
      'meals/versions/[id].delete.ts'])
    for (const route of touching) {
      const code = source(route)
      expect(code, route).toContain("requirePermission(event, 'settings.facility')")
      expect(code, route).toContain('admin.facilityId')
    }
  })

  it('opens the cash book to managers of the active facility only (staff and tablet 403)', () => {
    const touching = routes.filter(route => /^cash\//.test(route) || /services\/cash\w*'/.test(source(route)))
    expect(touching.length).toBeGreaterThanOrEqual(12)
    for (const route of touching) {
      const code = source(route)
      const [call] = permissionCalls(route)
      expect(call?.key, route).toMatch(/^cash\./)
      expect(call?.options, route).toBe('')
      // Purging an archived box is the Träger's (Löschfristen §4); reopening a closed month since the rights page also
      // the Leitung's (cash.reopen).
      const actorName = call!.key === 'cash.purge' ? 'provider' : call!.key === 'cash.reopen' ? 'actor' : 'admin'
      expect(code, route).toContain(`${actorName}.facilityId`)
    }
  })

  it('opens the child observation forms only through the child guard, the rights per form left to the service', () => {
    const touching = routes.filter(route => /^child-forms\/|^children\/\[id\]\/forms\//.test(route)
      || source(route).includes('services/childForms\''))
    expect(touching).toEqual([...CHILD_FORM_ROUTES].sort())
    for (const route of touching) {
      const code = source(route)
      // The child guard refuses a Mitarbeiter account outside the tablet (403 children_tablet_only).
      expect(code, route).toContain("requireChildPermission(event, 'children.view')")
      expect(code, route).not.toMatch(/require(User|Permission|Terminal)\(/)
      expect(code, route).toContain('(useDb(), viewer,')
    }
  })

  it('opens the staff talks to managers of the active facility, and only the own released forms to the employee', () => {
    const touching = routes.filter(route => /^(staff-talks|my\/talks)\//.test(route) || source(route).includes('services/staffTalks\''))
    expect(touching).toHaveLength(16)
    for (const route of touching) {
      const code = source(route)
      if (route.startsWith('my/talks/')) {
        // Whose talks follows from the session alone; the tablet is refused by requireUser (no allowTerminal).
        expect(USER_ROUTES, route).toContain(route)
        expect(code, route).toContain('requireUser(event)')
        expect(code, route).not.toMatch(/allowTerminal|employeeId|getQuery|require(Permission|Terminal)\(/)
      }
      else {
        expect(code, route).toContain("requirePermission(event, 'talks.manage')")
        expect(code, route).toContain('admin.facilityId')
        // Never the manager's own talks (ruling: those are held by the Träger or another Leitung).
        expect(code, route).toContain('ownEmployeeId: admin.employeeId')
      }
    }
  })

  it('opens the team meetings to every member of the facility; release, reopen and delete to managers only', () => {
    const touching = routes.filter(route => /^team-meetings\//.test(route) || source(route).includes('services/teamMeetings\''))
    expect(touching).toEqual(['team-meetings/[id].delete.ts', 'team-meetings/[id].get.ts', 'team-meetings/[id].put.ts',
      'team-meetings/[id]/release.post.ts', 'team-meetings/[id]/reopen.post.ts', 'team-meetings/[id]/sign.post.ts',
      'team-meetings/index.get.ts', 'team-meetings/index.post.ts'])
    const members = ['team-meetings/index.get.ts', 'team-meetings/index.post.ts', 'team-meetings/[id].get.ts',
      'team-meetings/[id].put.ts', 'team-meetings/[id]/sign.post.ts']
    for (const route of touching) {
      const code = source(route)
      // Whose facility follows from the session alone; the service resolves the member (teamMember).
      expect(code, route).toContain('teamMember(useDb(), ')
      expect(code, route).not.toMatch(/getQuery\(|facilityId|require(User|Terminal|ChildPermission)\(/)
      // The Träger's stale page (409 facility_changed) and accounts without a facility (403 no_facility); the members
      // always in the active facility (as requireFacility's result was not used before).
      expect(code, route).not.toContain("facility: 'none'")
      expect(code, route).toContain(members.includes(route)
        ? "requirePermission(event, 'teamMeetings.write', { allowTerminal: true, facility: 'active' })"
        : "requirePermission(event, 'teamMeetings.manage')")
    }
  })

  it('opens the form templates to managers of the active facility only (staff and tablet 403)', () => {
    const touching = routes.filter(route => /^form-templates\//.test(route) || source(route).includes('services/formTemplates\''))
    expect(touching).toEqual(['form-templates/[id].delete.ts', 'form-templates/[id].put.ts', 'form-templates/[id]/copy.post.ts',
      'form-templates/index.get.ts', 'form-templates/index.post.ts'])
    for (const route of touching) {
      const code = source(route)
      expect(code, route).toContain("requirePermission(event, 'formTemplates.manage')")
      expect(code, route).toContain('admin.facilityId')
    }
  })

  it('lets only the Träger change the staffing overrides; managers read them in their active facility', () => {
    const touching = routes.filter(route => source(route).includes('services/staffing\''))
    expect(touching).toEqual(['staffing-settings.delete.ts', 'staffing-settings.get.ts', 'staffing-settings.put.ts'])
    for (const route of ['staffing-settings.delete.ts', 'staffing-settings.put.ts']) {
      const code = source(route)
      expect(code, route).toContain("requirePermission(event, 'settings.staffing')")
      expect(code, route).toContain('provider.facilityId')
    }
    const read = source('staffing-settings.get.ts')
    expect(read).toContain("requirePermission(event, 'settings.facility')")
    expect(read).toContain('admin.facilityId')
  })

  it('lets managers of the active facility set, clear and unlock stamp PINs', () => {
    const touching = routes.filter(route => /\b(setPin|clearPin|unlockPin)\(/.test(source(route)))
    expect(touching).toEqual(['employees/[id]/pin.delete.ts', 'employees/[id]/pin.put.ts', 'employees/[id]/pin/unlock.post.ts'])
    for (const route of touching) {
      const code = source(route)
      expect(code, route).toContain("requirePermission(event, 'employees.edit')")
      expect(code, route).toContain('admin.facilityId')
    }
  })

  it('keeps the closure leave preview to who creates employees, in the active facility, writing nothing', () => {
    const touching = routes.filter(route => source(route).includes('services/closurePreview\''))
    expect(touching).toEqual(['employees/[id]/closure-preview.get.ts', 'employees/closure-preview.post.ts'])
    for (const route of touching) {
      expect(permissionCalls(route), route).toEqual([{ key: 'employees.edit', options: '' }])
      expect(source(route), route).toContain('actor.facilityId')
    }
  })

  it('lets managers of the active facility delete a left employee for good', () => {
    const touching = routes.filter(route => source(route).includes('services/employeeDeletion\''))
    expect(touching).toEqual(['employees/[id].delete.ts'])
    const code = source('employees/[id].delete.ts')
    expect(code).toContain("requirePermission(event, 'employees.delete')")
    expect(code).toContain('deleteLeftEmployee(useDb(), admin, admin.facilityId, id, confirm)')
    // The name is personal data: only from the body, never the URL (logs).
    expect(code).not.toContain('getQuery(')
  })

  it('keeps the personnel file to its keys: payroll for employees.payroll, documents by folder in the service', () => {
    const touching = routes.filter(route => /services\/employee(Payroll|Documents)'/.test(source(route)))
    expect(touching).toEqual(['employee-documents/[id].delete.ts', 'employee-documents/[id].get.ts', 'employee-documents/[id].put.ts',
      'employees/[id]/documents.get.ts', 'employees/[id]/documents.post.ts', 'employees/[id]/payroll.get.ts',
      'employees/[id]/payroll.put.ts'])
    for (const route of touching) {
      const code = source(route)
      const payroll = route.includes('payroll')
      expect(permissionCalls(route), route).toEqual([{ key: payroll ? 'employees.payroll' : 'employees.view', options: '' }])
      // The facility of the request; the documents service gets the actor for the folder keys (employees.docs.*).
      expect(code, route).toContain(payroll ? '(useDb(), actor.facilityId, id' : '(useDb(), actor, actor.facilityId, id')
    }
    // Neither the Leitung nor a Mitarbeiter by default, nor the tablet (no allowTerminal).
    expect(DEFAULTS.admin.has('employees.payroll')).toBe(false)
    expect(DEFAULTS.observer.has('employees.view')).toBe(false)
    expect(DEFAULTS.admin.has('employees.docs.qualifications')).toBe(true)
    expect(source('employees/[id]/documents.post.ts')).toContain("assertUploadLength(getRequestHeader(event, 'content-length'))")
    expect(source('employee-documents/[id].delete.ts')).toContain('checkpointWal(useSqlite())')
    // The detail and its update decide the personnel file blocks by the session user's permissions.
    expect(source('employees/[id].get.ts')).toContain('viewer.permissions)')
    expect(source('employees/[id].put.ts')).toContain('admin.permissions, undefined, admin.employeeId)')
    // A PIN opens the tablet with the rights of the linked account: only the Leitung and the Träger, in the facility of
    // the request (checked first), and only for accounts they manage.
    for (const route of ['employees/[id]/pin.put.ts', 'employees/[id]/pin.delete.ts', 'employees/[id]/pin/unlock.post.ts']) {
      expect(source(route), route).toContain('assertPinManageable(useDb(), admin, admin.facilityId, id)')
    }
    // Nobody but the Träger changes the own stamping settings (they feed the credited time).
    expect(source('employees/[id]/stamping.put.ts')).toContain('admin.permissions, admin.employeeId)')
  })

  it('lets only the Träger change the absence codes', () => {
    const touching = routes.filter(route => /^absence-codes\//.test(route) || /\bupdateCode\b/.test(source(route)))
    expect(touching).toEqual(['absence-codes/[id].put.ts'])
    expect(source('absence-codes/[id].put.ts')).toContain("requirePermission(event, 'settings.absenceCodes'")
  })

  it('opens the monthly staffing report to managers of the active facility only', () => {
    const touching = routes.filter(route => source(route).includes('services/staffingReport\''))
    expect(touching).toEqual(['staffing/[year]/[month].get.ts'])
    const code = source('staffing/[year]/[month].get.ts')
    expect(code).toContain("requirePermission(event, 'plan.staffing')")
    expect(code).toContain('admin.facilityId')
  })

  it('opens the staffing estimate of the group settings to managers, in the facility of the request like the groups', () => {
    const touching = routes.filter(route => source(route).includes('services/staffingEstimate\''))
    expect(touching).toEqual(['staffing/estimate.get.ts', 'staffing/estimate/preview.get.ts'])
    for (const route of touching) {
      expect(permissionCalls(route), route).toEqual([{ key: 'settings.facility', options: '' }])
      expect(source(route), route).toContain('(useDb(), admin.facilityId')
      // „Aktuell“ (this month's Soll and the enrolled children) only with the key of the monthly tab.
      expect(source(route), route).toContain("{ withCurrent: can(admin.permissions, 'plan.staffing') }")
    }
    expect(DEFAULTS.observer.has('settings.facility')).toBe(false)
    expect(DEFAULTS.group_lead.has('settings.facility')).toBe(false)
  })

  it('opens the reminder settings to managers of the active facility only', () => {
    const touching = routes.filter(route => source(route).includes('services/reminderSettings\''))
    expect(touching).toEqual(['groups/[id]/documentation.put.ts', 'reminder-settings.get.ts', 'reminder-settings.put.ts'])
    for (const route of touching) {
      const code = source(route)
      expect(code, route).toContain("requirePermission(event, 'settings.facility')")
      expect(code, route).toContain('admin.facilityId')
    }
  })

  it('opens the tablet settings (lock time, windows without the automatic lock) to Leitung and Träger only, never the tablet', () => {
    const touching = routes.filter(route => source(route).includes('services/tabletSettings\''))
    expect(touching).toEqual(['tablet-settings.get.ts', 'tablet-settings.put.ts'])
    for (const route of touching) {
      expect(permissionCalls(route), route).toEqual([{ key: 'settings.facility', options: '' }])
      expect(source(route), route).toContain('admin.facilityId')
      expect(expanded(permissionActors('settings.facility', '')), route).toEqual(['provider', 'admin'])
    }
    expect(DEFAULTS.observer.has('settings.facility')).toBe(false)
    expect(DEFAULTS.group_lead.has('settings.facility')).toBe(false)
  })

  it('opens the markers for falling ill during duty to managers of the active facility only', () => {
    const touching = routes.filter(route => /sick-leave/i.test(route) || source(route).includes('services/earlySickLeaves\''))
    expect(touching).toEqual(['early-sick-leaves/[id].delete.ts', 'early-sick-leaves/index.get.ts', 'early-sick-leaves/index.put.ts'])
    for (const route of touching) {
      const code = source(route)
      expect(code, route).toContain("requirePermission(event, 'employees.sickness')")
      expect(code, route).toContain('admin.facilityId')
    }
  })

  it('opens the BEM to whoever has the sick days right, in the active facility, never about themselves; the text to managers', () => {
    const touching = routes.filter(route => /(^|\/)bem/.test(route) || source(route).includes('services/bem\''))
    expect(touching).toEqual([
      'bem-settings.get.ts', 'bem-settings.put.ts', 'bem-steps/[id].delete.ts', 'bem-steps/[id].put.ts', 'bem/[id].delete.ts',
      'bem/[id]/answer.put.ts', 'bem/[id]/clear-notes.post.ts', 'bem/[id]/complete.put.ts', 'bem/[id]/invitation.get.ts',
      'bem/[id]/sent.put.ts', 'bem/[id]/steps.post.ts', 'employees/[id]/bem.get.ts', 'employees/[id]/bem.post.ts',
    ])
    for (const route of touching) {
      const code = source(route)
      expect(code, route).toContain('admin.facilityId')
      expect(code, route).not.toMatch(/allowTerminal|facility: 'none'/)
      if (route.startsWith('bem-settings')) {
        expect(permissionCalls(route), route).toEqual([{ key: 'settings.facility', options: '' }])
        continue
      }
      // Health data: Leitung and Träger by default, never a Mitarbeiter or the tablet; never the viewer's own BEM.
      expect(permissionCalls(route), route).toEqual([{ key: 'employees.sickness', options: '' }])
      expect(code, route).toContain('ownEmployeeId: admin.employeeId')
      expect(fixture[route], route).toEqual(['provider', 'admin'])
    }
    expect(DEFAULTS.observer.has('employees.sickness')).toBe(false)
    expect(DEFAULTS.group_lead.has('employees.sickness')).toBe(false)
  })

  it('opens planned group changes to managers of the active facility only', () => {
    const touching = routes.filter(route => /group-change/i.test(route) || source(route).includes('services/childGroupChanges\''))
    expect(touching).toEqual(['child-group-changes/[id].delete.ts', 'child-group-changes/[id].put.ts', 'children/[id]/group-change.post.ts'])
    for (const route of touching) {
      const code = source(route)
      expect(CHILD_MANAGER_ROUTES, route).toContain(route)
      expect(code, route).toContain("requireChildPermission(event, 'children.manage')")
      expect(code, route).not.toMatch(/require(User|Permission|Terminal)\(/)
      expect(code, route).toContain('manager.facilityId')
    }
  })

  it('checks children.manage on exactly the child pages for managers', () => {
    const managing = routes.filter(route => source(route).includes("requireChildPermission(event, 'children.manage')"))
    expect(managing).toEqual([...CHILD_MANAGER_ROUTES].sort())
  })

  it('keeps the Träger move and the settings of child records away from the tablet', () => {
    expect(source('children/[id]/facility.put.ts')).toContain("requirePermission(event, 'children.moveFacility', { facility: 'none' })")
    for (const route of ['care-types/index.post.ts', 'care-types/[id].put.ts', 'care-types/[id].delete.ts',
      'document-types/index.post.ts', 'document-types/[id].put.ts', 'document-types/[id].delete.ts',
      'attendance-settings.get.ts', 'attendance-settings.put.ts', 'children/sort.get.ts', 'children/sort.put.ts']) {
      expect(source(route), route).toContain("requirePermission(event, 'settings.facility')")
    }
  })

  it('leaves the automatic leaving of school children, its preview and the group flag to the Träger', () => {
    const settings = ['school-settings/auto-leave-preview.get.ts', 'school-settings/auto-leave.put.ts']
    for (const route of [...settings, 'groups/[id]/school-children.put.ts']) {
      expect(source(route), route).toContain("requirePermission(event, 'children.schoolSettings'")
    }
    // The switch and its preview are those of the facility the Träger works in.
    for (const route of settings) {
      expect(source(route), route).toContain("requirePermission(event, 'children.schoolSettings')")
      expect(source(route), route).toContain('provider.facilityId')
    }
    // The preview and the daily run share one selection: the route must not build its own.
    expect(source('school-settings/auto-leave-preview.get.ts')).toContain('schoolLeavers(')
  })

  it('leaves the order of the groups to the Träger, in the facility they work in', () => {
    const code = source('groups/[id]/move.post.ts')
    expect(code).toContain("requirePermission(event, 'settings.groups')")
    expect(code).toContain('provider.facilityId')
  })

  it('leaves the age limits of a group to whoever edits the groups, shown to whoever sees the group settings', () => {
    const edit = source('groups/[id]/age-limits.put.ts')
    expect(edit).toContain("requirePermission(event, 'settings.groups')")
    expect(edit).toContain('provider.facilityId')
    const read = source('groups/[id]/age-limits.get.ts')
    expect(read).toContain("requirePermission(event, 'settings.facility')")
    expect(read).toContain('admin.facilityId')
    expect(fixture['groups/[id]/age-limits.put.ts']).toEqual(['provider'])
    expect(fixture['groups/[id]/age-limits.get.ts']).toEqual(['provider', 'admin'])
  })

  it('opens the list of the coming school children to managers of the active facility only', () => {
    const code = source('children/school-children.get.ts')
    expect(code).toContain("requireChildPermission(event, 'children.manage')")
    expect(code).not.toMatch(/require(User|Permission|Terminal)\(/)
    expect(code).toContain('manager.facilityId')
  })

  it('lets the tablet and Mitarbeiter open the print templates and their categories, but only managers change them', () => {
    const touching = routes.filter(route => /^(print-templates|template-categories)\//.test(route)
      || /services\/(printTemplates|templateCategories)'/.test(source(route)))
    expect(touching).toEqual(['print-templates/[id].delete.ts', 'print-templates/[id].put.ts', 'print-templates/[id]/file.get.ts',
      'print-templates/[id]/file.put.ts', 'print-templates/index.get.ts', 'print-templates/index.post.ts',
      'template-categories/[id].delete.ts', 'template-categories/[id].put.ts', 'template-categories/[id]/move.post.ts',
      'template-categories/index.get.ts', 'template-categories/index.post.ts'])
    const readers = ['print-templates/index.get.ts', 'print-templates/[id]/file.get.ts', 'template-categories/index.get.ts']
    for (const route of touching) {
      // The tablet without an unlock (blank forms, no child data), always in the active facility (no settings choice).
      expect(source(route), route).toContain(readers.includes(route)
        ? "requirePermission(event, 'printTemplates.view', { allowTerminal: true, facility: 'active' })"
        : "requirePermission(event, 'printTemplates.edit')")
    }
    // Since the template categories (a deliberate change): Mitarbeiter accounts read, never change.
    for (const route of touching) expect(fixture[route]!.includes('observer'), route).toBe(readers.includes(route))
  })

  it('keeps the tablet\'s unlock token in the server-only part of the session', () => {
    // Routes go through childUnlockToken( / storeChildUnlockToken( instead of touching the session field.
    for (const route of routes) expect(source(route), route).not.toMatch(/childUnlock(?!Token)/)
    const auth = readFileSync(join(process.cwd(), 'server', 'utils', 'auth.ts'), 'utf8')
    expect(auth).toContain('setUserSession(event, { secure: { childUnlock: token } })')
    expect(auth).toContain('.secure?.childUnlock')
  })

  it('keeps the permission set out of the session cookie and hands it to the browser only with the session answer', () => {
    expect(source('auth/login.post.ts')).toContain('sessionPayload(result.user)')
    expect(source('auth/password.post.ts')).toContain('sessionPayload(user)')
    const plugin = readFileSync(join(process.cwd(), 'server', 'plugins', 'sessionCheck.ts'), 'utf8')
    expect(plugin).toContain('Object.assign(session.user, sessionPayload(user))')
    // The client's copy (useCan): fresh on every GET /api/_auth/session, beside the user, never sealed (the hook only
    // changes the unsealed copy of that answer).
    expect(plugin).toContain('session.permissions = [...user.permissions]')
    expect(plugin).not.toMatch(/setUserSession|replaceUserSession/)
    // No route writes the permissions into the session.
    for (const route of routes) {
      const code = source(route)
      if (/setUserSession|replaceUserSession/.test(code)) expect(code, route).not.toContain('permissions')
    }
  })

  it('lets the tablet into the general plan, the team meetings, the notes (reading) and the print templates (with their categories) only', () => {
    const allowing = routes.filter(route => source(route).includes('allowTerminal: true'))
    expect(allowing).toEqual(['notes/index.get.ts', 'plan/[year]/[month].get.ts', 'print-templates/[id]/file.get.ts', 'print-templates/index.get.ts',
      'team-meetings/[id].get.ts', 'team-meetings/[id].put.ts', 'team-meetings/[id]/sign.post.ts', 'team-meetings/index.get.ts',
      'team-meetings/index.post.ts', 'template-categories/index.get.ts'])
  })

  it('takes the offline stamps from the tablet only, and keeps their review list to time.manage', () => {
    const sync = source('terminal/offline-stamps.post.ts')
    expect(sync).toContain('requireTerminal(event)')
    expect(sync).toContain('terminal.facilityId')
    expect(fixture['terminal/offline-stamps.post.ts']).toEqual(['terminal'])
    for (const route of ['time-records/offline-stamps/index.get.ts', 'time-records/offline-stamps/[id]/checked.post.ts']) {
      expect(permissionCalls(route), route).toEqual([{ key: 'time.manage', options: '' }])
      expect(source(route), route).toContain('admin.facilityId')
      expect(fixture[route], route).toEqual(['provider', 'admin'])
    }
  })
})
