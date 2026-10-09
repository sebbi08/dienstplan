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
]
/** Routes only the shared stamp tablet may call; they must check with requireTerminal(. */
const TERMINAL_ROUTES = ['terminal/status.get.ts', 'terminal/stamp.post.ts']
/** Routes only the Träger (provider) may call; they must check with requireProvider(. */
const PROVIDER_ROUTES = [
  'employees/[id]/contract.put.ts', 'contract-visibility.put.ts', 'backup.get.ts', 'leave-settings/module.put.ts',
  'facilities.post.ts', 'facilities/[id].put.ts', 'facilities/active.put.ts', 'employees/[id]/facility.put.ts',
  'facilities/[id]/groups.get.ts', 'facilities/[id]/groups.post.ts', 'groups/[id].put.ts', 'groups/[id].delete.ts',
]
/** Some of the routes for the Leitung (and the Träger) of the active facility; every unlisted route must check with requireAdmin(. */
const ADMIN_ROUTES = ['help-outs/candidates.get.ts', 'help-outs/index.post.ts', 'help-outs/[id].delete.ts', 'groups.get.ts']
/** Routes anyone who may see child records can call (Träger, Leitung, Mitarbeiter; not the tablet); they must check with requireChildReader(. */
const CHILD_READER_ROUTES: string[] = []
/** Routes that maintain child records (managers and Mitarbeiter with the permission); they must check with requireChildEditor(. */
const CHILD_EDITOR_ROUTES: string[] = []
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

  it('lets the tablet into the general plan only', () => {
    const allowing = routes.filter(route => source(route).includes('allowTerminal: true'))
    expect(allowing).toEqual(['plan/[year]/[month].get.ts'])
  })
})
