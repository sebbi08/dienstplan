import { eq } from 'drizzle-orm'
import { parseIsoDate } from '../../shared/domain/dates'
import { facilityCell, groupCell, groupStays, type OccupancyCell, type OccupancyChild } from '../../shared/domain/occupancy'
import { can, type PermissionKey } from '../../shared/domain/permissions'
import type { IsoDate } from '../../shared/domain/types'
import type { CapacityWarningDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { facilities } from '../db/schema'
import { listGroups } from './groups'
import { occupancyChildren } from './schoolChildren'

/**
 * The hint „Bären hat dann 21 von 20 Plätzen“: after a save that puts a child into a group or into the facility (a new
 * child, a group change, a planned one, a contract for a Vormerkung, a leaving taken back), the groups and the facility
 * that are then over their Höchstzahl Kinder in a month the child was not counted in before. It never blocks a save.
 *
 * The months are those of the occupancy (Belegung), counted with its rules, from today's month on; a stay without an
 * end (a child in a group for school children) is looked at for six years.
 */

const HORIZON_MONTHS = 72

/** A month as a running number (year * 12 + month - 1). */
const monthNumber = (iso: IsoDate) => {
  const { year, month } = parseIsoDate(iso)
  return year * 12 + month - 1
}

/** The cells a child counts in: `<groupId>:<month>` per group and `f:<month>` for the facility. */
export type CapacityCells = Set<string>

function cellsOf(child: OccupancyChild | undefined, today: IsoDate): CapacityCells {
  const cells: CapacityCells = new Set()
  if (!child || child.start === null) return cells
  const first = monthNumber(today)
  const last = first + HORIZON_MONTHS - 1
  const add = (from: IsoDate, to: IsoDate | null, key: string) => {
    if (to !== null && to < from) return
    const end = to === null ? last : Math.min(last, monthNumber(to))
    for (let month = Math.max(first, monthNumber(from)); month <= end; month++) cells.add(`${key}:${month}`)
  }
  for (const stay of groupStays(child)) {
    if (stay.groupId !== null) add(stay.from, stay.to, String(stay.groupId))
  }
  add(child.start, child.end, 'f')
  return cells
}

/** The cells the child counts in from today's month on, before a save (none for a child that is still to be created). */
export function capacityCells(db: Db, facilityId: number, childId: number | null, today: IsoDate): CapacityCells {
  if (childId === null) return new Set()
  return cellsOf(occupancyChildren(db, facilityId).children.find(child => child.id === childId), today)
}

/**
 * The warnings after the save, per group (in the groups' order) and then for the facility: the first month the child
 * was added to in which there are more children than places, and the most children in such a month. Only for whoever
 * sees the places (children.manage: Träger and Leitung); everybody else gets none.
 */
export function capacityWarnings(
  db: Db, viewer: { permissions: ReadonlySet<PermissionKey> }, facilityId: number, childId: number, before: CapacityCells, today: IsoDate,
): CapacityWarningDto[] {
  if (!can(viewer.permissions, 'children.manage')) return []
  const { children } = occupancyChildren(db, facilityId)
  const added = [...cellsOf(children.find(child => child.id === childId), today)].filter(cell => !before.has(cell))
  if (added.length === 0) return []

  const facility = db.select({ name: facilities.name, capacity: facilities.capacity }).from(facilities)
    .where(eq(facilities.id, facilityId)).get()
  const targets: { key: string; kind: CapacityWarningDto['kind']; name: string; capacity: number | null; cell: (year: number, month: number) => OccupancyCell }[] = [
    ...listGroups(db, facilityId).map(group => ({
      key: String(group.id), kind: 'group' as const, name: group.name, capacity: group.capacity,
      cell: (year: number, month: number) => groupCell(children, group.id, year, month),
    })),
    {
      key: 'f', kind: 'facility', name: facility?.name ?? '', capacity: facility?.capacity ?? null,
      cell: (year, month) => facilityCell(children, year, month),
    },
  ]

  const warnings: CapacityWarningDto[] = []
  for (const target of targets) {
    if (target.capacity === null) continue
    const months = added.filter(cell => cell.startsWith(`${target.key}:`)).map(cell => Number(cell.slice(target.key.length + 1)))
      .sort((a, b) => a - b)
    let warning: CapacityWarningDto | null = null
    for (const number of months) {
      const year = Math.floor(number / 12)
      const month = (number % 12) + 1
      const { present, fresh } = target.cell(year, month)
      const count = present.length + fresh.length
      if (count <= target.capacity) continue
      if (warning === null) warning = { kind: target.kind, name: target.name, count, capacity: target.capacity, year, month }
      else warning.count = Math.max(warning.count, count)
    }
    if (warning) warnings.push(warning)
  }
  return warnings
}
