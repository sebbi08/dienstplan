import type { OccupancyCellDto, OccupancyRowDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { monthTitle } from '~/utils/format'

/** `present` or `present (+fresh)`; "–" for an empty cell. */
export function occupancyCellText(cell: OccupancyCellDto): string {
  const present = cell.present.length
  const fresh = cell.fresh.length
  if (present + fresh === 0) return de.children.noValue
  return fresh ? `${present} (+${fresh})` : String(present)
}

/** The label of a row; the row for children without a group has an empty name. */
export const occupancyRowName = (row: Pick<OccupancyRowDto, 'groupId' | 'name'>): string => (row.groupId === null ? de.occupancy.noGroup : row.name)

/** Spoken description of a cell, so the red ones are recognisable without the colour. */
export function occupancyCellLabel(group: string, month: { year: number; month: number }, cell: OccupancyCellDto): string {
  const parts = [`${group}, ${monthTitle(month.year, month.month)}: ${de.occupancy.count(cell.present.length, cell.fresh.length)}`]
  if (cell.red) parts.push(de.occupancy.overFull)
  if (cell.over > 0) parts.push(de.occupancy.over(cell.over))
  return parts.join(', ')
}

/** Short column header of a month ("Sep"). */
export const occupancyMonthShort = (month: number): string => de.months[month - 1]!.slice(0, 3)
