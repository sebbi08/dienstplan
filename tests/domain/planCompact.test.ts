import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dayInfoLines, noticesSummary, notificationCounts, readInfoHidden, writeInfoHidden } from '../../app/utils/planCompact'
import { PRINT_MIN_ZOOM, PRINT_PAGE_WIDTH, PRINT_WIDTHS, planColumnKinds, printLayout, type PrintColumnKind } from '../../app/utils/planPrint'
import { printFileName } from '../../app/utils/printFileName'
import type { CalendarEventDto, ReleaseNotificationStatusDto } from '../../shared/types/api'

const source = (path: string) => readFileSync(new URL(`../../app/${path}`, import.meta.url), 'utf8')

/** A browser storage stand-in: `fail` makes every access throw (private mode, blocked site data). */
function stubStorage(fail = false) {
  const store = new Map<string, string>()
  const guard = <T>(run: () => T) => () => {
    if (fail) throw new Error('blocked')
    return run()
  }
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => guard(() => store.get(key) ?? null)(),
    setItem: (key: string, value: string) => guard(() => void store.set(key, value))(),
    removeItem: (key: string) => guard(() => void store.delete(key))(),
  })
  return store
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('„Info-Spalten ausblenden“', () => {
  it('is remembered per device and starts shown', () => {
    const store = stubStorage()
    expect(readInfoHidden()).toBe(false)
    writeInfoHidden(true)
    expect(readInfoHidden()).toBe(true)
    expect([...store.keys()]).toEqual(['dienstplan.planInfoHidden'])
    writeInfoHidden(false)
    expect(readInfoHidden()).toBe(false)
    expect(store.size).toBe(0)
  })

  it('works without storage: the columns show and nothing throws', () => {
    stubStorage(true)
    expect(readInfoHidden()).toBe(false)
    expect(() => writeInfoHidden(true)).not.toThrow()
    vi.stubGlobal('localStorage', undefined)
    expect(readInfoHidden()).toBe(false)
    expect(() => writeInfoHidden(false)).not.toThrow()
  })

  it('leaves a marker with what the hidden columns hold: Info texts, appointments, automatic events', () => {
    const event: CalendarEventDto = { id: 1, date: '2026-11-05', endDate: null, start: 1140, end: 1260, title: 'Elternabend', visibility: 'all', groupIds: [], employeeIds: [] }
    expect(dayInfoLines({ date: '2026-11-05', info1: 'Ausflug', info2: '', events: [event], autoEvents: ['Geburtstag Anna'] }))
      .toEqual(['Info 1: Ausflug', 'Elternabend 19:00–21:00', 'Geburtstag Anna'])
    expect(dayInfoLines({ date: '2026-11-06', info1: '', info2: '', events: [], autoEvents: [] })).toEqual([])
  })
})

describe('the notices line above the plan', () => {
  const row = (employeeId: number, readAt: string | null, hasAccount = true): ReleaseNotificationStatusDto =>
    ({ employeeId, name: `P${employeeId}`, readAt, hasAccount })

  it('counts who was told, who has not read it and who has no account', () => {
    expect(notificationCounts([row(1, null), row(2, '2026-11-27T10:00:00Z'), row(3, null, false), row(4, null)]))
      .toEqual({ total: 4, unread: 2, noAccount: 1 })
    expect(notificationCounts([])).toEqual({ total: 0, unread: 0, noAccount: 0 })
  })

  it('sums up „Was noch fehlt“, the release and the notifications in one line, leaving out what has nothing to say', () => {
    expect(noticesSummary({
      setupOpen: 2, release: { at: '27.11.2026, 08:44', by: 'Leitung' }, notifications: { total: 5, unread: 2, noAccount: 1 },
    })).toEqual(['Was noch fehlt: 2 Punkte', 'Freigegeben am 27.11.2026, 08:44 von Leitung', 'Benachrichtigt: 5 (2 ungelesen, 2 gelesen, 1 ohne Konto)'])
    expect(noticesSummary({ setupOpen: 1, release: null, notifications: null })).toEqual(['Was noch fehlt: 1 Punkt'])
    expect(noticesSummary({ setupOpen: 0, release: null, notifications: { total: 0, unread: 0, noAccount: 0 } })).toEqual([])
    expect(noticesSummary({ setupOpen: 0, release: null, notifications: { total: 3, unread: 0, noAccount: 0 } })).toEqual(['Benachrichtigt: 3 (3 gelesen)'])
  })
})

describe('the compact plan page', () => {
  const page = source('pages/plan/[year]/[month].vue')

  it('keeps the setup line, the notifications and the to-dos off the page body and the day overview beside the plan', () => {
    expect(page).not.toContain('<PlanSetupNotice')
    expect(page).not.toContain('<PlanReleaseNotifications')
    expect(page).toContain('<PlanNoticesLine v-if="isAdmin"')
    expect(page).toContain('<USlideover')
    expect(page).toMatch(/<USlideover[\s\S]*<PlanDayOverviewPanel[\s\S]*embedded/)
    // The toolbar and the group filter share the header row.
    expect(page).toMatch(/<PlanHeader[\s\S]*<PlanToolbar[\s\S]*inline[\s\S]*<USelect[\s\S]*<\/PlanHeader>/)
  })

  it('shows Info texts in two lines with the whole text on click, and whole in print', () => {
    expect(source('components/plan/PlanInfoText.vue')).toContain('line-clamp-2 print:line-clamp-none')
    expect(source('components/plan/PlanInfoField.vue')).toContain('focused.value ? full : Math.min(full, limit)')
    expect(source('components/plan/PlanGrid.vue')).toContain('<PlanInfoText v-else-if="note.value" :text="note.value" />')
  })
})

