import type { H3Event } from 'h3'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../../server/db/client'
import { PAGE_FACILITY_HEADER, SETTINGS_FACILITY_HEADER } from '../../shared/domain/pageFacility'
import type { SessionUser } from '../../shared/types/api'
import { addFacility, addUser, createTestDb } from '../helpers/fixtures'

/**
 * The guards of server/utils/auth.ts with the Träger's settings facility header: Nitro's auto-imported helpers are
 * stubbed, the database is a real test database.
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

function event(user: SessionUser, headers: { page?: number | string; settings?: number | string } = {}): H3Event {
  const fake: FakeEvent = {
    headers: {
      ...(headers.page === undefined ? {} : { [PAGE_FACILITY_HEADER.toLowerCase()]: String(headers.page) }),
      ...(headers.settings === undefined ? {} : { [SETTINGS_FACILITY_HEADER.toLowerCase()]: String(headers.settings) }),
    },
    context: {},
    session: { user: { id: user.id }, loggedInAt: new Date().toISOString() },
  }
  return fake as unknown as H3Event
}

async function code(run: () => Promise<unknown> | unknown): Promise<string | null> {
  try {
    await run()
    return null
  }
  catch (error) {
    return (error as { code?: string; data?: { code?: string } }).code ?? (error as { data?: { code?: string } }).data?.code ?? 'unknown'
  }
}

describe('guards with the settings facility header', () => {
  let other: number
  let provider: SessionUser
  let leitung: SessionUser
  beforeEach(() => {
    db = createTestDb()
    other = addFacility(db, 'Kita Sonne')
    provider = addUser(db, 'traeger', 'provider', null, 1)
    leitung = addUser(db, 'leitung', 'admin', null, 1)
  })

  it('gives the Träger the chosen facility in requireAdmin, without touching the active one', async () => {
    const e = event(provider, { page: 1, settings: other })
    expect((await auth.requireAdmin(e)).facilityId).toBe(other)
    // A second guard in the same route checks the page against the real active facility again (no false 409).
    expect(auth.requireFacility(e, await auth.requireProvider(e))).toBe(other)
    // The session account stays in the active facility.
    expect((await auth.requireUser(e)).facilityId).toBe(1)
  })
  it('keeps the active facility where the route asks for it (the header\'s facility switcher)', async () => {
    expect((await auth.requireAdmin(event(provider, { page: 1, settings: other }), { activeFacility: true })).facilityId).toBe(1)
  })
  it('follows the choice in requireFacility after requireProvider and in requireChildReader', async () => {
    const e = event(provider, { page: 1, settings: other })
    expect(auth.requireFacility(e, await auth.requireProvider(e))).toBe(other)
    expect((await auth.requireChildReader(event(provider, { page: 1, settings: other }))).facilityId).toBe(other)
  })
  it('ignores the header of the Leitung everywhere', async () => {
    expect((await auth.requireAdmin(event(leitung, { page: 1, settings: other }))).facilityId).toBe(1)
    expect((await auth.requireChildReader(event(leitung, { page: 1, settings: other }))).facilityId).toBe(1)
    expect((await auth.requireAdmin(event(leitung, { page: 1, settings: 'nonsense' }))).facilityId).toBe(1)
  })
  it('answers 404 for an unknown facility and 409 for a stale page, whatever the header says', async () => {
    expect(await code(() => auth.requireAdmin(event(provider, { page: 1, settings: 999 })))).toBe('facility_not_found')
    expect(await code(() => auth.requireAdmin(event(provider, { page: other, settings: other })))).toBe('facility_changed')
    expect(await code(() => auth.requireAdmin(event(provider, { page: 1, settings: other })))).toBeNull()
  })
})
