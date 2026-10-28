import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHILD_ACTOR_KEYS } from '../../server/lib/childViewer'
import { effectivePermissions, PERMISSION_KEYS, PERMISSIONS, type PermissionKey } from '../../shared/domain/permissions'

const API_DIR = join(process.cwd(), 'server', 'api')

/**
 * Every route checks one permission (`requirePermission(event, '<key>'`, on the child pages
 * `requireChildPermission(event, '<key>')`), or keeps one of the fixed guards below. Who gets in under the role defaults
 * (at the tablet: the unlocking person's) must equal who got in before the switch (tests/fixtures/route-access-before.json,
 * frozen from the old role guards; Rechte und Rollen Teil 1, review focus 1).
 */

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
  // Renders a print page with the caller's cookie; that page's API calls check the permissions.
  'pdf.get.ts',
  'my/calendar.get.ts',
  'my/requirements.get.ts',
  // The employee's own staff talks (spec Bögen §3): only their own, only released forms.
  'my/talks/index.get.ts', 'my/talks/forms/[formId].get.ts', 'my/talks/forms/[formId].put.ts',
  'my/talks/forms/[formId]/submit.post.ts',
]
/** Fixed: only the shared stamp tablet, checked with requireTerminal(. */
const TERMINAL_ROUTES = [
  'terminal/status.get.ts', 'terminal/stamp.post.ts', 'terminal/children/unlock.post.ts', 'terminal/children/lock.post.ts',
  'terminal/children/keep-alive.post.ts', 'terminal/children/status.get.ts',
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
]
/**
 * children.attendance: attendance (every child viewer writes it, spec Anwesenheit §7), the group books and the
 * development documentation's done/undo; the service decides by the group rights (spec Erinnerungen §2.3).
 */
const CHILD_ATTENDANCE_ROUTES = [
  'attendance/arrive.post.ts', 'attendance/leave.post.ts', 'attendance/announcements/index.post.ts',
  'attendance/announcements/[id].delete.ts', 'attendance/absence.put.ts', 'attendance/day.put.ts', 'attendance/stays/[id].put.ts',
  'attendance/stays/[id].delete.ts', 'attendance/month-remark.put.ts',
  'group-book/week.put.ts', 'group-book/day.put.ts',
  'children/[id]/development-docs.post.ts', 'children/development-docs/[id].delete.ts',
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
  'children/[id]/leave.post.ts', 'children/[id]/unleave.post.ts',
]
/** Each child route with the one permission it checks. */
const CHILD_ROUTES: Record<string, PermissionKey> = Object.fromEntries([
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

const ACTORS = ['anonymous', 'provider', 'admin', 'observer', 'terminal', 'tablet:provider', 'tablet:admin',
  'tablet:observerEditor', 'tablet:observer', 'tablet:noAccount']
const TABLET_PEOPLE = ACTORS.filter(actor => actor.startsWith('tablet:'))

const plain = { canEditChildren: false, isLeavePlanner: false, contractVisibleToAdmins: false }
const DEFAULTS = {
  admin: effectivePermissions({ role: 'admin', ...plain }),
  observer: effectivePermissions({ role: 'observer', ...plain }),
}
/** The unlocking person's permissions at the tablet; a person without account has the Mitarbeiter defaults. */
const TABLET_PERMISSIONS: Record<string, ReadonlySet<PermissionKey>> = {
  'tablet:provider': new Set(PERMISSION_KEYS),
  'tablet:admin': DEFAULTS.admin,
  'tablet:observerEditor': effectivePermissions({ role: 'observer', ...plain, canEditChildren: true }),
  'tablet:observer': DEFAULTS.observer,
  'tablet:noAccount': DEFAULTS.observer,
}
const PROVIDER_ONLY = new Set(PERMISSIONS.filter(permission => permission.providerOnly).map(permission => permission.key))

const OLD_GUARDS = /require(Admin|Provider|TemplateReader|ChildReader|ChildEditor|ChildManager)\(/
const PERMISSION_CALL = /requirePermission\(event, '([^']+)'(?:, (\{[^}]*\}))?\)/g
const CHILD_PERMISSION_CALL = /requireChildPermission\(event, '([^']+)'\)/g

const routes = (readdirSync(API_DIR, { recursive: true }) as string[])
  .map(file => relative(API_DIR, join(API_DIR, file)).split(sep).join('/'))
  .filter(file => file.endsWith('.ts'))
  .sort()
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
  const actors = ['provider']
  if (DEFAULTS.admin.has(key)) actors.push('admin')
  if (DEFAULTS.observer.has(key)) actors.push('observer')
  if (/allowTerminal: true/.test(options)) actors.push('terminal')
  return actors
}

