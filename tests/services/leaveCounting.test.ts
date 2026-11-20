import { and, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../../server/db/client'
import { facilityEveRules } from '../../server/db/schema'
import { createClosure } from '../../server/services/closures'
import { createEmployee, setEntitlement } from '../../server/services/employees'
import { createFacility } from '../../server/services/facilities'
import { applyToCells } from '../../server/services/entries'
import { facilityHolidayRules, facilityPublicHolidayRules } from '../../server/services/holidayRules'
import { getLeaveAccount, getLeaveOverview } from '../../server/services/leave'
import { getLeaveCounting, halfLeaveOnEves, setLeaveCounting } from '../../server/services/leaveCounting'
import {
  createLeaveRequest, listMyLeaveRequests, listOpenRequests, previewLeaveRequest, setLeaveModule,
} from '../../server/services/leaveRequests'
import { loadEmployees, loadEntries } from '../../server/services/queries'
import { parseIsoDate, todayIso } from '../../shared/domain/dates'
import { holidayIn, isHolidayIn } from '../../shared/domain/holidays'
import { PAGE_FACILITY_HEADER, SETTINGS_FACILITY_HEADER } from '../../shared/domain/pageFacility'
import { isWorkday } from '../../shared/domain/targets'
import type { LeaveCountingDto, SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addUser, codeId, createTestDb, errorCode } from '../helpers/fixtures'
import { sameEveRuleEveryYear } from '../helpers/eveRules'

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

type LeaveInput = Pick<LeaveCountingDto, 'tvoedSue' | 'eveLeave'>
const WHOLE: LeaveInput = { tvoedSue: false, eveLeave: 'whole' }
const HALF: LeaveInput = { tvoedSue: false, eveLeave: 'half' }
const PAID: LeaveInput = { tvoedSue: false, eveLeave: 'paid' }
const TVOED: LeaveInput = { tvoedSue: true, eveLeave: 'whole' }
/** Saving happens on 19.11.2026 unless a test says otherwise (effective year 2026). */
const NOW = new Date('2026-11-19T10:00:00Z')
const at = (iso: string) => new Date(`${iso}T10:00:00Z`)
type Rules = LeaveCountingDto['rules']
const DEFAULT_RULES: Rules = [{ fromYear: 0, mode: 'whole' }, { fromYear: 2026, mode: 'paid' }]

describe('„Wir arbeiten nach TVöD SuE“: 24 and 31 December paid free (per facility)', () => {
  let db: Db
  let provider: SessionUser
  let krippe: number
  let anna: number
  let carl: number
  beforeEach(() => {
    db = createTestDb()
    provider = addUser(db, 'traeger', 'provider')
    krippe = addFacility(db, 'Krippe')
    anna = addEmployee(db, 'Anna', { validFrom: '2025-01-01' })
    carl = addEmployee(db, 'Carl', { facilityId: krippe })
  })
  const vacation = (facilityId: number, employeeId: number, dates: string[]) => applyToCells(
    db, provider, facilityId, dates.map(date => ({ employeeId, date })), 'replace', { kind: 'code', codeId: codeId(db, 'vacation') },
  )

  it('is on by default for existing (from 2026) and new facilities (from the year of creation), whole leave day before', () => {
    expect(getLeaveCounting(db, 1, NOW)).toEqual({ ...TVOED, effectiveYear: 2026, rules: DEFAULT_RULES })
    expect(getLeaveCounting(db, krippe).rules).toEqual([{ fromYear: 0, mode: 'whole' }, { fromYear: parseIsoDate(todayIso()).year, mode: 'paid' }])
    const hort = createFacility(db, 'Hort', 'BW', '2028-03-01').id
    expect(getLeaveCounting(db, hort).rules).toEqual([{ fromYear: 0, mode: 'whole' }, { fromYear: 2028, mode: 'paid' }])
    expect(getLeaveCounting(db, 1, at('2026-12-24')).effectiveYear).toBe(2027)
    expect(errorCode(() => setLeaveCounting(db, 999, HALF, provider, NOW))).toBe('facility_not_found')
  })

  it('a past year (2025) keeps its whole leave day, 2026 is paid free', () => {
    setEntitlement(db, 1, anna, 2025, { days: 30, carriedOverDays: 0 })
    vacation(1, anna, ['2025-12-23', '2025-12-24', '2025-12-31', '2026-12-24'])
    expect(getLeaveAccount(db, anna, 2025, '2025-10-01').account).toMatchObject({ planned: 3, available: 27 })
    const [record] = loadEmployees(db, 1)
    expect(isWorkday(record!.info, '2025-12-24')).toBe(true)
    expect(isWorkday(record!.info, '2026-12-24')).toBe(false)
    expect(getLeaveAccount(db, anna, 2026, today).account.planned).toBe(0)
  })

  it('writes a change from the effective year on; earlier years keep their rule (also a half day)', () => {
    db.update(facilityEveRules).set({ mode: 'half' }).where(and(eq(facilityEveRules.facilityId, 1), eq(facilityEveRules.fromYear, 0))).run()
    setEntitlement(db, 1, anna, 2025, { days: 30, carriedOverDays: 0 })
    vacation(1, anna, ['2025-12-24', '2025-12-31', '2026-12-24', '2027-12-24'])
    expect(getLeaveAccount(db, anna, 2025, '2025-10-01').account.planned).toBe(1)
    expect(getLeaveAccount(db, anna, 2026, today).account.planned).toBe(0)
    // Whole leave day chosen in 2027: 2025 stays half, 2026 stays paid free, 2027 counts whole.
    const saved = setLeaveCounting(db, 1, WHOLE, provider, at('2027-02-01'))
    expect(saved).toMatchObject({ ...WHOLE, effectiveYear: 2027 })
    expect(saved.rules).toEqual([{ fromYear: 0, mode: 'half' }, { fromYear: 2026, mode: 'paid' }, { fromYear: 2027, mode: 'whole' }])
    expect(getLeaveAccount(db, anna, 2025, '2025-10-01').account.planned).toBe(1)
    expect(getLeaveAccount(db, anna, 2026, today).account.planned).toBe(0)
    expect(getLeaveAccount(db, anna, 2027, today).account.planned).toBe(1)
    // A second change in the same year replaces that year's entry.
    expect(setLeaveCounting(db, 1, HALF, provider, at('2027-06-01')).rules.at(-1)).toEqual({ fromYear: 2027, mode: 'half' })
    expect(getLeaveAccount(db, anna, 2027, today).account.planned).toBe(0.5)
  })

  it('switching off in 2027 keeps 2026 paid free', () => {
    setEntitlement(db, 1, anna, 2026, { days: 30, carriedOverDays: 0 })
    vacation(1, anna, ['2026-12-24', '2026-12-31', '2027-12-24'])
    setLeaveCounting(db, 1, WHOLE, provider, at('2027-03-01'))
    expect(getLeaveAccount(db, anna, 2026, today).account.planned).toBe(0)
    const [record] = loadEmployees(db, 1)
    expect(isWorkday(record!.info, '2026-12-24')).toBe(false)
    expect(isWorkday(record!.info, '2027-12-24')).toBe(true)
  })

  it('switching on after 24.12.2026 starts in 2027; 2026 keeps its whole leave day', () => {
    setLeaveCounting(db, 1, WHOLE, provider, NOW)
    setEntitlement(db, 1, anna, 2026, { days: 30, carriedOverDays: 0 })
    vacation(1, anna, ['2026-12-24', '2026-12-31', '2027-12-24'])
    expect(getLeaveAccount(db, anna, 2026, today).account.planned).toBe(2)
    const saved = setLeaveCounting(db, 1, TVOED, provider, at('2026-12-28'))
    expect(saved).toMatchObject({ effectiveYear: 2027 })
    expect(saved.rules).toEqual([{ fromYear: 0, mode: 'whole' }, { fromYear: 2026, mode: 'whole' }, { fromYear: 2027, mode: 'paid' }])
    expect(getLeaveAccount(db, anna, 2026, today).account.planned).toBe(2)
    expect(isWorkday(loadEmployees(db, 1)[0]!.info, '2027-12-24')).toBe(false)
    // TVöD off but „bezahlt frei“: still paid free (the 2027 entry is rewritten, nothing earlier).
    expect(setLeaveCounting(db, 1, PAID, provider, at('2027-05-01')).rules.at(-1)).toEqual({ fromYear: 2027, mode: 'paid' })
    // The half day the form keeps for without TVöD does not reach back either.
    expect(halfLeaveOnEves(db, 1)).toEqual(getLeaveCounting(db, 1).rules)
  })

  it('books closures on the freed days only from the effective year on; past years stay untouched', () => {
    createClosure(db, provider, 1, { startDate: '2026-12-21', endDate: '2027-01-08', label: 'Weihnachten', mode: 'vacation' })
    createClosure(db, provider, 1, { startDate: '2027-12-20', endDate: '2027-12-31', label: 'Weihnachten 2027', mode: 'vacation' })
    const onEves = () => loadEntries(db, { employeeId: anna }).filter(entry => /-12-(24|31)$/.test(entry.date)).map(entry => entry.date)
    expect(onEves()).toEqual([])
    setLeaveCounting(db, 1, WHOLE, provider, at('2027-03-01'))
    expect(onEves()).toEqual(['2027-12-24', '2027-12-31'])
  })

  it('on: 24 and 31 December cost no leave and count as paid free days (no target hours, a holiday in the plan)', () => {
    setEntitlement(db, 1, anna, 2026, { days: 30, carriedOverDays: 0 })
    vacation(1, anna, ['2026-12-23', '2026-12-24', '2026-12-28', '2026-12-31'])
    expect(getLeaveAccount(db, anna, 2026, today)).toMatchObject({
      account: { planned: 2, available: 28 },
      // 24 to 27 December are free days now: 23 and 28 December are one period.
      ranges: [{ from: '2026-12-23', to: '2026-12-28', days: 2 }],
    })
    const [record] = loadEmployees(db, 1)
    expect(record!.info.holidays).toEqual({ state: 'BW', assumptionDay: true, eveRules: [{ fromYear: 0, mode: 'whole' }, { fromYear: 2026, mode: 'paid' }] })
    expect(isWorkday(record!.info, '2026-12-24')).toBe(false)
    expect(isWorkday(record!.info, '2026-12-31')).toBe(false)
    expect(isWorkday(record!.info, '2026-12-30')).toBe(true)
    expect(holidayIn('2026-12-24', facilityHolidayRules(db, 1))).toBe('christmas_eve')
    // No public holidays: the children's care days and the legal checks do not see them.
    expect(isHolidayIn('2026-12-24', facilityPublicHolidayRules(db, 1))).toBe(false)
  })

  it('off with „bezahlt frei“: the same as on; with a whole or half leave day: no free day', () => {
    setEntitlement(db, 1, anna, 2026, { days: 30, carriedOverDays: 0 })
    vacation(1, anna, ['2026-12-24', '2026-12-31'])
    const available = () => getLeaveAccount(db, anna, 2026, today).account.available
    expect(available()).toBe(30)
    setLeaveCounting(db, 1, PAID, provider, NOW)
    expect(available()).toBe(30)
    expect(isWorkday(loadEmployees(db, 1)[0]!.info, '2026-12-24')).toBe(false)
    setLeaveCounting(db, 1, WHOLE, provider, NOW)
    expect(available()).toBe(28)
    expect(isWorkday(loadEmployees(db, 1)[0]!.info, '2026-12-24')).toBe(true)
    setLeaveCounting(db, 1, HALF, provider, NOW)
    expect(available()).toBe(29)
  })
})

describe('24 and 31 December as half a leave day (per facility, without the TVöD switch)', () => {
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
    // These cases are about the facility's own choice: no TVöD in either facility.
    sameEveRuleEveryYear(db)
  })
  const vacation = (facilityId: number, employeeId: number, dates: string[]) => applyToCells(
    db, provider, facilityId, dates.map(date => ({ employeeId, date })), 'replace', { kind: 'code', codeId: codeId(db, 'vacation') },
  )

  it('is a whole day by default and is stored per facility', () => {
    expect(getLeaveCounting(db, 1)).toMatchObject(WHOLE)
    expect(setLeaveCounting(db, 1, HALF, provider, NOW)).toMatchObject(HALF)
    expect(getLeaveCounting(db, krippe)).toMatchObject(WHOLE)
    expect(errorCode(() => getLeaveCounting(db, 999))).toBe('facility_not_found')
  })

  it('counts the leave account and its periods with the home facility\'s setting, also the carry-over', () => {
    setLeaveCounting(db, 1, HALF, provider, NOW)
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
    setLeaveCounting(db, 1, WHOLE, provider, NOW)
    expect(getLeaveAccount(db, anna, 2026, today).account.available).toBe(26)
    expect(getLeaveAccount(db, anna, 2027, today).account.carriedOver).toBe(26)
  })

  it('counts the days of a leave request and the leave left after it with the setting', () => {
    setLeaveModule(db, { enabled: true, plannerIds: [] })
    setLeaveCounting(db, 1, HALF, provider, NOW)
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
    setLeaveCounting(db, 1, HALF, provider, NOW)
    const dora = createEmployee(db, provider, 1, { name: 'Dora', shortName: '', weeklyMinutes: 2340, validFrom: '2026-12-01', vacationDays: 2.5 })
    createClosure(db, provider, 1, { startDate: '2026-12-24', endDate: '2026-12-31', label: 'Weihnachten', mode: 'vacation' })
    // 24 (½), 28, 29 fit into 2.5 days; 30 and 31 become closure days.
    expect(loadEntries(db, { employeeId: dora, from: '2026-12-24', to: '2026-12-31' }).map(entry => [entry.date, entry.codeKey]))
      .toEqual([['2026-12-24', 'vacation'], ['2026-12-28', 'vacation'], ['2026-12-29', 'vacation'],
        ['2026-12-30', 'closure_day'], ['2026-12-31', 'closure_day']])
    expect(getLeaveAccount(db, dora, 2026, '2026-12-01').account.available).toBe(0)
  })

  it('skips a joiner\'s whole closure day that no longer fits, so 31 December still takes the half day left', () => {
    setLeaveCounting(db, 1, HALF, provider, NOW)
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
    setLeaveCounting(db, 1, HALF, provider, NOW)
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
  const half = HALF

  it('stores the setting for the facility the Träger chose under „Einstellungen für“, not the active one', async () => {
    expect(await putRoute(event(provider, { settings: other, body: half }))).toMatchObject(half)
    expect(getLeaveCounting(routeDb, other)).toMatchObject(half)
    expect(getLeaveCounting(routeDb, 1)).toMatchObject(TVOED)
    expect(await getRoute(event(provider, { settings: other }))).toMatchObject(half)
    expect(await getRoute(event(provider))).toMatchObject(TVOED)
    // Without the header: the active facility.
    await putRoute(event(provider, { body: half }))
    expect(getLeaveCounting(routeDb, 1)).toMatchObject(half)
  })

  it('lets the Leitung read its own facility\'s setting (the header is ignored) but not change it (403)', async () => {
    setLeaveCounting(routeDb, 1, half, provider, NOW)
    expect(await getRoute(event(leitung, { settings: other }))).toMatchObject(half)
    expect(await code(() => putRoute(event(leitung, { body: WHOLE })))).toBe('forbidden')
    expect(getLeaveCounting(routeDb, 1)).toMatchObject(half)
  })

  it('answers 404 for an unknown chosen facility', async () => {
    expect(await code(() => putRoute(event(provider, { settings: 999, body: half })))).toBe('facility_not_found')
  })
})
