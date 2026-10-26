import { daysInMonth, toIsoDate } from '#shared/domain/dates'
import type { YearCalendarDto } from '#shared/types/api'
import { calendarEventText, calendarLanes, eventRowHeight } from './calendarLanes'

type CalendarEmployee = YearCalendarDto['employees'][number]

/** One printed part of the year calendar: a group's people (label null = the facility has no groups at all). */
export interface CalendarPrintSection { key: string; label: string | null; employees: CalendarEmployee[] }

/**
 * The sections of the printed year calendar: one group (`groupId`) or all groups one after another in their order,
 * then the people without a group ("Ohne Gruppe", only if there are any). People belong to their home group, as the
 * screen calendar sorts and colours them. An unknown group id prints all groups.
 */
export function calendarPrintSections(calendar: YearCalendarDto, groupId: number | null, noGroupLabel: string): CalendarPrintSection[] {
  const sections: CalendarPrintSection[] = calendar.groups.map(group => ({
    key: `group-${group.id}`, label: group.name, employees: calendar.employees.filter(employee => employee.groupId === group.id),
  }))
  const chosen = sections.find(section => section.key === `group-${groupId}`)
  if (chosen) return [chosen]
  const known = new Set(calendar.groups.map(group => group.id))
  const rest = calendar.employees.filter(employee => employee.groupId === null || !known.has(employee.groupId))
  if (rest.length || !sections.length) sections.push({ key: 'no-group', label: sections.length ? noGroupLabel : null, employees: rest })
  return sections
}

/**
 * Print sizes in CSS px (96 dpi), measured in Chrome's print layout: A4 landscape with 8 mm margins leaves 733 px.
 * A month costs its day header, border and gap (MONTH_FIXED), its appointments row and per person the row height plus
 * the 1 px top and bottom cell padding that the global print styles force (ROW_EXTRA). The page header (title and
 * legend) gets room for one wrapped line.
 */
export const CALENDAR_PRINT = {
  pageHeight: 733, safety: 16, header: 44, monthFixed: 37, rowExtra: 2, minRow: 12, maxRow: 24,
} as const

/** The appointments row height of each month 1–12 (lanes as CalendarMonth lays them out). */
export function monthEventHeights(calendar: YearCalendarDto): number[] {
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1
    const dates = Array.from({ length: daysInMonth(calendar.year, month) }, (_, day) => toIsoDate(calendar.year, month, day + 1))
    const events = calendar.events.filter(event => Number(event.date.slice(5, 7)) === month)
    return eventRowHeight(calendarLanes(dates, events, calendarEventText, calendar.autoEvents).laneCount)
  })
}

/** Largest row height (px) at which these months fit one page below the header, or null if not even the minimum fits. */
function fittingRow(rows: number, eventHeights: number[]): number | null {
  const { pageHeight, safety, header, monthFixed, rowExtra, minRow, maxRow } = CALENDAR_PRINT
  const room = pageHeight - safety - header - eventHeights.reduce((sum, height) => sum + monthFixed + height, 0)
  const row = Math.floor(room / (eventHeights.length * Math.max(1, rows))) - rowExtra
  return row >= minRow ? Math.min(maxRow, row) : null
}

/**
 * Layout of one section with `rows` people: half a year per page when that fits at a readable row height, else a
 * quarter per page (months are never split; with very many people a month moves to the next page whole).
 */
export function calendarPrintLayout(rows: number, eventHeights: number[]): { monthsPerPage: 6 | 3; rowHeight: number } {
  const chunks = (size: number) => Array.from({ length: 12 / size }, (_, index) => eventHeights.slice(index * size, (index + 1) * size))
  const halves = chunks(6).map(heights => fittingRow(rows, heights))
  if (halves.every(row => row !== null)) return { monthsPerPage: 6, rowHeight: Math.min(...(halves as number[])) }
  const quarters = chunks(3).map(heights => fittingRow(rows, heights) ?? CALENDAR_PRINT.minRow)
  return { monthsPerPage: 3, rowHeight: Math.min(...quarters) }
}
