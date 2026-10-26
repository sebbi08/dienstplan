import { daysInMonth, toIsoDate } from '#shared/domain/dates'
import type { YearCalendarDto } from '#shared/types/api'
import { calendarEventText, calendarLanes, eventRowHeight } from './calendarLanes'

type CalendarEmployee = YearCalendarDto['employees'][number]

/** One printed part of the year calendar: a group's people (label null = the facility has no groups at all). */
export interface CalendarPrintSection { key: string; label: string | null; employees: CalendarEmployee[] }

/** What to print: every section one after another, one group (its id), or only the people without a group. */
export type CalendarPrintChoice = 'all' | 'none' | number

/**
 * The sections of the printed year calendar: all groups one after another in their order, then the people without a
 * group ("Ohne Gruppe", only if there are any); or just the chosen one. People belong to their home group, as the
 * screen calendar sorts and colours them. A choice that has no section (no such group, nobody without a group)
 * prints all; see calendarPrintChoice.
 */
export function calendarPrintSections(calendar: YearCalendarDto, choice: CalendarPrintChoice, noGroupLabel: string): CalendarPrintSection[] {
  const sections: CalendarPrintSection[] = calendar.groups.map(group => ({
    key: `group-${group.id}`, label: group.name, employees: calendar.employees.filter(employee => employee.groupId === group.id),
  }))
  const known = new Set(calendar.groups.map(group => group.id))
  const rest = calendar.employees.filter(employee => employee.groupId === null || !known.has(employee.groupId))
  if (rest.length || !sections.length) sections.push({ key: 'no-group', label: sections.length ? noGroupLabel : null, employees: rest })
  const chosen = sections.find(section => section.key === (choice === 'none' ? 'no-group' : `group-${choice}`))
  return chosen ? [chosen] : sections
}

/** The print choice from "?group=" ("none" or a group id); one that would print nothing of its own is "all". */
export function calendarPrintChoice(calendar: YearCalendarDto, query: unknown): CalendarPrintChoice {
  if (query === 'none') {
    const known = new Set(calendar.groups.map(group => group.id))
    const withoutGroup = calendar.employees.some(employee => employee.groupId === null || !known.has(employee.groupId))
    return withoutGroup && calendar.groups.length ? 'none' : 'all'
  }
  const id = Number(query)
  return calendar.groups.some(group => group.id === id) ? id : 'all'
}

/** Options of the print group select: all, each group with people, and "Ohne Gruppe" if anyone has no group. */
export function calendarPrintItems(calendar: YearCalendarDto, allLabel: string, noGroupLabel: string): { label: string; value: string }[] {
  return [
    { label: allLabel, value: 'all' },
    ...calendar.groups.map(group => ({ label: group.name, value: String(group.id) })),
    ...(calendarPrintChoice(calendar, 'none') === 'none' ? [{ label: noGroupLabel, value: 'none' }] : []),
  ]
}

/**
 * Print sizes in CSS px (96 dpi), measured in Chrome's print layout: A4 landscape with the page's 6 mm margins leaves
 * 748 px. A month costs its compact day header (22), borders and the gap below (monthFixed), its appointments row and
 * per person the printed row height. The page header is title and legend on one line.
 */
export const CALENDAR_PRINT = {
  pageHeight: 748, safety: 8, header: 28, monthFixed: 27, minRow: 12, maxRow: 26,
} as const

/** The compact print appointments row height of each month 1–12 (lanes as CalendarMonth lays them out). */
export function monthEventHeights(calendar: YearCalendarDto): number[] {
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1
    const dates = Array.from({ length: daysInMonth(calendar.year, month) }, (_, day) => toIsoDate(calendar.year, month, day + 1))
    const events = calendar.events.filter(event => Number(event.date.slice(5, 7)) === month)
    return eventRowHeight(calendarLanes(dates, events, calendarEventText, calendar.autoEvents).laneCount, true)
  })
}

/** Largest printed row height (px) at which these months fit one page, or null if not even the minimum fits. */
function fittingRow(rows: number, eventHeights: number[]): number | null {
  const { pageHeight, safety, header, monthFixed, minRow, maxRow } = CALENDAR_PRINT
  const room = pageHeight - safety - header - eventHeights.reduce((sum, height) => sum + monthFixed + height, 0)
  const row = Math.floor(room / (eventHeights.length * Math.max(1, rows)))
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