/**
 * Who passes `requireChildPermission(event, key)` under the role defaults: an account with children.ownAccount and
 * the key, the tablet unlocked by a person with the key; the keys that change records also need an account.
 */
function childPermissionActors(key: PermissionKey): string[] {
  const office = ['provider', ...(['admin', 'observer'] as const)
    .filter(role => DEFAULTS[role].has('children.ownAccount') && DEFAULTS[role].has(key))]
  const needsAccount = (CHILD_ACTOR_KEYS as readonly PermissionKey[]).includes(key)
  return [...office, ...TABLET_PEOPLE.filter(actor => TABLET_PERMISSIONS[actor]!.has(key)
    && !(needsAccount && actor === 'tablet:noAccount'))]
}

/** Who passes the fixed guards. */
function guardActors(route: string): string[] {
  if (PUBLIC_ROUTES.includes(route)) return ['anonymous', 'provider', 'admin', 'observer', 'terminal']
  if (TERMINAL_ROUTES.includes(route)) return ['terminal']
  if (USER_ROUTES.includes(route)) return ['provider', 'admin', 'observer']
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
    const childLists = [CHILD_VIEW_ROUTES, CHILD_ATTENDANCE_ROUTES, CHILD_EDITOR_ROUTES, CHILD_MANAGER_ROUTES].flat()
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
      ...['capacityWarnings', 'childAttendance', 'childContacts', 'childDocuments', 'childForms', 'childGroupChanges',
        'children', 'groupBook', 'groups', 'parentMeetings', 'reminders', 'tabletUnlock']
        .map(name => `server/services/${name}.ts`)]
    for (const file of files) {
      const code = readFileSync(join(process.cwd(), file), 'utf8')
      expect(code, file).not.toMatch(/\bisManager\(|\bmayEditChildren\(|\b(viewer|actor|reader|editor|manager)\.role\b|rolePermissions\(/)
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

  it('lets the Leitung read how 24 and 31 December count as leave; only the Träger changes it (Leitung 403)', () => {
    expect(permissionCalls('leave-counting.get.ts')).toEqual([{ key: 'settings.facility', options: '' }])
    expect(permissionCalls('leave-counting.put.ts')).toEqual([{ key: 'leave.configure', options: '' }])
    expect(PROVIDER_ONLY.has('leave.configure')).toBe(true)
    expect(fixture['leave-counting.get.ts']).toEqual(['provider', 'admin'])
    expect(fixture['leave-counting.put.ts']).toEqual(['provider'])
    // The facility of the request: for the Träger on the settings pages the one „Einstellungen für“ names.
    expect(source('leave-counting.put.ts')).toContain('provider.facilityId')
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
      // Reopening a closed month and purging an archived box are the Träger's (spec Kasse §6, Löschfristen §4).
      expect(code, route).toContain(['cash.reopen', 'cash.purge'].includes(call!.key) ? 'provider.facilityId' : 'admin.facilityId')
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
      'team-meetings/[id]/release.post.ts', 'team-meetings/[id]/reopen.post.ts', 'team-meetings/index.get.ts',
      'team-meetings/index.post.ts'])
    const members = ['team-meetings/index.get.ts', 'team-meetings/index.post.ts', 'team-meetings/[id].get.ts',
      'team-meetings/[id].put.ts']
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

  it('lets managers of the active facility delete a left employee for good', () => {
    const touching = routes.filter(route => source(route).includes('services/employeeDeletion\''))
    expect(touching).toEqual(['employees/[id].delete.ts'])
    const code = source('employees/[id].delete.ts')
    expect(code).toContain("requirePermission(event, 'employees.delete')")
    expect(code).toContain('deleteLeftEmployee(useDb(), admin, admin.facilityId, id, confirm)')
    // The name is personal data: only from the body, never the URL (logs).
    expect(code).not.toContain('getQuery(')
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

  it('opens the reminder settings to managers of the active facility only', () => {
    const touching = routes.filter(route => source(route).includes('services/reminderSettings\''))
    expect(touching).toEqual(['groups/[id]/documentation.put.ts', 'reminder-settings.get.ts', 'reminder-settings.put.ts'])
    for (const route of touching) {
      const code = source(route)
      expect(code, route).toContain("requirePermission(event, 'settings.facility')")
      expect(code, route).toContain('admin.facilityId')
    }
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
      'attendance-settings.get.ts', 'attendance-settings.put.ts']) {
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

  it('opens the list of the coming school children to managers of the active facility only', () => {
    const code = source('children/school-children.get.ts')
    expect(code).toContain("requireChildPermission(event, 'children.manage')")
    expect(code).not.toMatch(/require(User|Permission|Terminal)\(/)
    expect(code).toContain('manager.facilityId')
  })

  it('lets the tablet open the print templates, but only managers of the active facility change them', () => {
    const touching = routes.filter(route => /^print-templates\//.test(route) || source(route).includes('services/printTemplates\''))
    expect(touching).toEqual(['print-templates/[id].delete.ts', 'print-templates/[id].put.ts', 'print-templates/[id]/file.get.ts',
      'print-templates/[id]/file.put.ts', 'print-templates/index.get.ts', 'print-templates/index.post.ts'])
    const readers = ['print-templates/index.get.ts', 'print-templates/[id]/file.get.ts']
    for (const route of touching) {
      // The tablet without an unlock (blank forms, no child data), always in the active facility (no settings choice).
      expect(source(route), route).toContain(readers.includes(route)
        ? "requirePermission(event, 'printTemplates.view', { allowTerminal: true, facility: 'active' })"
        : "requirePermission(event, 'printTemplates.edit')")
    }
  })

  it('keeps the tablet\'s unlock token in the server-only part of the session', () => {
    // Routes go through childUnlockToken( / storeChildUnlockToken( instead of touching the session field.
    for (const route of routes) expect(source(route), route).not.toMatch(/childUnlock(?!Token)/)
    const auth = readFileSync(join(process.cwd(), 'server', 'utils', 'auth.ts'), 'utf8')
    expect(auth).toContain('setUserSession(event, { secure: { childUnlock: token } })')
    expect(auth).toContain('.secure?.childUnlock')
  })

  it('keeps the permission set out of the session cookie and the session the browser gets', () => {
    expect(source('auth/login.post.ts')).toContain('sessionPayload(result.user)')
    expect(source('auth/password.post.ts')).toContain('sessionPayload(user)')
    const plugin = readFileSync(join(process.cwd(), 'server', 'plugins', 'sessionCheck.ts'), 'utf8')
    expect(plugin).toContain('Object.assign(session.user, sessionPayload(user))')
  })

  it('lets the tablet into the general plan, the team meetings and the print templates only', () => {
    const allowing = routes.filter(route => source(route).includes('allowTerminal: true'))
    expect(allowing).toEqual(['plan/[year]/[month].get.ts', 'print-templates/[id]/file.get.ts', 'print-templates/index.get.ts',
      'team-meetings/[id].get.ts', 'team-meetings/[id].put.ts', 'team-meetings/index.get.ts', 'team-meetings/index.post.ts'])
  })
})
