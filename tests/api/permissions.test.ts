import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const API_DIR = join(process.cwd(), 'server', 'api')

/** Routes any signed-in user (admin or observer) may call; they must check with requireUser(. */
const USER_ROUTES = [
  'auth/password.post.ts',
  'plan/[year]/[month].get.ts',
  'my/plan/[year]/[month].get.ts',
  'my/leave.get.ts',
  'my/time.get.ts',
  'my/time/stamp.post.ts',
  'my/notifications.get.ts',
  'my/notifications/read.post.ts',
  'leave-settings.get.ts',
  'my/leave-requests.get.ts',
  'my/leave-requests.post.ts',
  'my/leave-requests/preview.get.ts',
  'my/leave-requests/[id]/withdraw.post.ts',
  'pdf.get.ts',
  'my/calendar.get.ts',
  'my/requirements.get.ts',
]
/** Routes only the shared stamp tablet may call; they must check with requireTerminal(. */
const TERMINAL_ROUTES = [
  'terminal/status.get.ts', 'terminal/stamp.post.ts', 'terminal/children/unlock.post.ts', 'terminal/children/lock.post.ts',
  'terminal/children/keep-alive.post.ts', 'terminal/children/status.get.ts',
]
/** Routes only the Träger (provider) may call; they must check with requireProvider(. */
const PROVIDER_ROUTES = [
  'employees/[id]/contract.put.ts', 'contract-visibility.put.ts', 'backup.get.ts', 'leave-settings/module.put.ts',
  'facilities.post.ts', 'facilities/[id].put.ts', 'facilities/active.put.ts', 'employees/[id]/facility.put.ts',
  'facilities/[id]/groups.get.ts', 'facilities/[id]/groups.post.ts', 'groups/[id].put.ts', 'groups/[id].delete.ts',
  'facilities/[id]/group-read-access.get.ts', 'children/[id]/facility.put.ts', 'child-retention.get.ts', 'child-retention.put.ts',
  'child-retention/preview.get.ts', 'school-settings.put.ts',
  'school-settings/auto-leave.put.ts', 'school-settings/auto-leave-preview.get.ts', 'groups/[id]/school-children.put.ts',
]
/** Some of the routes for the Leitung (and the Träger) of the active facility; every unlisted route must check with requireAdmin(. */
const ADMIN_ROUTES = [
  'help-outs/candidates.get.ts', 'help-outs/index.post.ts', 'help-outs/[id].delete.ts', 'groups.get.ts',
  'requirement-types.get.ts', 'requirement-types.post.ts', 'requirement-types/[id].put.ts', 'requirement-types/[id].delete.ts',
  'requirements/due.get.ts', 'employees/[id]/requirements.get.ts', 'employees/[id]/requirements.post.ts',
  'employee-requirements/[id].delete.ts', 'employees/[id]/trainings.post.ts', 'employee-trainings/[id].put.ts',
  'employee-trainings/[id].delete.ts',
  'early-sick-leaves/index.get.ts', 'early-sick-leaves/index.put.ts', 'early-sick-leaves/[id].delete.ts',
  'meals/index.get.ts', 'meals/index.post.ts', 'meals/[id].put.ts', 'meals/[id].delete.ts', 'meals/versions/[id].delete.ts',
]
/**
 * Routes anyone who looks at child records can call (Träger and Leitung with their account, the person who unlocked the
 * tablet; never a Mitarbeiter account); they must check with requireChildReader(.
 */
const CHILD_READER_ROUTES = [
  'care-types/index.get.ts', 'document-types/index.get.ts', 'children/index.get.ts', 'children/planned.get.ts', 'children/birthdays.get.ts', 'children/groups.get.ts',
  'children/open.get.ts', 'children/staff.get.ts', 'children/school-cutoff.get.ts', 'children/[id].get.ts', 'child-documents/[id]/file.get.ts', 'child-documents/overview.get.ts',
  // Attendance: every child viewer reads and writes it (spec Anwesenheit §7).
  'attendance/day.get.ts', 'attendance/arrive.post.ts', 'attendance/leave.post.ts', 'attendance/announcements/index.post.ts',
  'attendance/announcements/[id].delete.ts', 'attendance/absence.put.ts', 'attendance/day.put.ts', 'attendance/stays/[id].put.ts',
  'attendance/stays/[id].delete.ts', 'attendance/history.get.ts', 'attendance/month.get.ts', 'attendance/month-remark.put.ts',
  // Weekly overview of the group books: the service decides per group who reads and who writes.
  'group-book/week.get.ts', 'group-book/week.put.ts', 'group-book/day.put.ts', 'group-book/history.get.ts',
]
/**
 * Routes that maintain child records (managers, and at the tablet Mitarbeiter with the permission); they must check
 * with requireChildEditor(.
 */
