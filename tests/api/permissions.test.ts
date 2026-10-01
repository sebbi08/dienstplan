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
]
/** Routes only the shared stamp tablet may call; they must check with requireTerminal(. */
const TERMINAL_ROUTES = ['terminal/status.get.ts', 'terminal/stamp.post.ts']
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
    for (const route of [...USER_ROUTES, ...TERMINAL_ROUTES, ...PUBLIC_ROUTES]) expect(routes).toContain(route)
  })

  it.each(routes)('%s is protected as classified', (route) => {
    const code = source(route)
    if (PUBLIC_ROUTES.includes(route)) {
      expect(code).not.toMatch(/require(Admin|User|Terminal)\(/)
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
