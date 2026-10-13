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
const TERMINAL_ROUTES = ['terminal/status.get.ts', 'terminal/stamp.post.ts']
/** Routes only the Träger (provider) may call; they must check with requireProvider(. */
const PROVIDER_ROUTES = [
  'employees/[id]/contract.put.ts', 'contract-visibility.put.ts', 'backup.get.ts', 'leave-settings/module.put.ts',
  'facilities.post.ts', 'facilities/[id].put.ts', 'facilities/active.put.ts', 'employees/[id]/facility.put.ts',
  'facilities/[id]/groups.get.ts', 'facilities/[id]/groups.post.ts', 'groups/[id].put.ts', 'groups/[id].delete.ts',
  'children/[id]/facility.put.ts', 'child-retention.get.ts', 'child-retention.put.ts',
  'child-retention/preview.get.ts',
]
/** Some of the routes for the Leitung (and the Träger) of the active facility; every unlisted route must check with requireAdmin(. */
const ADMIN_ROUTES = [
  'help-outs/candidates.get.ts', 'help-outs/index.post.ts', 'help-outs/[id].delete.ts', 'groups.get.ts',
  'requirement-types.get.ts', 'requirement-types.post.ts', 'requirement-types/[id].put.ts', 'requirement-types/[id].delete.ts',
  'requirements/due.get.ts', 'employees/[id]/requirements.get.ts', 'employees/[id]/requirements.post.ts',
  'employee-requirements/[id].delete.ts', 'employees/[id]/trainings.post.ts', 'employee-trainings/[id].put.ts',
  'employee-trainings/[id].delete.ts',
  'early-sick-leaves/index.get.ts', 'early-sick-leaves/index.put.ts', 'early-sick-leaves/[id].delete.ts',
]
/** Routes anyone who may see child records can call (Träger, Leitung, Mitarbeiter; not the tablet); they must check with requireChildReader(. */
const CHILD_READER_ROUTES = [
  'care-types/index.get.ts', 'document-types/index.get.ts', 'children/index.get.ts', 'children/birthdays.get.ts', 'children/groups.get.ts',
  'children/staff.get.ts', 'children/[id].get.ts', 'child-documents/[id]/file.get.ts', 'child-documents/overview.get.ts',
]
/** Routes that maintain child records (managers and Mitarbeiter with the permission); they must check with requireChildEditor(. */
const CHILD_EDITOR_ROUTES = [
  'children/index.post.ts', 'children/[id]/master.put.ts', 'children/[id]/health.put.ts',
  'children/[id]/consents.put.ts', 'children/[id]/contacts.post.ts', 'children/[id]/contacts/order.post.ts',
  'child-contacts/[id].put.ts', 'child-contacts/[id].delete.ts',
  'children/[id]/documents.post.ts', 'child-documents/[id].put.ts', 'child-documents/[id].delete.ts',
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
    const others = [...USER_ROUTES, ...TERMINAL_ROUTES, ...PROVIDER_ROUTES, ...CHILD_READER_ROUTES, ...CHILD_EDITOR_ROUTES, ...PUBLIC_ROUTES]
    for (const route of others) expect(routes).toContain(route)
    for (const route of ADMIN_ROUTES) {
      expect(routes).toContain(route)
      expect(others).not.toContain(route)
    }
  })

  it.each(routes)('%s is protected as classified', (route) => {
    const code = source(route)
    if (PUBLIC_ROUTES.includes(route)) {
      expect(code).not.toMatch(/require(Admin|User|Terminal|Provider|ChildReader|ChildEditor)\(/)
    }
    else if (CHILD_READER_ROUTES.includes(route)) {
      expect(code).toContain('requireChildReader(')
    }
    else if (CHILD_EDITOR_ROUTES.includes(route)) {
      expect(code).toContain('requireChildEditor(')
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

  it('lets the tablet into the general plan only', () => {
    const allowing = routes.filter(route => source(route).includes('allowTerminal: true'))
    expect(allowing).toEqual(['plan/[year]/[month].get.ts'])
  })
})
