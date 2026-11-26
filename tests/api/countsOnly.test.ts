import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../../server/db/client'
import { employees } from '../../server/db/schema'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { unlockChildren } from '../../server/services/tabletUnlock'
import { setPin } from '../../server/services/terminal'
import type { ChildCountsDto, SessionUser } from '../../shared/types/api'
import { addChild, addEmployee, addUser, createTestDb } from '../helpers/fixtures'

/**
 * „Nur Kinderzahlen“ on the server, called as Nitro would (the auto-imported helpers stubbed, the guards the real ones of
 * server/utils/auth.ts): every child route refuses the person, at the tablet and with the own account; „Kinder heute“
 * answers only them.
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
vi.stubGlobal('getQuery', (event: FakeEvent) => event.query)
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

const API_DIR = join(process.cwd(), 'server', 'api')
/** Every route file behind the child guard (requireChildPermission), relative to server/api. */
const CHILD_ROUTES = (readdirSync(API_DIR, { recursive: true }) as string[])
  .filter(file => file.endsWith('.ts'))
  .map(file => relative(API_DIR, join(API_DIR, file)).split(sep).join('/'))
  .filter(route => readFileSync(join(API_DIR, route), 'utf8').includes('requireChildPermission('))
  .sort()

const handlers: Record<string, Handler> = {}
beforeAll(async () => {
  const auth = await import('../../server/utils/auth')
  for (const name of ['requirePermission', 'requireChildPermission', 'requireTerminal', 'requireUser', 'childUnlockToken'] as const) {
    vi.stubGlobal(name, auth[name])
  }
  for (const route of [...CHILD_ROUTES, 'terminal/children/counts.get.ts']) {
    // Found at run time (every child route, also those added later), so not bundled by Vite.
    handlers[route] = (await import(/* @vite-ignore */ `../../server/api/${route.replace(/\.ts$/, '')}`)).default as Handler
  }
}, 120_000)

/** A request of the user (at the tablet with the unlock token in its session); every parameter a route may name is 1. */
function call(route: string, user: SessionUser, token?: string) {
  const event: FakeEvent = {
    headers: {}, context: {},
    session: { user: { id: user.id }, loggedInAt: new Date().toISOString(), secure: token ? { childUnlock: token } : undefined },
    params: { id: '1', formId: '1', revisionId: '1', childId: '1' }, query: {}, body: {},
  }
  return handlers[route]!(event as unknown as H3Event)
}

/** The code of a refused call (null when it went through). */
async function refusal(run: () => Promise<unknown>): Promise<{ status?: number; code: string } | null> {
  try {
    await run()
    return null
  }
  catch (error) {
    const refused = error as { statusCode?: number; code?: string; data?: { code?: string } }
    return { status: refused.statusCode, code: refused.code ?? refused.data?.code ?? 'unknown' }
  }
}

describe('„Nur Kinderzahlen“ on the child routes', () => {
  let tablet: SessionUser
  let hanna: number
  let gina: number
  let lead: SessionUser
  const unlock = (employeeId: number, pin: string) => unlockChildren(db, { id: tablet.id, facilityId: 1 }, employeeId, pin).token

  beforeEach(() => {
    db = createTestDb()
    setTimeTrackingFrom(db, 1, '2026-01-01')
    tablet = addUser(db, 'tablet', 'terminal')
    hanna = addEmployee(db, 'Hanna')
    gina = addEmployee(db, 'Gina')
    lead = addUser(db, 'gina', 'group_lead', gina)
    setPin(db, 1, hanna, '111111')
    setPin(db, 1, gina, '222222')
    addChild(db, 1, {})
    for (const id of [hanna, gina]) db.update(employees).set({ countsOnly: true }).where(eq(employees.id, id)).run()
  })

  it('finds the child routes', () => {
    expect(CHILD_ROUTES.length).toBeGreaterThan(90)
  })

  it('refuses every child route at the tablet, with or without an account (403 forbidden)', async () => {
    for (const employeeId of [hanna, gina]) {
      const token = unlock(employeeId, employeeId === hanna ? '111111' : '222222')
      for (const route of CHILD_ROUTES) expect(await refusal(() => call(route, tablet, token)), route).toEqual({ status: 403, code: 'forbidden' })
    }
  }, 120_000)

  it('refuses every child route with the own account of a Gruppenleitung (403 children_tablet_only)', async () => {
    for (const route of CHILD_ROUTES) {
      expect(await refusal(() => call(route, lead)), route).toEqual({ status: 403, code: 'children_tablet_only' })
    }
  }, 120_000)

  it('answers „Kinder heute“ only to the tablet unlocked by such a person, with numbers only', async () => {
    const counts = await call('terminal/children/counts.get.ts', tablet, unlock(hanna, '111111')) as ChildCountsDto
    expect(counts.total).toMatchObject({ notYet: 1, present: 0, absent: 0, gone: 0 })
    // Switched off, the same person has the attendance list instead.
    db.update(employees).set({ countsOnly: false }).where(eq(employees.id, hanna)).run()
    expect(await refusal(() => call('terminal/children/counts.get.ts', tablet, unlock(hanna, '111111')))).toEqual({ status: 403, code: 'forbidden' })
    expect(await refusal(() => call('terminal/children/counts.get.ts', tablet))).toEqual({ status: 403, code: 'tablet_locked' })
    expect(await refusal(() => call('terminal/children/counts.get.ts', lead))).toEqual({ status: 403, code: 'forbidden' })
  })
})
