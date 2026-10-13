import { kitaYearLabel, kitaYearMonths } from '../../shared/domain/kitaYear'
import { cellState, facilityCell, groupCell, type OccupancyCell } from '../../shared/domain/occupancy'
import type { OccupancyCellDto, OccupancyDto, OccupancyNameDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { ServiceError } from '../lib/errors'
import { listGroups } from './groups'
import { occupancyChildren } from './schoolChildren'

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
