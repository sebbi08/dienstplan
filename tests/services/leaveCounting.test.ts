import type { H3Event } from 'h3'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../../server/db/client'
import { createClosure } from '../../server/services/closures'
import { createEmployee, setEntitlement } from '../../server/services/employees'
import { applyToCells } from '../../server/services/entries'
import { getLeaveAccount, getLeaveOverview } from '../../server/services/leave'
import { getLeaveCounting, setLeaveCounting } from '../../server/services/leaveCounting'
import {
  createLeaveRequest, listMyLeaveRequests, listOpenRequests, previewLeaveRequest, setLeaveModule,
} from '../../server/services/leaveRequests'
import { loadEntries } from '../../server/services/queries'
import { PAGE_FACILITY_HEADER, SETTINGS_FACILITY_HEADER } from '../../shared/domain/pageFacility'
import type { LeaveCountingDto, SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addUser, codeId, createTestDb, errorCode } from '../helpers/fixtures'

const today = '2026-10-07'

// The routes run with Nitro's auto-imported helpers stubbed and the real guards of server/utils/auth.ts on a real test
// database (as in settingsFacilityGuards.test.ts).
let routeDb: Db
vi.stubGlobal('useDb', () => routeDb)
vi.stubGlobal('requireUserSession', async (event: FakeEvent) => event.session)
vi.stubGlobal('getUserSession', async (event: FakeEvent) => event.session)
vi.stubGlobal('clearUserSession', async () => {})
vi.stubGlobal('setUserSession', async () => {})
vi.stubGlobal('getHeader', (event: FakeEvent, name: string) => event.headers[name.toLowerCase()])
vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string; data: { code: string } }) =>
  Object.assign(new Error(input.statusMessage), input))
vi.stubGlobal('defineServiceHandler', (handler: (event: H3Event) => unknown) => handler)
vi.stubGlobal('readValidatedBody', async (event: FakeEvent, parse: (body: unknown) => unknown) => parse(event.body))

interface FakeEvent {
  headers: Record<string, string>
  context: Record<string, unknown>
  session: { user: { id: number }; loggedInAt: string }
  body?: unknown
}
type Route = (event: H3Event) => Promise<LeaveCountingDto>

