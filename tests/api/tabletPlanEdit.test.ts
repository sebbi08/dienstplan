import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../../server/db/client'
import { entries, monthPlans } from '../../server/db/schema'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { saveBundleOverride } from '../../server/services/permissions'
import { lockChildren, unlockChildren } from '../../server/services/tabletUnlock'
import { setPin } from '../../server/services/terminal'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addUser, createTestDb, templateId } from '../helpers/fixtures'

/**
 * „Dienstplan bearbeiten“ at the tablet, called as Nitro would: the auto-imported helpers are stubbed, the guards are
 * the real ones of server/utils/auth.ts, the session carries the tablet's unlock token in its server-only part.
 */
let db: Db
vi.stubGlobal('useDb', () => db)
vi.stubGlobal('defineServiceHandler', (handler: unknown) => handler)
vi.stubGlobal('requireUserSession', async (event: FakeEvent) => event.session)
vi.stubGlobal('getUserSession', async (event: FakeEvent) => event.session)
vi.stubGlobal('clearUserSession', async () => {})
vi.stubGlobal('setUserSession', async () => {})
vi.stubGlobal('getHeader', (event: FakeEvent, name: string) => event.headers[name.toLowerCase()])
vi.stubGlobal('getValidatedRouterParams', async (event: FakeEvent, parse: (value: unknown) => unknown) => parse(event.params))
vi.stubGlobal('getValidatedQuery', async (event: FakeEvent, parse: (value: unknown) => unknown) => parse(event.query))
vi.stubGlobal('readValidatedBody', async (event: FakeEvent, parse: (value: unknown) => unknown) => parse(event.body))
vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string; data: { code: string } }) =>
  Object.assign(new Error(input.statusMessage), input))

interface FakeEvent {
  headers: Record<string, string>
  context: Record<string, unknown>
  session: { user: { id: number }; loggedInAt: string; secure?: { childUnlock?: string } }
  params: Record<string, string>
  query: Record<string, string>
  body: unknown
}
type Handler = (event: H3Event) => Promise<unknown>

const routes: Record<string, Handler> = {}
beforeAll(async () => {
  const auth = await import('../../server/utils/auth')
  vi.stubGlobal('requirePermission', auth.requirePermission)
  vi.stubGlobal('requireTerminal', auth.requireTerminal)
  vi.stubGlobal('childUnlockToken', auth.childUnlockToken)
  vi.stubGlobal('planReader', auth.planReader)
  routes['terminal/plan-edit.post'] = (await import('../../server/api/terminal/plan-edit.post')).default as Handler
  routes['entries/index.post'] = (await import('../../server/api/entries/index.post')).default as Handler
  routes['plan/[year]/[month].get'] = (await import('../../server/api/plan/[year]/[month].get')).default as Handler
  routes['release.post'] = (await import('../../server/api/plan/[year]/[month]/release.post')).default as Handler
  routes['employees/[id]/children.get'] = (await import('../../server/api/employees/[id]/children.get')).default as Handler
})

/** A request of the user (at the tablet with the unlock token in its session) to the route. */
function call(name: string, user: SessionUser, request: { token?: string; params?: Record<string, number>; body?: unknown } = {}) {
  const event: FakeEvent = {
    headers: {}, context: {},
    session: { user: { id: user.id }, loggedInAt: new Date().toISOString(), secure: request.token ? { childUnlock: request.token } : undefined },
    params: Object.fromEntries(Object.entries(request.params ?? {}).map(([key, value]) => [key, String(value)])),
    query: {}, body: request.body,
  }
  return routes[name]!(event as unknown as H3Event)
}

/** The code of a refused call (null when it went through). */
async function refusal(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run()
    return null
  }
  catch (error) {
    const refused = error as { statusCode?: number; code?: string; data?: { code?: string } }
    expect(refused.statusCode).toBe(403)
    return refused.code ?? refused.data?.code ?? 'unknown'
  }
}

