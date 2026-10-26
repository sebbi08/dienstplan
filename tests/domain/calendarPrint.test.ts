import { describe, expect, it } from 'vitest'
import type { CalendarEventDto, YearCalendarDto } from '../../shared/types/api'
import { calendarEventText, eventRowHeight, LANE_HEIGHT } from '../../app/utils/calendarLanes'
import { CALENDAR_PRINT, calendarPrintLayout, calendarPrintSections, monthEventHeights } from '../../app/utils/calendarPrint'

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
  it('gives at least one line and one line per lane', () => {
    expect(eventRowHeight(0)).toBe(LANE_HEIGHT + 4)
    expect(eventRowHeight(1)).toBe(LANE_HEIGHT + 4)
    expect(eventRowHeight(3)).toBe(3 * LANE_HEIGHT + 4)
  })
})

describe('monthEventHeights', () => {
  it('counts the lanes of each month', () => {
    const heights = monthEventHeights(calendar([], [], [event(1, '2026-03-02', 'A'), event(2, '2026-03-02', 'B')]))
    expect(heights).toHaveLength(12)
    expect(heights[2]).toBe(eventRowHeight(2))
    expect(heights[0]).toBe(eventRowHeight(1))
  })
})

describe('calendarPrintSections', () => {
  const groups = [{ id: 5, name: 'Bären', color: null }, { id: 6, name: 'Mäuse', color: null }]
  const people = [person(1, 5), person(2, 6), person(3, 5), person(4, null)]

  it('prints all groups in order, then the people without a group', () => {
    expect(calendarPrintSections(calendar(people, groups), null, 'Ohne Gruppe').map(s => [s.label, s.employees.map(e => e.id)]))
      .toEqual([['Bären', [1, 3]], ['Mäuse', [2]], ['Ohne Gruppe', [4]]])
  })

  it('prints only the chosen group, or all for an unknown id', () => {
    expect(calendarPrintSections(calendar(people, groups), 6, 'Ohne Gruppe').map(s => s.label)).toEqual(['Mäuse'])
    expect(calendarPrintSections(calendar(people, groups), 99, 'Ohne Gruppe')).toHaveLength(3)
  })

  it('leaves out the section without a group when everyone has one, and has one unnamed section without groups', () => {
    expect(calendarPrintSections(calendar(people.slice(0, 3), groups), null, 'Ohne Gruppe').map(s => s.label)).toEqual(['Bären', 'Mäuse'])
    expect(calendarPrintSections(calendar([person(1, null)]), null, 'Ohne Gruppe').map(s => s.label)).toEqual([null])
  })
})

describe('calendarPrintLayout', () => {
  const quiet = Array.from({ length: 12 }, () => eventRowHeight(1))
  const { pageHeight, safety, header, monthFixed, rowExtra, minRow, maxRow } = CALENDAR_PRINT
  /** Height of these months' print with that many rows (what Chrome lays out, see CALENDAR_PRINT). */
  const used = (rows: number, rowHeight: number, heights: number[]) =>
    header + heights.reduce((sum, height) => sum + monthFixed + height + rows * (rowHeight + rowExtra), 0)

  it('fits half a year on a page for a small group, with rows never above the maximum', () => {
    const layout = calendarPrintLayout(2, quiet)
    expect(layout).toEqual({ monthsPerPage: 6, rowHeight: maxRow })
  })

  it('shrinks the rows so that six months still fit, real cell padding included', () => {
    for (const rows of [3, 4]) {
      const layout = calendarPrintLayout(rows, quiet)
      expect(layout.monthsPerPage).toBe(6)
      expect(layout.rowHeight).toBeGreaterThanOrEqual(minRow)
      expect(used(rows, layout.rowHeight, quiet.slice(0, 6))).toBeLessThanOrEqual(pageHeight - safety)
    }
  })

  it('falls back to a quarter per page from five people on', () => {
    expect(calendarPrintLayout(5, quiet).monthsPerPage).toBe(3)
    const layout = calendarPrintLayout(12, quiet)
    expect(layout.monthsPerPage).toBe(3)
    expect(layout.rowHeight).toBeGreaterThanOrEqual(minRow)
    expect(used(12, layout.rowHeight, quiet.slice(0, 3))).toBeLessThanOrEqual(pageHeight - safety)
  })
})