const CHILD_EDITOR_ROUTES = [
  'children/index.post.ts', 'children/[id]/master.put.ts', 'children/[id]/health.put.ts',
  'children/[id]/consents.put.ts', 'children/[id]/confirm.post.ts', 'children/[id]/contacts.post.ts', 'children/[id]/contacts/order.post.ts',
  'child-contacts/[id].put.ts', 'child-contacts/[id].delete.ts',
  'children/[id]/documents.post.ts', 'child-documents/[id].put.ts', 'child-documents/[id].delete.ts',
]
/**
 * The child pages for Träger and Leitung only, at the office or at the unlocked tablet; they must check with
 * requireChildManager(.
 */
const CHILD_MANAGER_ROUTES = [
  'children/[id].delete.ts', 'children/archive.get.ts', 'children/occupancy.get.ts', 'children/school-children.get.ts',
  'children/[id]/group-change.post.ts', 'child-group-changes/[id].put.ts', 'child-group-changes/[id].delete.ts',
  'children/[id]/leave.post.ts', 'children/[id]/unleave.post.ts',
]
/** Routes that need no session at all. */
const PUBLIC_ROUTES = ['health.get.ts', 'auth/login.post.ts']

const routes = (readdirSync(API_DIR, { recursive: true }) as string[])
  .map(file => relative(API_DIR, join(API_DIR, file)).split(sep).join('/'))
  .filter(file => file.endsWith('.ts'))
  .sort()

function source(route: string): string {
  return readFileSync(join(API_DIR, route), 'utf8')
}

