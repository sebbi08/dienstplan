import { toIsoDate } from '../../shared/domain/dates'
import { kitaYearLabel, kitaYearMonths, kitaYearOf } from '../../shared/domain/kitaYear'
import { cellState, facilityCell, groupCell, type OccupancyCell } from '../../shared/domain/occupancy'
import type { IsoDate } from '../../shared/domain/types'
import type { OccupancyCellDto, OccupancyDto, OccupancyNameDto, UpcomingSchoolChildDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { ServiceError } from '../lib/errors'
import { listGroups } from './groups'
import { activeSchoolChildren, isSchoolStartDue, occupancyChildren } from './schoolChildren'

/** The Kita year `startYear` (September to August) by group and month; 400 invalid_year outside 2000 to 2100. */
export function occupancyTable(db: Db, facilityId: number, startYear: number): OccupancyDto {
  if (!Number.isInteger(startYear) || startYear < 2000 || startYear > 2100) throw new ServiceError(400, 'invalid_year')
  const { children, names, undated, inconsistent } = occupancyChildren(db, facilityId)
  const groups = listGroups(db, facilityId)
  const months = kitaYearMonths(startYear)

  const nameOf = (entry: { childId: number; from: string; to: string | null }): OccupancyNameDto =>
    ({ id: entry.childId, name: names[entry.childId] ?? '', from: entry.from, to: entry.to })
  const toDto = (cell: OccupancyCell, capacity: number | null): OccupancyCellDto => ({
    present: cell.present.map(nameOf),
    fresh: cell.fresh.map(nameOf),
    ...cellState(cell.present.length + cell.fresh.length, capacity),
  })

  const rows: OccupancyDto['rows'] = groups.map(group => ({
    groupId: group.id,
    name: group.name,
    capacity: group.capacity,
    cells: months.map(({ year, month }) => toDto(groupCell(children, group.id, year, month), group.capacity)),
  }))
  const ungrouped = months.map(({ year, month }) => toDto(groupCell(children, null, year, month), null))
  if (ungrouped.some(cell => cell.present.length > 0 || cell.fresh.length > 0)) {
    // The client labels this row ("ohne Gruppe"); the name stays empty.
    rows.push({ groupId: null, name: '', capacity: null, cells: ungrouped })
  }

  const everyGroupHasCapacity = groups.length > 0 && groups.every(group => group.capacity !== null)
  const totalCapacity = everyGroupHasCapacity ? groups.reduce((sum, group) => sum + group.capacity!, 0) : null
  return {
    year: startYear,
    label: kitaYearLabel(startYear),
    months,
    rows,
    total: {
      capacity: totalCapacity,
      cells: months.map(({ year, month }) => toDto(facilityCell(children, year, month), totalCapacity)),
    },
    undated,
    inconsistent,
  }
}

/**
 * The list "Schulkinder zum 1.9.", by school start and name, whether or not the facility deregisters automatically.
 * Of the facility's active contract children without a leaving day it holds
 * - from 1 March on those whose school start comes up to the coming 1 September, each with the group for school
 *   children it is in on that day, if any (so a deferral or the change into such a group is entered in time), and
 * - always those whose school start is reached and who are not in such a group: somebody still has to decide about
 *   them (the automatic leaving takes them, apart from the children `schoolLeavers` leaves out on purpose).
 * A child in a group for school children leaves the list once its school start is reached: it stays for good.
 */
export function upcomingSchoolChildren(db: Db, facilityId: number, today: IsoDate): UpcomingSchoolChildDto[] {
  // The 1 September after today; today's own is a school start that is reached.
  const comingYear = kitaYearOf(today) + 1
  const coming = toIsoDate(comingYear, 9, 1)
  const listsComing = today >= toIsoDate(comingYear, 3, 1)
  return activeSchoolChildren(db, facilityId, today)
    .filter(child => isSchoolStartDue(child, today) || (listsComing && child.schoolStart > today && child.schoolStart <= coming))
    // The children come ordered by name; the sort is stable.
    .sort((a, b) => a.schoolStart.localeCompare(b.schoolStart))
    .map(({ row, schoolStart, schoolGroup }) => ({
      id: row.id,
      name: `${row.firstName} ${row.lastName}`,
      groupId: row.groupId,
      schoolStart,
      pendingSchoolGroup: schoolGroup?.name ?? null,
    }))
}