describe('the plan printout on A4 landscape', () => {
  const kinds = (employees: number[], springer = 0): PrintColumnKind[] => planColumnKinds([
    ...employees.map((count, index) => ({ employees: Array.from({ length: count }), groupId: index + 1 })),
    ...(springer ? [{ employees: Array.from({ length: springer }), groupId: null }] : []),
  ])

  it('lays out the columns as the plan does: a group\'s people, then its „anwesend“ column', () => {
    expect(kinds([2, 1], 1)).toEqual(['employee', 'employee', 'attendance', 'employee', 'attendance', 'employee'])
    expect(planColumnKinds([{ employees: [1, 2, 3], groupId: null }])).toEqual(['employee', 'employee', 'employee'])
  })

  it('prints a small plan in one part at full size', () => {
    const layout = printLayout(kinds([3, 3], 1))
    expect(layout.parts).toEqual([{ from: 0, to: 9, withInfo: true, width: expect.any(Number) }])
    expect(layout.zoom).toBe(1)
  })

  it('scales a plan a little wider than the page down to the page width', () => {
    const layout = printLayout(kinds([4, 4, 2]))
    expect(layout.parts).toHaveLength(1)
    expect(layout.parts[0]!.width).toBeGreaterThan(PRINT_PAGE_WIDTH)
    expect(layout.zoom).toBeCloseTo(PRINT_PAGE_WIDTH / layout.parts[0]!.width)
    expect(layout.zoom).toBeGreaterThanOrEqual(PRINT_MIN_ZOOM)
  })

  it('splits a 25-person plan into two readable parts: every column once, „anwesend“ never cut off, Info in the last', () => {
    const columns = kinds([8, 8, 6], 3)
    const layout = printLayout(columns)
    expect(layout.parts).toHaveLength(2)
    expect(layout.parts[0]!.from).toBe(0)
    expect(layout.parts[0]!.to).toBe(layout.parts[1]!.from)
    expect(layout.parts[1]!.to).toBe(columns.length)
    expect(layout.parts.map(part => part.withInfo)).toEqual([false, true])
    expect(columns[layout.parts[1]!.from]).toBe('employee')
    expect(layout.zoom).toBeGreaterThanOrEqual(PRINT_MIN_ZOOM)
    for (const part of layout.parts) expect(part.width * layout.zoom).toBeLessThanOrEqual(PRINT_PAGE_WIDTH + 0.01)
    // The date column comes again in every part.
    const width = (part: { from: number; to: number; withInfo: boolean }) => PRINT_WIDTHS.date
      + columns.slice(part.from, part.to).reduce((sum, kind) => sum + PRINT_WIDTHS[kind], 0) + (part.withInfo ? 2 * PRINT_WIDTHS.info : 0)
    expect(layout.parts.map(part => part.width)).toEqual(layout.parts.map(width))
  })

  it('splits a very wide plan into more parts, each fitting the page', () => {
    const layout = printLayout(kinds([15, 15, 15], 5))
    expect(layout.parts.length).toBeGreaterThan(2)
    expect(layout.zoom).toBeGreaterThanOrEqual(PRINT_MIN_ZOOM)
    for (const part of layout.parts) expect(part.width * layout.zoom).toBeLessThanOrEqual(PRINT_PAGE_WIDTH + 0.01)
  })

  it('prints each part from a new page with the date column and the heading again', () => {
    const print = source('pages/print/[year]/[month].vue')
    expect(print).toContain('break-before-page')
    expect(print).toContain(':print-part="part" :print-zoom="layout!.zoom"')
  })
})

describe('PDF file names', () => {
  it('end in „-intern“ with „Interne Termine mitdrucken“, so the two printouts are not mixed up', () => {
    expect(printFileName(['Dienstplan', 2026, '12', null], false)).toBe('Dienstplan-2026-12')
    expect(printFileName(['Dienstplan', 2026, '12', null], true)).toBe('Dienstplan-2026-12-intern')
    expect(printFileName(['Dienstplan', 2026, '12', 'Bären'], true)).toBe('Dienstplan-2026-12-Baeren-intern')
    expect(printFileName(['Jahreskalender', 2027, undefined], true)).toBe('Jahreskalender-2027-intern')
    expect(printFileName(['Jahreskalender', 2027, 'Füchse'], false)).toBe('Jahreskalender-2027-Fuechse')
  })

  it('is used by the plan\'s and the year calendar\'s print pages with their „internal“ choice', () => {
    expect(source('pages/print/[year]/[month].vue')).toContain('printFileName([\'Dienstplan\', year, String(month).padStart(2, \'0\'), groupName.value], internal.value)')
    expect(source('pages/admin/print/calendar/[year].vue')).toContain('printFileName([\'Jahreskalender\', year, name], internal.value)')
  })
})
