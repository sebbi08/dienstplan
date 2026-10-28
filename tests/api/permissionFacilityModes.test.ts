import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { login, sessionPayload } from '../../server/services/auth'
import type { SessionUser } from '../../shared/types/api'
import { addUser, createTestDb, TEST_PASSWORD } from '../helpers/fixtures'

/**
 * The facility mode of every requirePermission, pinned (Rechte und Rollen Teil 1): the actor comparison against
 * route-access-before.json cannot see a change between 'request', 'active' and 'none'. Every route not listed here
 * works in the facility of the request (the default, as requireAdmin and requireProvider + requireFacility did).
 */

/** Always the active facility, no settings choice: was requireAdmin({ activeFacility }) / requireTemplateReader, and the
 * team meeting members (the result of requireFacility was not used). */
const ACTIVE = [
  'facilities.get.ts',
  'print-templates/[id]/file.get.ts', 'print-templates/index.get.ts',
  'team-meetings/[id].get.ts', 'team-meetings/[id].put.ts', 'team-meetings/index.get.ts', 'team-meetings/index.post.ts',
]
/** No facility: was requireProvider alone (the route names its facility or works across all of them). */
const NONE = [
  'absence-codes/[id].put.ts', 'backup.get.ts', 'child-retention.get.ts', 'child-retention.put.ts',
  'children/[id]/facility.put.ts', 'contract-visibility.put.ts', 'employees/[id]/facility.put.ts', 'facilities.post.ts',
  'facilities/[id].put.ts', 'facilities/[id]/capacity.put.ts', 'facilities/[id]/group-read-access.get.ts',
  'facilities/[id]/groups.get.ts', 'facilities/[id]/groups.post.ts', 'facilities/active.put.ts', 'groups/[id].delete.ts',
  'groups/[id].put.ts', 'groups/[id]/school-children.put.ts', 'leave-settings/module.put.ts', 'retention/due.post.ts',
  'retention/index.get.ts', 'retention/items.delete.ts',
]

const API_DIR = join(process.cwd(), 'server', 'api')
const routes = (readdirSync(API_DIR, { recursive: true }) as string[])
  .map(file => relative(API_DIR, join(API_DIR, file)).split(sep).join('/'))
  .filter(file => file.endsWith('.ts'))
  .sort()

/** The facility option of the route's requirePermission ('request' when none is given), null without one. */
function facilityMode(route: string): string | null {
  const call = /requirePermission\(event, '[^']+'(?:, (\{[^}]*\}))?\)/.exec(readFileSync(join(API_DIR, route), 'utf8'))
  if (!call) return null
  return /facility: '(\w+)'/.exec(call[1] ?? '')?.[1] ?? 'request'
}

describe('facility modes of the permission checks', () => {
  it('uses the active facility on exactly the pinned routes', () => {
    expect(routes.filter(route => facilityMode(route) === 'active')).toEqual([...ACTIVE].sort())
  })

  it('works without a facility on exactly the pinned routes', () => {
    expect(routes.filter(route => facilityMode(route) === 'none')).toEqual([...NONE].sort())
  })

  it('names no other facility mode', () => {
    for (const route of routes) expect([null, 'request', 'active', 'none'], route).toContain(facilityMode(route))
  })
})

describe('the session payload', () => {
  it('carries the user without the permission set, for the cookie and the browser', () => {
    const db = createTestDb()
    const leitung = addUser(db, 'leitung', 'admin')
    const result = login(db, 'leitung', TEST_PASSWORD)
    expect(result.ok).toBe(true)
    const user = (result as { ok: true; user: SessionUser }).user
    // The server side has the set …
    expect(user.permissions.has('plan.edit')).toBe(true)
    // … the payload (what login.post, password.post and sessionCheck hand to the session) has not.
    const payload = sessionPayload(user)
    expect(payload).not.toHaveProperty('permissions')
    expect(payload).toEqual({
      id: leitung.id, username: 'leitung', role: 'admin', employeeId: null, mustChangePassword: false,
      canEditChildren: false, facilityId: 1,
    })
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload)
    // The user object itself keeps its set.
    expect(user.permissions.size).toBeGreaterThan(0)
  })

  it('is what the session routes and the session check use', () => {
    const read = (path: string) => readFileSync(join(process.cwd(), 'server', path), 'utf8')
    expect(read('api/auth/login.post.ts')).toContain('sessionPayload(result.user)')
    expect(read('api/auth/password.post.ts')).toContain('sessionPayload(user)')
    expect(read('plugins/sessionCheck.ts')).toContain('Object.assign(session.user, sessionPayload(user))')
  })
})
