import { and, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../../server/db/client'
import { calendarEvents, employeeRequirements } from '../../server/db/schema'
import { createCalendarEvent } from '../../server/services/calendar'
import { confirmEventAttendance } from '../../server/services/eventRequirements'
import { saveBundleOverride } from '../../server/services/permissions'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addUser, createTestDb, requirementTypeId } from '../helpers/fixtures'

/**
 * The routes of Pflichttermine as appointments, called as Nitro would (the pattern of facilityRoutes.test.ts): the
 * auto-imported helpers are stubbed, requirePermission is the real guard, the database a real test database.
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
  routes['calendar-events/[id].delete'] = (await import('../../server/api/calendar-events/[id].delete')).default as Handler
  routes['attendance.get'] = (await import('../../server/api/calendar-events/[id]/attendance.get')).default as Handler
  routes['attendance.put'] = (await import('../../server/api/calendar-events/[id]/attendance.put')).default as Handler
  routes['requirements.post'] = (await import('../../server/api/employees/[id]/requirements.post')).default as Handler
})

function call(name: string, user: SessionUser, request: { params?: Record<string, number>; body?: unknown } = {}) {
  const event: FakeEvent = {
    headers: {}, context: {}, session: { user: { id: user.id }, loggedInAt: new Date().toISOString() },
    params: Object.fromEntries(Object.entries(request.params ?? {}).map(([key, value]) => [key, String(value)])),
    query: {}, body: request.body,
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

// Days well in the past, so the routes' own „today“ lies after them.
const DAY = '2025-03-12'
const LATER = '2025-03-20'

describe('Pflichttermin routes', () => {
  let leitung: SessionUser
  let calendarOnly: SessionUser
  let hortLeitung: SessionUser
  let anna: number
  let firstAid: number
  let eventId: number
  beforeEach(() => {
    db = createTestDb()
    anna = addEmployee(db, 'Anna', { validFrom: '2024-01-01' })
    firstAid = requirementTypeId(db, 'first_aid')
    leitung = addUser(db, 'leitung', 'admin', null, 1)
    // A Leitung of the facility who may manage the calendar but not enter Pflichttermine.
    calendarOnly = addUser(db, 'kalender', 'admin', null, 1)
    saveBundleOverride(db, calendarOnly.id, 'employeesEdit', 'revoke')
    hortLeitung = addUser(db, 'hort', 'admin', null, addFacility(db, 'Hort'))
    eventId = createCalendarEvent(db, 1, {
      date: DAY, endDate: null, start: null, end: null, title: 'Erste Hilfe', visibility: 'all', groupIds: [], employeeIds: [], requirementTypeId: firstAid,
    }, { mayRecord: true }).id
  })

  it('refuse deleting a Pflichttermin from the Terminliste without the right to enter Pflichttermine (M6)', async () => {
    expect(await status(() => call('calendar-events/[id].delete', calendarOnly, { params: { id: eventId } }))).toBe(403)
    expect(db.select().from(calendarEvents).all()).toHaveLength(1)
    await call('calendar-events/[id].delete', leitung, { params: { id: eventId } })
    expect(db.select().from(calendarEvents).all()).toHaveLength(0)
  })

  it('refuse another facility\'s appointment, reading and saving (M8)', async () => {
    expect(await status(() => call('attendance.get', hortLeitung, { params: { id: eventId } }))).toBe(404)
    expect(await status(() => call('attendance.put', hortLeitung, { params: { id: eventId }, body: { employeeIds: [anna] } }))).toBe(404)
    expect(await status(() => call('attendance.put', calendarOnly, { params: { id: eventId }, body: { employeeIds: [anna] } }))).toBe(403)
    expect(db.select().from(employeeRequirements).all()).toEqual([])
    expect(db.select({ at: calendarEvents.attendanceConfirmedAt }).from(calendarEvents).get()).toEqual({ at: null })
    await call('attendance.put', leitung, { params: { id: eventId }, body: { employeeIds: [anna] } })
    expect(db.select({ date: employeeRequirements.date, eventId: employeeRequirements.calendarEventId }).from(employeeRequirements).all())
      .toEqual([{ date: DAY, eventId }])
  })

  it('let an entry by hand replace the one of the same day from the appointment (M2)', async () => {
    confirmEventAttendance(db, 1, eventId, [anna], LATER)
    await call('requirements.post', leitung, { params: { id: anna }, body: { typeId: firstAid, date: DAY, note: 'DRK' } })
    const rows = db.select({ date: employeeRequirements.date, eventId: employeeRequirements.calendarEventId, note: employeeRequirements.note })
      .from(employeeRequirements).where(and(eq(employeeRequirements.employeeId, anna), eq(employeeRequirements.typeId, firstAid))).all()
    expect(rows).toEqual([{ date: DAY, eventId: null, note: 'DRK' }])
  })
})
