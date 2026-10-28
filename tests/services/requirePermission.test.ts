import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../../server/db/client'
import { employees, users } from '../../server/db/schema'
import { setContractVisibleToAdmins } from '../../server/services/appSettings'
import { saveBundleOverride, saveRoleBundle } from '../../server/services/permissions'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, createTestDb } from '../helpers/fixtures'

/**
 * requirePermission of server/utils/auth.ts at runtime (Rechte und Rollen Teil 1): who is refused, the tablet, the
 * facility modes, and that the permissions are resolved fresh on every request. Nitro's auto-imported helpers are
 * stubbed, the database is a real test database (as in settingsFacilityGuards.test.ts).
 */
let db: Db
vi.stubGlobal('useDb', () => db)
vi.stubGlobal('requireUserSession', async (event: FakeEvent) => event.session)
vi.stubGlobal('getUserSession', async (event: FakeEvent) => event.session)
vi.stubGlobal('clearUserSession', async () => {})
vi.stubGlobal('setUserSession', async () => {})
vi.stubGlobal('getHeader', (event: FakeEvent, name: string) => event.headers[name.toLowerCase()])
vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string; data: { code: string } }) =>
  Object.assign(new Error(input.statusMessage), input))

interface FakeEvent {
  headers: Record<string, string>
  context: Record<string, unknown>
  session: { user: { id: number }; loggedInAt: string }
}

let auth: typeof import('../../server/utils/auth')
beforeAll(async () => {
  auth = await import('../../server/utils/auth')
})

function event(user: SessionUser): H3Event {
  const fake: FakeEvent = { headers: {}, context: {}, session: { user: { id: user.id }, loggedInAt: new Date().toISOString() } }
  return fake as unknown as H3Event
}

/** The error code the call answers with, null when it lets the user in. */
async function code(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run()
    return null
  }
  catch (error) {
    return (error as { data?: { code?: string } }).data?.code ?? 'unknown'
  }
}