describe('24 and 31 December as half a leave day (per facility)', () => {
  let db: Db
  let provider: SessionUser
  let krippe: number
  let anna: number
  let carl: number
  beforeEach(() => {
    db = createTestDb()
    provider = addUser(db, 'traeger', 'provider')
    krippe = addFacility(db, 'Krippe')
    anna = addEmployee(db, 'Anna')
    carl = addEmployee(db, 'Carl', { facilityId: krippe })
  })
  const vacation = (facilityId: number, employeeId: number, dates: string[]) => applyToCells(
    db, provider, facilityId, dates.map(date => ({ employeeId, date })), 'replace', { kind: 'code', codeId: codeId(db, 'vacation') },
  )

  it('is off by default and is stored per facility', () => {
    expect(getLeaveCounting(db, 1)).toEqual({ christmasEveHalfLeave: false })
    expect(setLeaveCounting(db, 1, { christmasEveHalfLeave: true })).toEqual({ christmasEveHalfLeave: true })
    expect(getLeaveCounting(db, krippe)).toEqual({ christmasEveHalfLeave: false })
    expect(errorCode(() => getLeaveCounting(db, 999))).toBe('facility_not_found')
    expect(errorCode(() => setLeaveCounting(db, 999, { christmasEveHalfLeave: true }))).toBe('facility_not_found')
  })

  it('counts the leave account and its periods with the home facility\'s setting, also the carry-over', () => {
    setLeaveCounting(db, 1, { christmasEveHalfLeave: true })
    for (const [facilityId, employeeId] of [[1, anna], [krippe, carl]] as const) {
      setEntitlement(db, facilityId, employeeId, 2026, { days: 30, carriedOverDays: 0 })
      setEntitlement(db, facilityId, employeeId, 2027, { days: 30, carriedOverDays: 0 })
      vacation(facilityId, employeeId, ['2026-12-23', '2026-12-24', '2026-12-28', '2026-12-31'])
    }
    expect(getLeaveAccount(db, anna, 2026, today)).toMatchObject({
      account: { entitlement: 30, carriedOver: 0, taken: 0, planned: 3, available: 27 },
      // The holidays and the weekend between 24 and 28 December are bridged.
      ranges: [{ from: '2026-12-23', to: '2026-12-28', days: 2.5 }, { from: '2026-12-31', to: '2026-12-31', days: 0.5 }],
    })
    expect(getLeaveAccount(db, carl, 2026, today)).toMatchObject({
      account: { planned: 4, available: 26 },
      ranges: [{ days: 3 }, { days: 1 }],
    })
    expect(getLeaveOverview(db, 1, 2026, today).map(row => row.account.available)).toEqual([27])
    expect(getLeaveAccount(db, anna, 2027, today).account).toMatchObject({ carriedOver: 27, available: 57 })
    expect(getLeaveAccount(db, carl, 2027, today).account).toMatchObject({ carriedOver: 26, available: 56 })
    // Switched off again, every year counts whole days again.
    setLeaveCounting(db, 1, { christmasEveHalfLeave: false })
    expect(getLeaveAccount(db, anna, 2026, today).account.available).toBe(26)
    expect(getLeaveAccount(db, anna, 2027, today).account.carriedOver).toBe(26)
  })

  it('counts the days of a leave request and the leave left after it with the setting', () => {
    setLeaveModule(db, { enabled: true, plannerIds: [] })
    setLeaveCounting(db, 1, { christmasEveHalfLeave: true })
    setEntitlement(db, 1, anna, 2026, { days: 30, carriedOverDays: 0 })
    setEntitlement(db, krippe, carl, 2026, { days: 30, carriedOverDays: 0 })
    const annaUser = addUser(db, 'anna', 'observer', anna)
    const carlUser = addUser(db, 'carl', 'observer', carl)
    // Mon 21.12. – Fri 1.1.: 21–24 and 28–31 December are working days, 25/26 December and 1 January holidays.
    expect(previewLeaveRequest(db, annaUser, '2026-12-21', '2027-01-01', today))
      .toEqual({ workdays: 7, availableAfter: 23, overLimitDates: [] })
    expect(previewLeaveRequest(db, carlUser, '2026-12-21', '2027-01-01', today))
      .toEqual({ workdays: 8, availableAfter: 22, overLimitDates: [] })
    createLeaveRequest(db, annaUser, { from: '2026-12-21', to: '2027-01-01', note: '' }, today)
    expect(listMyLeaveRequests(db, annaUser)).toMatchObject([{ workdays: 7 }])
    expect(listOpenRequests(db, provider, 1)).toMatchObject([{ workdays: 7 }])
    // The other open request takes its 7 weighted days off the leave left as well.
    expect(previewLeaveRequest(db, annaUser, '2026-11-02', '2026-11-02', today)).toMatchObject({ workdays: 1, availableAfter: 22 })
  })

  it('lets a joiner\'s closure on 24 and 31 December use half a day each', () => {
    setLeaveCounting(db, 1, { christmasEveHalfLeave: true })
    const dora = createEmployee(db, provider, 1, { name: 'Dora', shortName: '', weeklyMinutes: 2340, validFrom: '2026-12-01', vacationDays: 2.5 })
    createClosure(db, provider, 1, { startDate: '2026-12-24', endDate: '2026-12-31', label: 'Weihnachten', mode: 'vacation' })
    // 24 (½), 28, 29 fit into 2.5 days; 30 and 31 become closure days.
    expect(loadEntries(db, { employeeId: dora, from: '2026-12-24', to: '2026-12-31' }).map(entry => [entry.date, entry.codeKey]))
      .toEqual([['2026-12-24', 'vacation'], ['2026-12-28', 'vacation'], ['2026-12-29', 'vacation'],
        ['2026-12-30', 'closure_day'], ['2026-12-31', 'closure_day']])
    expect(getLeaveAccount(db, dora, 2026, '2026-12-01').account.available).toBe(0)
  })

  it('skips a joiner\'s whole closure day that no longer fits, so 31 December still takes the half day left', () => {
    setLeaveCounting(db, 1, { christmasEveHalfLeave: true })
    const dora = createEmployee(db, provider, 1, { name: 'Dora', shortName: '', weeklyMinutes: 2340, validFrom: '2026-12-01', vacationDays: 3 })
    createClosure(db, provider, 1, { startDate: '2026-12-24', endDate: '2026-12-31', label: 'Weihnachten', mode: 'vacation' })
    // 24 (½), 28, 29 use 2.5 days; 30 does not fit any more, 31 (½) does.
    expect(loadEntries(db, { employeeId: dora, from: '2026-12-24', to: '2026-12-31' }).map(entry => [entry.date, entry.codeKey]))
      .toEqual([['2026-12-24', 'vacation'], ['2026-12-28', 'vacation'], ['2026-12-29', 'vacation'],
        ['2026-12-30', 'closure_day'], ['2026-12-31', 'vacation']])
    expect(getLeaveAccount(db, dora, 2026, '2026-12-01').account.available).toBe(0)
  })

  it('books 3 days left with whole days without the setting, as before', () => {
    const dora = createEmployee(db, provider, 1, { name: 'Dora', shortName: '', weeklyMinutes: 2340, validFrom: '2026-12-01', vacationDays: 3 })
    createClosure(db, provider, 1, { startDate: '2026-12-24', endDate: '2026-12-31', label: 'Weihnachten', mode: 'vacation' })
    expect(loadEntries(db, { employeeId: dora, from: '2026-12-24', to: '2026-12-31' }).map(entry => [entry.date, entry.codeKey]))
      .toEqual([['2026-12-24', 'vacation'], ['2026-12-28', 'vacation'], ['2026-12-29', 'vacation'],
        ['2026-12-30', 'closure_day'], ['2026-12-31', 'closure_day']])
    expect(getLeaveAccount(db, dora, 2026, '2026-12-01').account.available).toBe(0)
  })

  it('counts a request across the year change with the half 31 December, the leave left in the start year', () => {
    setLeaveModule(db, { enabled: true, plannerIds: [] })
    setLeaveCounting(db, 1, { christmasEveHalfLeave: true })
    setEntitlement(db, 1, anna, 2026, { days: 30, carriedOverDays: 0 })
    setEntitlement(db, krippe, carl, 2026, { days: 30, carriedOverDays: 0 })
    const annaUser = addUser(db, 'anna', 'observer', anna)
    const carlUser = addUser(db, 'carl', 'observer', carl)
    // Mon 28.12.2026 – Fri 8.1.2027: 28–31 December (31st half) and 4, 5, 7, 8 January; 1 and 6 January are holidays in BW.
    expect(previewLeaveRequest(db, annaUser, '2026-12-28', '2027-01-08', today))
      .toEqual({ workdays: 7.5, availableAfter: 26.5, overLimitDates: [] })
    expect(previewLeaveRequest(db, carlUser, '2026-12-28', '2027-01-08', today))
      .toEqual({ workdays: 8, availableAfter: 26, overLimitDates: [] })
    createLeaveRequest(db, annaUser, { from: '2026-12-28', to: '2027-01-08', note: '' }, today)
    expect(listMyLeaveRequests(db, annaUser)).toMatchObject([{ startDate: '2026-12-28', endDate: '2027-01-08', workdays: 7.5 }])
    // A request starting in the new year counts 2027's days only: the 30 days carry into 2027 with 30 left, minus 4.
    expect(previewLeaveRequest(db, carlUser, '2027-01-04', '2027-01-08', today)).toMatchObject({ workdays: 4, availableAfter: 56 })
  })

  it('books a joiner\'s closure with whole days without the setting', () => {
    const dora = createEmployee(db, provider, 1, { name: 'Dora', shortName: '', weeklyMinutes: 2340, validFrom: '2026-12-01', vacationDays: 2.5 })
    createClosure(db, provider, 1, { startDate: '2026-12-24', endDate: '2026-12-31', label: 'Weihnachten', mode: 'vacation' })
    expect(loadEntries(db, { employeeId: dora, from: '2026-12-24', to: '2026-12-31' }).map(entry => entry.codeKey))
      .toEqual(['vacation', 'vacation', 'closure_day', 'closure_day', 'closure_day'])
    expect(getLeaveAccount(db, dora, 2026, '2026-12-01').account.available).toBe(0.5)
  })
})