describe('API route permissions', () => {
  it('finds the API routes', () => {
    expect(routes.length).toBeGreaterThan(30)
    const others = [
      ...USER_ROUTES, ...TERMINAL_ROUTES, ...PROVIDER_ROUTES, ...CHILD_READER_ROUTES, ...CHILD_EDITOR_ROUTES,
      ...CHILD_MANAGER_ROUTES, ...PUBLIC_ROUTES,
    ]
    for (const route of others) expect(routes).toContain(route)
    for (const route of ADMIN_ROUTES) {
      expect(routes).toContain(route)
      expect(others).not.toContain(route)
    }
  })

  it.each(routes)('%s is protected as classified', (route) => {
    const code = source(route)
    if (PUBLIC_ROUTES.includes(route)) {
      expect(code).not.toMatch(/require(Admin|User|Terminal|Provider|ChildReader|ChildEditor|ChildManager)\(/)
    }
    else if (CHILD_READER_ROUTES.includes(route)) {
      expect(code).toContain('requireChildReader(')
    }
    else if (CHILD_EDITOR_ROUTES.includes(route)) {
      expect(code).toContain('requireChildEditor(')
    }
    else if (CHILD_MANAGER_ROUTES.includes(route)) {
      expect(code).toContain('requireChildManager(')
    }
    else if (PROVIDER_ROUTES.includes(route)) {
      expect(code).toContain('requireProvider(')
    }
    else if (TERMINAL_ROUTES.includes(route)) {
      expect(code).toContain('requireTerminal(')
    }
    else if (USER_ROUTES.includes(route)) {
      expect(code).toContain('requireUser(')
    }
    else {
      expect(code, 'new routes must call requireAdmin( or be added to the allowlists').toContain('requireAdmin(')
    }
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
        expect(ADMIN_ROUTES, route).toContain(route)
        expect(code, route).toContain('requireAdmin(')
        expect(code, route).not.toMatch(/require(User|Provider|Terminal)\(/)
        expect(code, route).toContain('.facilityId')
      }
    }
  })

  it('opens the meal settings to managers of the active facility only', () => {
    const touching = routes.filter(route => /^meals\//.test(route) || source(route).includes('services/meals\''))
    expect(touching).toEqual(['meals/[id].delete.ts', 'meals/[id].put.ts', 'meals/index.get.ts', 'meals/index.post.ts',
      'meals/versions/[id].delete.ts'])
    for (const route of touching) {
      const code = source(route)
      expect(ADMIN_ROUTES, route).toContain(route)
      expect(code, route).toContain('requireAdmin(')
      expect(code, route).not.toMatch(/require(User|Provider|Terminal|ChildReader|ChildEditor|ChildManager)\(/)
      expect(code, route).toContain('admin.facilityId')
    }
  })

  it('opens the markers for falling ill during duty to managers of the active facility only', () => {
    const touching = routes.filter(route => /sick-leave/i.test(route) || source(route).includes('services/earlySickLeaves\''))
    expect(touching).toEqual(['early-sick-leaves/[id].delete.ts', 'early-sick-leaves/index.get.ts', 'early-sick-leaves/index.put.ts'])
    for (const route of touching) {
      const code = source(route)
      expect(ADMIN_ROUTES, route).toContain(route)
      expect(code, route).toContain('requireAdmin(')
      expect(code, route).not.toMatch(/require(User|Provider|Terminal)\(/)
      expect(code, route).toContain('admin.facilityId')
    }
  })

  it('opens planned group changes to managers of the active facility only', () => {
    const touching = routes.filter(route => /group-change/i.test(route) || source(route).includes('services/childGroupChanges\''))
    expect(touching).toEqual(['child-group-changes/[id].delete.ts', 'child-group-changes/[id].put.ts', 'children/[id]/group-change.post.ts'])
    for (const route of touching) {
      const code = source(route)
      expect(CHILD_MANAGER_ROUTES, route).toContain(route)
      expect(code, route).toContain('requireChildManager(')
      expect(code, route).not.toMatch(/require(User|Admin|Provider|Terminal|ChildReader|ChildEditor)\(/)
      expect(code, route).toContain('manager.facilityId')
    }
  })

  it('checks with requireChildManager( on exactly the child pages for managers', () => {
    const managing = routes.filter(route => source(route).includes('requireChildManager('))
    expect(managing).toEqual([...CHILD_MANAGER_ROUTES].sort())
    for (const route of CHILD_MANAGER_ROUTES) {
      expect(source(route), route).not.toMatch(/require(User|Admin|Provider|Terminal|ChildReader|ChildEditor)\(/)
    }
  })

  it('keeps the Träger move and the settings of child records away from the tablet', () => {
    for (const route of ['children/[id]/facility.put.ts', 'child-retention/preview.get.ts']) {
      expect(source(route), route).toContain('requireProvider(')
    }
    for (const route of ['care-types/index.post.ts', 'care-types/[id].put.ts', 'care-types/[id].delete.ts',
      'document-types/index.post.ts', 'document-types/[id].put.ts', 'document-types/[id].delete.ts',
      'attendance-settings.get.ts', 'attendance-settings.put.ts']) {
      expect(source(route), route).toContain('requireAdmin(')
    }
  })

  it('leaves the automatic leaving of school children, its preview and the group flag to the Träger', () => {
    const settings = ['school-settings/auto-leave-preview.get.ts', 'school-settings/auto-leave.put.ts']
    for (const route of [...settings, 'groups/[id]/school-children.put.ts']) {
      const code = source(route)
      expect(PROVIDER_ROUTES, route).toContain(route)
      expect(code, route).toContain('requireProvider(')
      expect(code, route).not.toMatch(/require(User|Admin|Terminal|ChildReader|ChildEditor)\(/)
    }
    // The switch and its preview are those of the facility the Träger works in.
    for (const route of settings) expect(source(route), route).toContain('requireFacility(event, provider)')
    // The preview and the daily run share one selection: the route must not build its own.
    expect(source('school-settings/auto-leave-preview.get.ts')).toContain('schoolLeavers(')
  })

  it('opens the list of the coming school children to managers of the active facility only', () => {
    const code = source('children/school-children.get.ts')
    expect(code).toContain('requireChildManager(')
    expect(code).not.toMatch(/require(User|Admin|Provider|Terminal|ChildReader|ChildEditor)\(/)
    expect(code).toContain('manager.facilityId')
  })

  it('keeps the tablet\'s unlock token in the server-only part of the session', () => {
    // Routes go through childUnlockToken( / storeChildUnlockToken( instead of touching the session field.
    for (const route of routes) expect(source(route), route).not.toMatch(/childUnlock(?!Token)/)
    const auth = readFileSync(join(process.cwd(), 'server', 'utils', 'auth.ts'), 'utf8')
    expect(auth).toContain('setUserSession(event, { secure: { childUnlock: token } })')
    expect(auth).toContain('.secure?.childUnlock')
  })

  it('lets the tablet into the general plan only', () => {
    const allowing = routes.filter(route => source(route).includes('allowTerminal: true'))
    expect(allowing).toEqual(['plan/[year]/[month].get.ts'])
  })
})
