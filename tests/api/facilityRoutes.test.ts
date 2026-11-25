import type { H3Event } from 'h3'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../../server/db/client'
import { groups } from '../../server/db/schema'
import { getFacilityContact } from '../../server/services/facilityContact'
import { assertFacilityInReach } from '../../server/services/facilities'
import { facilityOfGroupInReach } from '../../server/services/groups'
import type { FacilityContactDto } from '../../shared/domain/facilityContact'
import type { PermissionKey } from '../../shared/domain/permissions'
import type { SessionUser } from '../../shared/types/api'
import { addFacility, addGroup, addUser, createTestDb, errorCode } from '../helpers/fixtures'

/**
 * The routes that name a facility (or a group) by id themselves, called as Nitro would: the auto-imported helpers are
 * stubbed, requirePermission is the real guard of server/utils/auth.ts, the database a real test database.
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
  session: { user: { id: number }; loggedInAt: string }
  params: Record<string, string>
  query: Record<string, string>
  body: unknown
}
type Handler = (event: H3Event) => Promise<unknown>

const routes: Record<string, Handler> = {}
beforeAll(async () => {
  vi.stubGlobal('requirePermission', (await import('../../server/utils/auth')).requirePermission)
  routes['facilities/[id]/groups.get'] = (await import('../../server/api/facilities/[id]/groups.get')).default as Handler
  routes['facilities/[id]/groups.post'] = (await import('../../server/api/facilities/[id]/groups.post')).default as Handler
  routes['groups/[id].put'] = (await import('../../server/api/groups/[id].put')).default as Handler
  routes['groups/[id].delete'] = (await import('../../server/api/groups/[id].delete')).default as Handler
  routes['facility-contact.get'] = (await import('../../server/api/facility-contact.get')).default as Handler
  routes['facility-contact.put'] = (await import('../../server/api/facility-contact.put')).default as Handler
  routes['helpout-pairs.get'] = (await import('../../server/api/helpout-pairs/index.get')).default as Handler
  routes['helpout-pairs.put'] = (await import('../../server/api/helpout-pairs/index.put')).default as Handler
  routes['helpout-pairs/help-outs.get'] = (await import('../../server/api/helpout-pairs/help-outs.get')).default as Handler
})

/** A request of the user to the route. */
function call(name: string, user: SessionUser, request: { params?: Record<string, number>; query?: Record<string, number>; body?: unknown } = {}) {
  const event: FakeEvent = {
    headers: {}, context: {}, session: { user: { id: user.id }, loggedInAt: new Date().toISOString() },
    params: Object.fromEntries(Object.entries(request.params ?? {}).map(([key, value]) => [key, String(value)])),
    query: Object.fromEntries(Object.entries(request.query ?? {}).map(([key, value]) => [key, String(value)])),
    body: request.body,
  }
  return routes[name]!(event as unknown as H3Event)
}

/** The status of a refused call (null when it went through). */
async function status(run: () => Promise<unknown>): Promise<number | null> {
  try {
    await run()
    return null
  }
  catch (error) {
    return (error as { statusCode?: number }).statusCode ?? -1
  }
}

const contact = (street: string): FacilityContactDto => ({ street, postalCode: '', city: '', website: '', operator: '', manager: '', contacts: [] })