describe('the leave-counting routes with „Einstellungen für“', () => {
  let auth: typeof import('../../server/utils/auth')
  let getRoute: Route
  let putRoute: Route
  beforeAll(async () => {
    auth = await import('../../server/utils/auth')
    vi.stubGlobal('requirePermission', (...args: Parameters<typeof auth.requirePermission>) => auth.requirePermission(...args))
    getRoute = (await import('../../server/api/leave-counting.get')).default as unknown as Route
    putRoute = (await import('../../server/api/leave-counting.put')).default as unknown as Route
  })

  let other: number
  let provider: SessionUser
  let leitung: SessionUser
  beforeEach(() => {
    routeDb = createTestDb()
    other = addFacility(routeDb, 'Kita Sonne')
    provider = addUser(routeDb, 'traeger', 'provider', null, 1)
    leitung = addUser(routeDb, 'leitung', 'admin', null, 1)
  })
  function event(user: SessionUser, options: { settings?: number; body?: unknown } = {}): H3Event {
    const fake: FakeEvent = {
      headers: {
        [PAGE_FACILITY_HEADER.toLowerCase()]: '1',
        ...(options.settings === undefined ? {} : { [SETTINGS_FACILITY_HEADER.toLowerCase()]: String(options.settings) }),
      },
      context: {},
      session: { user: { id: user.id }, loggedInAt: new Date().toISOString() },
      body: options.body,
    }
    return fake as unknown as H3Event
  }
  async function code(run: () => Promise<unknown>): Promise<string | null> {
    try {
      await run()
      return null
    }
    catch (error) {
      // The guards answer with createError (data.code), facilityExists with a ServiceError (code).
      const { code: own, data } = error as { code?: string; data?: { code?: string } }
      return data?.code ?? own ?? 'unknown'
    }
  }
  const half = { christmasEveHalfLeave: true }

  it('stores the setting for the facility the Träger chose under „Einstellungen für“, not the active one', async () => {
    expect(await putRoute(event(provider, { settings: other, body: half }))).toEqual(half)
    expect(getLeaveCounting(routeDb, other)).toEqual(half)
    expect(getLeaveCounting(routeDb, 1)).toEqual({ christmasEveHalfLeave: false })
    expect(await getRoute(event(provider, { settings: other }))).toEqual(half)
    expect(await getRoute(event(provider))).toEqual({ christmasEveHalfLeave: false })
    // Without the header: the active facility.
    await putRoute(event(provider, { body: half }))
    expect(getLeaveCounting(routeDb, 1)).toEqual(half)
  })

  it('lets the Leitung read its own facility\'s setting (the header is ignored) but not change it (403)', async () => {
    setLeaveCounting(routeDb, 1, half)
    expect(await getRoute(event(leitung, { settings: other }))).toEqual(half)
    expect(await code(() => putRoute(event(leitung, { body: { christmasEveHalfLeave: false } })))).toBe('forbidden')
    expect(getLeaveCounting(routeDb, 1)).toEqual(half)
  })

  it('answers 404 for an unknown chosen facility', async () => {
    expect(await code(() => putRoute(event(provider, { settings: 999, body: half })))).toBe('facility_not_found')
  })
})
