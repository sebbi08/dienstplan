import { describe, expect, it } from 'vitest'
import type { CalendarEventDto, YearCalendarDto } from '../../shared/types/api'
import { calendarEventText, eventRowHeight, LANE_HEIGHT, PRINT_LANE_HEIGHT } from '../../app/utils/calendarLanes'
import {
  CALENDAR_PRINT, calendarPrintChoice, calendarPrintItems, calendarPrintLayout, calendarPrintSections, monthEventHeights,
} from '../../app/utils/calendarPrint'

const event = (id: number, date: string, title: string, start: number | null = null, end: number | null = null): CalendarEventDto =>
  ({ id, date, start, end, title, visibleToStaff: true })

function calendar(employees: YearCalendarDto['employees'], groups: YearCalendarDto['groups'] = [], events: CalendarEventDto[] = []): YearCalendarDto {
  return { year: 2026, employees, groups, events, autoEvents: {} } as unknown as YearCalendarDto
}
const person = (id: number, groupId: number | null) => ({ id, name: `P${id}`, groupId, color: null })

describe('calendarEventText', () => {
  it('writes the day, the time if any and the title', () => {
    expect(calendarEventText(event(1, '2026-01-07', 'Elternabend'))).toBe('7. Elternabend')
    expect(calendarEventText(event(1, '2026-01-16', 'Infogespräch', 900, 960))).toBe('16. 15:00–16:00 Infogespräch')
    expect(calendarEventText(event(1, '2026-01-16', 'Team', 540))).toBe('16. 9:00 Team')
  })
})

describe('eventRowHeight', () => {
  it('gives at least one line and one line per lane, compact in print', () => {
    expect(eventRowHeight(0)).toBe(LANE_HEIGHT + 4)
    expect(eventRowHeight(3)).toBe(3 * LANE_HEIGHT + 4)
    expect(eventRowHeight(1, true)).toBe(PRINT_LANE_HEIGHT + 2)
    expect(eventRowHeight(2, true)).toBe(2 * PRINT_LANE_HEIGHT + 2)
  })
})

describe('monthEventHeights', () => {
  it('counts the lanes of each month (compact print rows)', () => {
    const heights = monthEventHeights(calendar([], [], [event(1, '2026-03-02', 'A'), event(2, '2026-03-02', 'B')]))
    expect(heights).toHaveLength(12)
    expect(heights[2]).toBe(eventRowHeight(2, true))
    expect(heights[0]).toBe(eventRowHeight(1, true))
  })
})

describe('calendarPrintSections', () => {
  const groups = [{ id: 5, name: 'Bären', color: null }, { id: 6, name: 'Mäuse', color: null }]
  const people = [person(1, 5), person(2, 6), person(3, 5), person(4, null), person(7, 99)]

  it('prints all groups in order, then the people without a (known) group', () => {
    expect(calendarPrintSections(calendar(people, groups), 'all', 'Ohne Gruppe').map(s => [s.label, s.employees.map(e => e.id)]))
      .toEqual([['Bären', [1, 3]], ['Mäuse', [2]], ['Ohne Gruppe', [4, 7]]])
  })

  it('puts every employee into exactly one section', () => {
    const ids = calendarPrintSections(calendar(people, groups), 'all', 'Ohne Gruppe').flatMap(s => s.employees.map(e => e.id))
    expect(ids).toHaveLength(people.length)
    expect(new Set(ids)).toEqual(new Set(people.map(p => p.id)))
  })

  it('prints only the chosen group or the people without a group', () => {
    expect(calendarPrintSections(calendar(people, groups), 6, 'Ohne Gruppe').map(s => s.label)).toEqual(['Mäuse'])
    expect(calendarPrintSections(calendar(people, groups), 'none', 'Ohne Gruppe').map(s => s.label)).toEqual(['Ohne Gruppe'])
  })

  it('leaves out the section without a group when everyone has one, and has one unnamed section without groups', () => {
    expect(calendarPrintSections(calendar(people.slice(0, 3), groups), 'all', 'Ohne Gruppe').map(s => s.label)).toEqual(['Bären', 'Mäuse'])
    expect(calendarPrintSections(calendar([person(1, null)]), 'all', 'Ohne Gruppe').map(s => s.label)).toEqual([null])
  })
})

describe('calendarPrintChoice and calendarPrintItems', () => {
  const groups = [{ id: 5, name: 'Bären', color: null }]

  it('takes a known group or "none", and falls back to all for a stale or unknown choice', () => {
    const value = calendar([person(1, 5), person(2, null)], groups)
    expect(calendarPrintChoice(value, '5')).toBe(5)
    expect(calendarPrintChoice(value, 'none')).toBe('none')
    expect(calendarPrintChoice(value, '8')).toBe('all')
    expect(calendarPrintChoice(value, undefined)).toBe('all')
    expect(calendarPrintChoice(calendar([person(1, 5)], groups), 'none')).toBe('all')
  })

  it('offers "Ohne Gruppe" only when someone has no group', () => {
    const items = (value: YearCalendarDto) => calendarPrintItems(value, 'Alle', 'Ohne Gruppe').map(item => item.value)
    expect(items(calendar([person(1, 5), person(2, null)], groups))).toEqual(['all', '5', 'none'])
    expect(items(calendar([person(1, 5)], groups))).toEqual(['all', '5'])
  })
})

describe('calendarPrintLayout', () => {
  const quiet = Array.from({ length: 12 }, () => eventRowHeight(1, true))
  const { pageHeight, safety, header, monthFixed, minRow, maxRow } = CALENDAR_PRINT
  /** Printed height of these months with that many people (see CALENDAR_PRINT, measured in Chrome). */
  const used = (rows: number, rowHeight: number, heights: number[]) =>
    header + heights.reduce((sum, height) => sum + monthFixed + height + rows * rowHeight, 0)

  it('fits half a year on a page for a small group, with rows never above the maximum', () => {
    expect(calendarPrintLayout(2, quiet)).toEqual({ monthsPerPage: 6, rowHeight: maxRow })
  })

  it('fits half a year of up to six people at rows of at least the minimum', () => {
    for (const rows of [3, 4, 5, 6]) {
      const layout = calendarPrintLayout(rows, quiet)
      expect(layout.monthsPerPage).toBe(6)
      expect(layout.rowHeight).toBeGreaterThanOrEqual(minRow)
      expect(used(rows, layout.rowHeight, quiet.slice(0, 6))).toBeLessThanOrEqual(pageHeight - safety)
    }
  })

  it('takes the fuller half: a month with several appointment lines lowers the rows of the whole year', () => {
    const busy = quiet.map((height, index) => (index === 8 ? eventRowHeight(4, true) : height))
    const layout = calendarPrintLayout(4, busy)
    expect(layout.rowHeight).toBeLessThan(calendarPrintLayout(4, quiet).rowHeight)
    expect(used(4, layout.rowHeight, busy.slice(6, 12))).toBeLessThanOrEqual(pageHeight - safety)
  })

  it('falls back to a quarter per page when six months do not fit at the minimum row height', () => {
    const rows = 7
    expect(used(rows, minRow, quiet.slice(0, 6))).toBeGreaterThan(pageHeight - safety)
    const layout = calendarPrintLayout(rows, quiet)
    expect(layout.monthsPerPage).toBe(3)
    expect(layout.rowHeight).toBeGreaterThanOrEqual(minRow)
    expect(used(rows, layout.rowHeight, quiet.slice(0, 3))).toBeLessThanOrEqual(pageHeight - safety)
  })
})