describe('requirePermission', () => {
  let provider: SessionUser
  let leitung: SessionUser
  let staff: SessionUser
  let tablet: SessionUser
  beforeEach(() => {
    db = createTestDb()
    provider = addUser(db, 'traeger', 'provider')
    leitung = addUser(db, 'leitung', 'admin')
    staff = addUser(db, 'anna', 'observer', addEmployee(db, 'Anna'))
    tablet = addUser(db, 'tablet', 'terminal')
  })

  it('refuses a Mitarbeiter a key of the Leitung, and lets her in with one of her own', async () => {
    expect(await code(() => auth.requirePermission(event(staff), 'plan.edit'))).toBe('forbidden')
    expect(await code(() => auth.requirePermission(event(staff), 'employees.view'))).toBe('forbidden')
    expect((await auth.requirePermission(event(staff), 'plan.view')).facilityId).toBe(1)
  })

  it('refuses the Leitung a key fixed at the Träger, whatever the facility mode', async () => {
    expect(await code(() => auth.requirePermission(event(leitung), 'facilities.manage', { facility: 'none' }))).toBe('forbidden')
    expect(await code(() => auth.requirePermission(event(leitung), 'settings.staffing'))).toBe('forbidden')
    expect(await code(() => auth.requirePermission(event(leitung), 'children.schoolSettings'))).toBe('forbidden')
    // Since Teil 2 the Leitung reopens cash months by default.
    expect((await auth.requirePermission(event(leitung), 'cash.reopen')).id).toBe(leitung.id)
    expect((await auth.requirePermission(event(leitung), 'cash.book')).facilityId).toBe(1)
    expect((await auth.requirePermission(event(provider), 'facilities.manage', { facility: 'none' })).id).toBe(provider.id)
  })

  it('lets the tablet in only with allowTerminal, and then without a key of its own', async () => {
    expect(await code(() => auth.requirePermission(event(tablet), 'plan.view'))).toBe('forbidden')
    expect(await code(() => auth.requirePermission(event(tablet), 'cash.view'))).toBe('forbidden')
    expect((await auth.requirePermission(event(tablet), 'plan.view', { allowTerminal: true })).facilityId).toBe(1)
    expect((await auth.requirePermission(event(tablet), 'printTemplates.view', { allowTerminal: true, facility: 'active' }))
      .facilityId).toBe(1)
    // allowTerminal admits the tablet only; everybody else still needs the key.
    expect(await code(() => auth.requirePermission(event(staff), 'printTemplates.edit', { allowTerminal: true })))
      .toBe('forbidden')
  })

  it('answers no_facility without a facility under request and active, and lets in under none', async () => {
    const loose = addUser(db, 'ohne', 'observer')
    expect(loose.facilityId).toBeNull()
    expect(await code(() => auth.requirePermission(event(loose), 'plan.view'))).toBe('no_facility')
    expect(await code(() => auth.requirePermission(event(loose), 'plan.view', { facility: 'active' }))).toBe('no_facility')
    expect((await auth.requirePermission(event(loose), 'plan.view', { facility: 'none' })).facilityId).toBeNull()
    // The key comes first: a missing permission is forbidden, not no_facility.
    expect(await code(() => auth.requirePermission(event(loose), 'plan.edit'))).toBe('forbidden')
  })

  it('takes a leave-planning exception and the contract switch into account on the next request', async () => {
    expect(await code(() => auth.requirePermission(event(leitung), 'leave.plan'))).toBe('forbidden')
    saveBundleOverride(db, leitung.id, 'leavePlan', 'grant')
    expect((await auth.requirePermission(event(leitung), 'leave.plan')).id).toBe(leitung.id)
    saveBundleOverride(db, leitung.id, 'leavePlan', null)
    expect(await code(() => auth.requirePermission(event(leitung), 'leave.plan'))).toBe('forbidden')

    expect(await code(() => auth.requirePermission(event(leitung), 'employees.contractView'))).toBe('forbidden')
    setContractVisibleToAdmins(db, true)
    expect((await auth.requirePermission(event(leitung), 'employees.contractView')).id).toBe(leitung.id)
    setContractVisibleToAdmins(db, false)
    expect(await code(() => auth.requirePermission(event(leitung), 'employees.contractView'))).toBe('forbidden')
  })

  it('takes a role setting into account for every account of the role on the next request (RF2)', async () => {
    const other = addUser(db, 'other', 'observer', addEmployee(db, 'Other'))
    for (const person of [staff, other]) {
      expect(await code(() => auth.requirePermission(event(person), 'printTemplates.edit'))).toBe('forbidden')
    }
    saveRoleBundle(db, 'observer', 'templatesEdit', true)
    for (const person of [staff, other]) expect((await auth.requirePermission(event(person), 'printTemplates.edit')).id).toBe(person.id)
    // An exception overrides the role both ways.
    saveBundleOverride(db, other.id, 'templatesEdit', 'revoke')
    expect(await code(() => auth.requirePermission(event(other), 'printTemplates.edit'))).toBe('forbidden')
    expect((await auth.requirePermission(event(staff), 'printTemplates.edit')).id).toBe(staff.id)
    saveRoleBundle(db, 'admin', 'cashBook', false)
    expect(await code(() => auth.requirePermission(event(leitung), 'cash.view'))).toBe('forbidden')
    saveBundleOverride(db, leitung.id, 'cashBook', 'grant')
    expect((await auth.requirePermission(event(leitung), 'cash.view')).id).toBe(leitung.id)
  })

  it('takes a role change into account on the next request', async () => {
    expect(await code(() => auth.requirePermission(event(staff), 'cash.view'))).toBe('forbidden')
    db.update(users).set({ role: 'admin', facilityId: 1 }).where(eq(users.id, staff.id)).run()
    expect((await auth.requirePermission(event(staff), 'cash.view')).facilityId).toBe(1)
  })

  it('refuses a deactivated account and one whose employee has left', async () => {
    db.update(users).set({ active: false }).where(eq(users.id, leitung.id)).run()
    expect(await code(() => auth.requirePermission(event(leitung), 'plan.view'))).toBe('session_expired')
    db.update(employees).set({ leftOn: '2020-01-31' }).where(eq(employees.id, staff.employeeId!)).run()
    expect(await code(() => auth.requirePermission(event(staff), 'plan.view'))).toBe('session_expired')
  })
})
