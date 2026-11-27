import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../../server/db/client'
import { entries, monthPlans, terminalUnlocks } from '../../server/db/schema'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { createCalendarEvent, type CalendarEventInput } from '../../server/services/calendar'
import { saveBundleOverride } from '../../server/services/permissions'
import { lockChildren, unlockChildren } from '../../server/services/tabletUnlock'
import { setPin } from '../../server/services/terminal'
import { PLAN_EDITOR_QUERY } from '../../shared/domain/tablet'
import type { MonthPlanDto, SessionUser, YearCalendarDto } from '../../shared/types/api'
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
  routes['calendar.get'] = (await import('../../server/api/calendar.get')).default as Handler
  routes['calendar-events/index.post'] = (await import('../../server/api/calendar-events/index.post')).default as Handler
})

/** A request of the user (at the tablet with the unlock token in its session) to the route. */
function call(
  name: string, user: SessionUser,
  request: { token?: string; params?: Record<string, number>; query?: Record<string, string>; body?: unknown } = {},
) {
  const event: FakeEvent = {
    headers: {}, context: {},
    session: { user: { id: user.id }, loggedInAt: new Date().toISOString(), secure: request.token ? { childUnlock: request.token } : undefined },
    params: Object.fromEntries(Object.entries(request.params ?? {}).map(([key, value]) => [key, String(value)])),
    query: request.query ?? {}, body: request.body,
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
  // What only the plan editor's view sends (the „Dienstplan“ tile and the printout never do).
  const editorQuery = { [PLAN_EDITOR_QUERY]: '1' }
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
    // Not editing: the tablet reads the released plan only (none yet), also when the editor's view asks.
    expect(await refusal(() => call('plan/[year]/[month].get', tablet, { token: lenaToken, params: month }))).toBe('month_not_released')
    expect(await refusal(() => call('plan/[year]/[month].get', tablet, { token: lenaToken, params: month, query: editorQuery })))
      .toBe('month_not_released')
    expect(db.select().from(entries).all()).toEqual([])
  })

  it('gives the „Dienstplan“ tile the released plan only, even while an editing unlock holds, and leaves that unlock alone', async () => {
    const token = unlock(lena, '111111')
    await call('terminal/plan-edit.post', tablet, { token })
    await writeCell(tablet, token)
    await call('release.post', tablet, { token, params: month })
    const lastUse = db.select().from(terminalUnlocks).get()!.lastActiveAt
    await new Promise(resolve => setTimeout(resolve, 5))
    // The tile (no `?editor=1`): the tablet's view, no editor data, the unlock not used.
    expect(await call('plan/[year]/[month].get', tablet, { token, params: month })).toMatchObject({ admin: null })
    expect(db.select().from(terminalUnlocks).get()!.lastActiveAt).toBe(lastUse)
    // The editor's view: the draft as the editing person, counted as use.
    expect(await call('plan/[year]/[month].get', tablet, { token, params: month, query: editorQuery })).toMatchObject({ admin: expect.anything() })
    expect(db.select().from(terminalUnlocks).get()!.lastActiveAt).not.toBe(lastUse)
  })

  it('answers the editor\'s view of an editing unlock that ran out with the released plan, not 403', async () => {
    const token = unlock(lena, '111111')
    await call('terminal/plan-edit.post', tablet, { token })
    await writeCell(tablet, token)
    await call('release.post', tablet, { token, params: month })
    // Last use well before the lock time (2 minutes plus grace); the row is still there.
    db.update(terminalUnlocks).set({ lastActiveAt: new Date(Date.now() - 10 * 60_000).toISOString() }).run()
    expect(await call('plan/[year]/[month].get', tablet, { token, params: month, query: editorQuery })).toMatchObject({ admin: null })
    expect(await refusal(() => writeCell(tablet, token))).toBe('tablet_locked')
  })

  it('lets the person edit with their own account once started, and records that account', async () => {
    const token = unlock(lena, '111111')
    expect(await call('terminal/plan-edit.post', tablet, { token })).toMatchObject({ unlocked: true, planEdit: { active: true, canRelease: true } })
    expect(await writeCell(tablet, token)).toMatchObject({ ok: true })
    expect(db.select().from(entries).where(eq(entries.employeeId, mia)).get()).toMatchObject({ updatedBy: leitung.id })
    // The draft with the editor's data, as the Leitung sees it in the office.
    expect(await call('plan/[year]/[month].get', tablet, { token, params: month, query: editorQuery })).toMatchObject({ admin: expect.anything() })
    await call('release.post', tablet, { token, params: month })
    expect(db.select().from(monthPlans).get()).toMatchObject({ releasedBy: leitung.id })
    expect(await call('employees/[id]/children.get', tablet, { token, params: { id: mia } })).toMatchObject({ children: [] })

    // Locked: nothing more, the plan page included.
    lockChildren(db, tablet.id, token)
    expect(await refusal(() => writeCell(tablet, token))).toBe('tablet_locked')
    expect(await refusal(() => call('terminal/plan-edit.post', tablet, { token }))).toBe('tablet_locked')
    // Read as the tablet again: the released plan without the editor's data.
    expect(await call('plan/[year]/[month].get', tablet, { token, params: month, query: editorQuery })).toMatchObject({ admin: null })
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

describe('appointments in the plan: tablet, plan editors and printouts', () => {
  let lena: number
  let mia: number
  let leitung: SessionUser
  let mitarbeiterin: SessionUser
  let tablet: SessionUser
  const month = { year: 2026, month: 12 }
  const editorQuery = { [PLAN_EDITOR_QUERY]: '1' }
  const event = (changes: Partial<CalendarEventInput>): CalendarEventInput => ({
    date: '2026-12-03', endDate: null, start: null, end: null, title: 'Termin', visibility: 'all', groupIds: [], employeeIds: [], ...changes,
  })
  /** The appointment titles of a plan answer, in day order. */
  const titles = (plan: unknown) => (plan as MonthPlanDto).days.flatMap(day => day.events.map(item => item.title))
  const calendarTitles = (calendar: unknown) => (calendar as YearCalendarDto).events.map(item => item.title)
  const plan = (user: SessionUser, query: Record<string, string> = {}, token?: string) =>
    call('plan/[year]/[month].get', user, { token, params: month, query })

  beforeEach(() => {
    db = createTestDb()
    lena = addEmployee(db, 'Lena')
    mia = addEmployee(db, 'Mia')
    setPin(db, 1, lena, '111111')
    setPin(db, 1, mia, '222222')
    leitung = addUser(db, 'lena', 'admin', lena)
    mitarbeiterin = addUser(db, 'mia', 'observer', mia)
    tablet = addUser(db, 'tablet', 'terminal')
    createCalendarEvent(db, 1, event({ date: '2026-12-01', title: 'Für alle' }))
    createCalendarEvent(db, 1, event({ date: '2026-12-02', title: 'Für Mia', visibility: 'employees', employeeIds: [mia] }))
    createCalendarEvent(db, 1, event({ date: '2026-12-03', title: 'Nur Leitung', visibility: 'leaders' }))
  })

  it('shows the tile and the read-only view at the tablet only „Alle“, also while an editing unlock holds', async () => {
    const token = unlockChildren(db, { id: tablet.id, facilityId: 1 }, lena, '111111').token
    await call('terminal/plan-edit.post', tablet, { token })
    await call('release.post', tablet, { token, params: month })
    expect(titles(await plan(tablet, {}, token))).toEqual(['Für alle'])
    expect(titles(await plan(tablet))).toEqual(['Für alle'])
    // The editor's view: the Leitung's own audience while she edits (her rights), never the tile.
    expect(titles(await plan(tablet, editorQuery, token))).toEqual(['Für alle', 'Für Mia', 'Nur Leitung'])
    // Printed from the editor's view: only „Alle“ unless asked for the internal ones.
    expect(titles(await plan(tablet, { ...editorQuery, print: '1' }, token))).toEqual(['Für alle'])
    lockChildren(db, tablet.id, token)
    expect(titles(await plan(tablet, editorQuery, token))).toEqual(['Für alle'])
  })

  it('shows a staff plan editor (plan.edit without calendar.edit) only what is meant for them, at the tablet and in the office', async () => {
    saveBundleOverride(db, mitarbeiterin.id, 'planEdit', 'grant')
    const office = await plan(mitarbeiterin)
    expect(office).toMatchObject({ admin: expect.anything() })
    expect(titles(office)).toEqual(['Für alle', 'Für Mia'])
    const token = unlockChildren(db, { id: tablet.id, facilityId: 1 }, mia, '222222').token
    await call('terminal/plan-edit.post', tablet, { token })
    expect(titles(await plan(tablet, editorQuery, token))).toEqual(['Für alle', 'Für Mia'])
    // Even „internal“ is no wider for someone who does not see all.
    expect(titles(await plan(mitarbeiterin, { print: '1', internal: '1' }))).toEqual(['Für alle'])
  })

  it('prints the plan with only „Alle“ for everybody; the Leitung may add the internal ones', async () => {
    expect(titles(await plan(leitung))).toEqual(['Für alle', 'Für Mia', 'Nur Leitung'])
    expect(titles(await plan(leitung, { print: '1' }))).toEqual(['Für alle'])
    expect(titles(await plan(leitung, { print: '1', internal: '1' }))).toEqual(['Für alle', 'Für Mia', 'Nur Leitung'])
    // „internal“ alone (no print view) changes nothing.
    expect(titles(await plan(leitung, { internal: '1' }))).toEqual(['Für alle', 'Für Mia', 'Nur Leitung'])
    await call('release.post', leitung, { params: month })
    expect(titles(await plan(mitarbeiterin))).toEqual(['Für alle', 'Für Mia'])
    expect(titles(await plan(mitarbeiterin, { print: '1' }))).toEqual(['Für alle'])
    expect(titles(await plan(mitarbeiterin, { print: '1', internal: '1' }))).toEqual(['Für alle'])
    expect(JSON.stringify(await plan(mitarbeiterin, { print: '1', internal: '1' }))).not.toMatch(/Für Mia|Nur Leitung/)
  })

  it('prints the year calendar (rows and list) with only „Alle“ unless the Leitung asks for the internal ones', async () => {
    expect(calendarTitles(await call('calendar.get', leitung, { query: { year: '2026' } }))).toEqual(['Für alle', 'Für Mia', 'Nur Leitung'])
    const printed = await call('calendar.get', leitung, { query: { year: '2026', print: '1' } })
    expect(calendarTitles(printed)).toEqual(['Für alle'])
    expect(JSON.stringify(printed)).not.toMatch(/Für Mia|Nur Leitung/)
    expect(calendarTitles(await call('calendar.get', leitung, { query: { year: '2026', print: '1', internal: '1' } })))
      .toEqual(['Für alle', 'Für Mia', 'Nur Leitung'])
    // Staff have no year calendar print (calendar.edit only).
    expect(await refusal(() => call('calendar.get', mitarbeiterin, { query: { year: '2026', print: '1' } }))).toBe('forbidden')
  })

  it('answers a page from before „Wer sieht den Termin?“ with a clear code', async () => {
    let code: string | undefined
    try {
      await call('calendar-events/index.post', leitung, { body: { date: '2026-12-04', start: null, end: null, title: 'Alt', visibleToStaff: true } })
    }
    catch (error) {
      code = (error as { data?: { code?: string } }).data?.code ?? (error as { code?: string }).code
    }
    expect(code).toBe('event_page_outdated')
  })
})