describe('the plan editor\'s routes at the tablet', () => {
  let lena: number
  let mia: number
  let leitung: SessionUser
  let mitarbeiterin: SessionUser
  let tablet: SessionUser
  const month = { year: 2026, month: 12 }
  const writeCell = (user: SessionUser, token?: string) => call('entries/index.post', user, {
    token, body: { cells: [{ employeeId: mia, date: '2026-12-01' }], mode: 'replace', entry: { kind: 'shift', templateId: templateId(db, 'M') } },
  })
  const unlock = (employeeId: number, pin: string) => unlockChildren(db, { id: tablet.id, facilityId: 1 }, employeeId, pin).token

  beforeEach(() => {
    db = createTestDb()
    lena = addEmployee(db, 'Lena')
    mia = addEmployee(db, 'Mia')
    setTimeTrackingFrom(db, 1, '2026-01-01')
    setPin(db, 1, lena, '111111')
    setPin(db, 1, mia, '222222')
    leitung = addUser(db, 'lena', 'admin', lena)
    mitarbeiterin = addUser(db, 'mia', 'observer', mia)
    tablet = addUser(db, 'tablet', 'terminal')
  })

  it('refuses the locked tablet, an unlock without the right, and an unlock that has not started editing', async () => {
    expect(await refusal(() => writeCell(tablet))).toBe('tablet_locked')
    expect(await refusal(() => call('terminal/plan-edit.post', tablet))).toBe('tablet_locked')
    const miaToken = unlock(mia, '222222')
    expect(await refusal(() => call('terminal/plan-edit.post', tablet, { token: miaToken }))).toBe('forbidden')
    expect(await refusal(() => writeCell(tablet, miaToken))).toBe('forbidden')
    const lenaToken = unlock(lena, '111111')
    expect(await refusal(() => writeCell(tablet, lenaToken))).toBe('forbidden')
    // Not editing: the tablet reads the released plan only (none yet).
    expect(await refusal(() => call('plan/[year]/[month].get', tablet, { token: lenaToken, params: month }))).toBe('month_not_released')
    expect(db.select().from(entries).all()).toEqual([])
  })

  it('lets the person edit with their own account once started, and records that account', async () => {
    const token = unlock(lena, '111111')
    expect(await call('terminal/plan-edit.post', tablet, { token })).toMatchObject({ unlocked: true, planEdit: { active: true, canRelease: true } })
    expect(await writeCell(tablet, token)).toMatchObject({ ok: true })
    expect(db.select().from(entries).where(eq(entries.employeeId, mia)).get()).toMatchObject({ updatedBy: leitung.id })
    // The draft with the editor's data, as the Leitung sees it in the office.
    expect(await call('plan/[year]/[month].get', tablet, { token, params: month })).toMatchObject({ admin: expect.anything() })
    await call('release.post', tablet, { token, params: month })
    expect(db.select().from(monthPlans).get()).toMatchObject({ releasedBy: leitung.id })
    expect(await call('employees/[id]/children.get', tablet, { token, params: { id: mia } })).toMatchObject({ children: [] })

    // Locked: nothing more, the plan page included.
    lockChildren(db, tablet.id, token)
    expect(await refusal(() => writeCell(tablet, token))).toBe('tablet_locked')
    expect(await refusal(() => call('terminal/plan-edit.post', tablet, { token }))).toBe('tablet_locked')
    // Read as the tablet again: the released plan without the editor's data.
    expect(await call('plan/[year]/[month].get', tablet, { token, params: month })).toMatchObject({ admin: null })
  })

  it('gives the person exactly their account\'s rights: plan.edit without plan.release or the personal data', async () => {
    saveBundleOverride(db, mitarbeiterin.id, 'planEdit', 'grant')
    const token = unlock(mia, '222222')
    await call('terminal/plan-edit.post', tablet, { token })
    expect(await writeCell(tablet, token)).toMatchObject({ ok: true })
    expect(db.select().from(entries).get()).toMatchObject({ updatedBy: mitarbeiterin.id })
    expect(await refusal(() => call('release.post', tablet, { token, params: month }))).toBe('forbidden')
    expect(await refusal(() => call('employees/[id]/children.get', tablet, { token, params: { id: lena } }))).toBe('forbidden')
    // The right taken away: the tablet locks.
    saveBundleOverride(db, mitarbeiterin.id, 'planEdit', null)
    expect(await refusal(() => writeCell(tablet, token))).toBe('tablet_locked')
  })

  it('refuses another facility\'s tablet with this unlock, and leaves the accounts as they were', async () => {
    const krippe = addFacility(db, 'Krippe')
    const krippeTablet = addUser(db, 'tablet-krippe', 'terminal', null, krippe)
    const token = unlock(lena, '111111')
    await call('terminal/plan-edit.post', tablet, { token })
    expect(await refusal(() => writeCell(krippeTablet, token))).toBe('tablet_locked')
    // An account never edits through a tablet's unlock: its own permissions count.
    expect(await refusal(() => writeCell(mitarbeiterin, token))).toBe('forbidden')
    expect(await writeCell(leitung)).toMatchObject({ ok: true })
  })
})
