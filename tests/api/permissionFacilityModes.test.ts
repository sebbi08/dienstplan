import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { routeFiles } from '../../scripts/route-access-snapshot.mjs'
import { login, sessionPayload } from '../../server/services/auth'
import type { SessionUser } from '../../shared/types/api'
import { addUser, createTestDb, TEST_PASSWORD } from '../helpers/fixtures'

/**
 * The facility mode of every requirePermission, pinned (Rechte und Rollen Teil 1): the actor comparison against
 * route-access-before.json cannot see a change between 'request', 'active' and 'none'. Every route not listed here
 * works in the facility of the request (the default, as requireAdmin and requireProvider + requireFacility did).
 */

/** Always the active facility, no settings choice: was requireAdmin({ activeFacility }) / requireTemplateReader, and the
 * team meeting members (the result of requireFacility was not used); the notes (like the team meetings). */
// facilities.get.ts checks the active facility itself (requireUser + assertPageFacility: every signed-in account).
const ACTIVE = [
  'print-templates/[id]/file.get.ts', 'print-templates/index.get.ts', 'template-categories/index.get.ts',
  'team-meetings/[id].get.ts', 'team-meetings/[id].put.ts', 'team-meetings/[id]/sign.post.ts', 'team-meetings/index.get.ts',
  'team-meetings/index.post.ts',
  'notes/[id].delete.ts', 'notes/[id].put.ts', 'notes/index.get.ts', 'notes/index.post.ts',
  // The address book (like the notes): read by every account and the tablet, maintained in the active facility.
  'contacts/index.get.ts', 'contacts/staff-count.get.ts', 'contacts/index.post.ts', 'contacts/[id].put.ts', 'contacts/[id].delete.ts',
  'contacts/targets.get.ts',
  'contact-categories/index.post.ts', 'contact-categories/[id].put.ts', 'contact-categories/[id].delete.ts',
  'contact-categories/[id]/move.post.ts',
  // „Wissen“ (like the address book): read and confirmed by every account and the tablet, maintained in the active facility.
  'knowledge/index.get.ts', 'knowledge/index.post.ts', 'knowledge/[id].put.ts', 'knowledge/[id].delete.ts', 'knowledge/[id]/file.get.ts',
  'knowledge/order.post.ts', 'knowledge/[id]/confirm.post.ts', 'knowledge/[id]/confirmations.get.ts', 'knowledge/open-count.get.ts',
  'knowledge/targets.get.ts',
  'knowledge-categories/index.post.ts', 'knowledge-categories/[id].put.ts', 'knowledge-categories/[id].delete.ts',
  'knowledge-categories/[id]/move.post.ts',
  // „Zum Unterschreiben senden“: the requests of the facility the sender works in.
  'sign-requests/index.get.ts', 'sign-requests/index.post.ts', 'sign-requests/[id].delete.ts', 'sign-requests/[id]/file.get.ts',
  'sign-requests/[id]/remind.post.ts', 'sign-requests/[id]/withdraw.post.ts', 'sign-requests/overdue-count.get.ts',
]
/** No facility: was requireProvider alone (the route names its facility or works across all of them). */
const NONE = [
  'absence-codes/[id].put.ts', 'backup.get.ts', 'child-retention.get.ts', 'child-retention.put.ts',
  'children/[id]/facility.put.ts', 'employees/[id]/facility.put.ts', 'facilities.post.ts',
  'facilities/[id].put.ts', 'facilities/[id]/capacity.put.ts', 'facilities/[id]/group-read-access.get.ts',
  'facilities/[id]/groups.get.ts', 'facilities/[id]/groups.post.ts', 'facilities/active.put.ts', 'groups/[id].delete.ts',
  'groups/[id].put.ts', 'groups/[id]/school-children.put.ts', 'leave-settings/module.put.ts', 'retention/due.post.ts',
  'retention/index.get.ts', 'retention/items.delete.ts',
  // The rights page (Rechte und Rollen Teil 2): installation-wide, the Träger's.
  'rights.get.ts', 'rights/roles/[role].put.ts', 'rights/roles/[role]/reset.post.ts',
  // The category names of all facilities, for the Träger's templates for all facilities.
  'template-categories/names.get.ts',
  // The same for the Träger's contacts for all facilities.
  'contact-categories/names.get.ts',
  // And for the Träger's entries of „Wissen“ for all facilities.
  'knowledge-categories/names.get.ts',
  // Which facilities lack the category of a Träger item for several facilities (asked before saving it).
  'print-templates/missing-categories.post.ts', 'knowledge/missing-categories.post.ts', 'contacts/missing-categories.post.ts',
  // The Träger's street list of the school districts for all facilities.
  'school-districts/global.put.ts', 'school-districts/global.delete.ts',
]

const API_DIR = join(process.cwd(), 'server', 'api')
const routes = routeFiles() as string[]

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
      facilityId: 1,
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