describe('routes that name a facility by id', () => {
  let krippe: number
  let traeger: SessionUser
  let leitung: SessionUser
  let krippeGroup: number
  let ownGroup: number
  beforeEach(() => {
    db = createTestDb()
    krippe = addFacility(db, 'Krippe')
    traeger = addUser(db, 'traeger', 'provider', null, 1)
    leitung = addUser(db, 'leitung', 'admin', null, 1)
    ownGroup = addGroup(db, 1, 'Bären')
    krippeGroup = addGroup(db, krippe, 'Mäuse')
  })

  it('lets the Träger read and create the groups of any facility from facility 1, and rename or delete them', async () => {
    expect(await call('facilities/[id]/groups.get', traeger, { params: { id: krippe } })).toEqual([expect.objectContaining({ id: krippeGroup, name: 'Mäuse' })])
    await call('facilities/[id]/groups.post', traeger, { params: { id: krippe }, body: { name: 'Igel' } })
    expect(db.select().from(groups).all().filter(row => row.facilityId === krippe).map(row => row.name).sort()).toEqual(['Igel', 'Mäuse'])
    await call('groups/[id].put', traeger, { params: { id: krippeGroup }, body: { name: 'Mäuschen' } })
    await call('groups/[id].delete', traeger, { params: { id: krippeGroup } })
    expect(db.select().from(groups).all().map(row => row.name).sort()).toEqual(['Bären', 'Igel'])
    expect(await status(() => call('facilities/[id]/groups.get', traeger, { params: { id: 999 } }))).toBe(404)
  })

  it('refuses the Leitung another facility\'s groups (GET and POST) and changes nothing', async () => {
    for (const id of [krippe, 1, 999]) {
      expect(await status(() => call('facilities/[id]/groups.get', leitung, { params: { id } })), String(id)).toBe(403)
      expect(await status(() => call('facilities/[id]/groups.post', leitung, { params: { id }, body: { name: 'Igel' } })), String(id)).toBe(403)
    }
    expect(await status(() => call('groups/[id].put', leitung, { params: { id: krippeGroup }, body: { name: 'X' } }))).toBe(403)
    expect(await status(() => call('groups/[id].delete', leitung, { params: { id: krippeGroup } }))).toBe(403)
    expect(db.select().from(groups).all().map(row => row.name).sort()).toEqual(['Bären', 'Mäuse'])
  })

  it('keeps a holder of the groups right without the right for other facilities to the own facility', () => {
    // settings.groups is the Träger's alone today; should it ever be given to someone else, the id check still holds.
    const holder = { permissions: new Set<PermissionKey>(['settings.facility', 'settings.groups']), facilityId: 1 }
    expect(() => assertFacilityInReach(db, holder, 1)).not.toThrow()
    expect(errorCode(() => assertFacilityInReach(db, holder, krippe))).toBe('forbidden')
    expect(errorCode(() => assertFacilityInReach(db, holder, 999))).toBe('forbidden')
    expect(facilityOfGroupInReach(db, holder, ownGroup)).toBe(1)
    expect(errorCode(() => facilityOfGroupInReach(db, holder, krippeGroup))).toBe('group_not_found')
    expect(errorCode(() => facilityOfGroupInReach(db, holder, 999))).toBe('group_not_found')
    // The Träger: any facility (an unknown one is 404).
    expect(() => assertFacilityInReach(db, traeger, krippe)).not.toThrow()
    expect(errorCode(() => assertFacilityInReach(db, traeger, 999))).toBe('facility_not_found')
    expect(facilityOfGroupInReach(db, traeger, krippeGroup)).toBe(krippe)
  })

  it('reads and writes the contact of the facility named in ?facilityId=: the Träger any, the Leitung only reads her own', async () => {
    await call('facility-contact.put', traeger, { query: { facilityId: krippe }, body: contact('Krippenweg 1') })
    expect(getFacilityContact(db, traeger, krippe).street).toBe('Krippenweg 1')
    expect(getFacilityContact(db, traeger, 1).street).toBe('')
    expect(await call('facility-contact.get', traeger, { query: { facilityId: krippe } })).toMatchObject({ street: 'Krippenweg 1' })
    // Without the id: the facility the request works in.
    await call('facility-contact.put', traeger, { body: contact('Parkweg 4') })
    expect(await call('facility-contact.get', traeger)).toMatchObject({ street: 'Parkweg 4' })
    expect(await status(() => call('facility-contact.get', traeger, { query: { facilityId: 999 } }))).toBe(404)
    // The Leitung of facility 1.
    expect(await call('facility-contact.get', leitung, { query: { facilityId: 1 } })).toMatchObject({ street: 'Parkweg 4' })
    expect(await call('facility-contact.get', leitung)).toMatchObject({ street: 'Parkweg 4' })
    expect(await status(() => call('facility-contact.get', leitung, { query: { facilityId: krippe } }))).toBe(403)
    expect(await status(() => call('facility-contact.get', leitung, { query: { facilityId: 999 } }))).toBe(403)
    expect(await status(() => call('facility-contact.put', leitung, { query: { facilityId: 1 }, body: contact('Anders 1') }))).toBe(403)
    expect(getFacilityContact(db, traeger, 1).street).toBe('Parkweg 4')
    // An id that is no positive whole number is refused before anything is read.
    expect(await status(() => call('facility-contact.get', traeger, { query: { facilityId: 0 } }))).not.toBeNull()
  })

  it('lets only the Träger set the pairs of facilities allowed to help each other out; the Leitung reads her own', async () => {
    const body = { facilityId: krippe, otherFacilityId: 1, paired: true }
    expect(await status(() => call('helpout-pairs.put', leitung, { body }))).toBe(403)
    expect(await call('helpout-pairs.get', traeger)).toEqual({ pairs: [], names: {}, unpaired: [] })
    await call('helpout-pairs.put', traeger, { body })
    expect(await call('helpout-pairs.get', leitung)).toMatchObject({ pairs: [[1, krippe]], unpaired: [] })
    expect(await call('helpout-pairs/help-outs.get', traeger, { query: { facilityId: 1, otherFacilityId: krippe } })).toEqual([])
    expect(await status(() => call('helpout-pairs/help-outs.get', leitung, { query: { facilityId: 1, otherFacilityId: krippe } }))).toBe(403)
    expect(await status(() => call('helpout-pairs.put', traeger, { body: { facilityId: 1, otherFacilityId: 1, paired: true } }))).toBe(400)
  })
})
