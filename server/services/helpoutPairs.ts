import { and, asc, eq, gt, gte, inArray, isNotNull, lt, or } from 'drizzle-orm'
import { todayIso } from '../../shared/domain/dates'
import { can } from '../../shared/domain/permissions'
import type { IsoDate } from '../../shared/domain/types'
import type { HelpoutPairsDto, PairedHelpOutDto, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, entries, facilities, facilityHelpoutPairs } from '../db/schema'
import { ServiceError } from '../lib/errors'

/**
 * Aushilfe zwischen Einrichtungen (help-outs between facilities) needs the Träger's mutual permission for the two
 * facilities (facility_helpout_pairs, one row per pair, the smaller id first). Between the groups of one facility it is
 * always allowed. Without a pair no help-out can be planned between them (a helper column, a duty in a helper's cell, a
 * change of such a duty, a reset to the release), and planned ones give no visibility (the facility's tablet, stamping
 * there); they stay in the plan, so the hours stay right, marked „nicht freigegeben“. The pairs start empty.
 */

/** The pair as stored: the smaller facility id first (every write goes through it). */
export const pairOf = (a: number, b: number): [number, number] => (a < b ? [a, b] : [b, a])

/**
 * The facilities paired with the facility (never itself). Only rows stored as pairOf writes them count (a < b), as in
 * helpOutAllowed: a reversed or self row written outside the service grants nothing.
 */
export function pairedFacilityIds(db: Db, facilityId: number): Set<number> {
  return new Set(db.select().from(facilityHelpoutPairs)
    .where(or(
      and(eq(facilityHelpoutPairs.facilityAId, facilityId), gt(facilityHelpoutPairs.facilityBId, facilityId)),
      and(eq(facilityHelpoutPairs.facilityBId, facilityId), lt(facilityHelpoutPairs.facilityAId, facilityId)),
    )).all()
    .map(row => (row.facilityAId === facilityId ? row.facilityBId : row.facilityAId)))
}

/** Whether help-outs between the two facilities are allowed: always within one facility, between two with their pair. */
export function helpOutAllowed(db: Db, facilityId: number, otherFacilityId: number): boolean {
  if (facilityId === otherFacilityId) return true
  const [a, b] = pairOf(facilityId, otherFacilityId)
  return db.select().from(facilityHelpoutPairs)
    .where(and(eq(facilityHelpoutPairs.facilityAId, a), eq(facilityHelpoutPairs.facilityBId, b))).get() !== undefined
}

/**
 * 403 help_out_not_paired („Aushilfe aus ‹Kita› ist nicht freigegeben“, the helpers' home facility named) unless every
 * one of the employees may help out in the facility: their home facility is it, or paired with it.
 */
export function assertHelpersAllowed(db: Db, facilityId: number, employeeIds: readonly number[]): void {
  const ids = [...new Set(employeeIds)]
  if (ids.length === 0) return
  const homes = db.select({ facilityId: employees.facilityId, name: facilities.name }).from(employees)
    .innerJoin(facilities, eq(employees.facilityId, facilities.id)).where(inArray(employees.id, ids)).all()
  const refused = homes.find(home => !helpOutAllowed(db, facilityId, home.facilityId))
  if (refused) throw new ServiceError(403, 'help_out_not_paired', { facility: refused.name })
}

/** Facilities of the installation by id (name), in their order. */
const facilityNames = (db: Db) => new Map(db.select({ id: facilities.id, name: facilities.name }).from(facilities)
  .orderBy(asc(facilities.id)).all().map(row => [row.id, row.name]))

/**
 * The help-out days planned from `from` on between facilities that have no pair, per pair of facilities with the number
 * of days (per person): they stay in the plan without visibility until the Träger sets the pair (shown in the facility
 * cards). Past ones do not count, so a pair the Träger does not want stops being hinted at once its days have passed.
 */
function unpairedHelpOuts(db: Db, from: IsoDate): HelpoutPairsDto['unpaired'] {
  const pairs = new Set(db.select().from(facilityHelpoutPairs).all().map(row => `${row.facilityAId}:${row.facilityBId}`))
  const rows = db.selectDistinct({ planned: entries.helpFacilityId, home: employees.facilityId, employeeId: entries.employeeId, date: entries.date })
    .from(entries).innerJoin(employees, eq(entries.employeeId, employees.id))
    .where(and(isNotNull(entries.helpFacilityId), gte(entries.date, from))).all()
  const counts = new Map<string, { facilityIds: [number, number]; entries: number }>()
  for (const row of rows) {
    if (row.planned === null || row.planned === row.home) continue
    const facilityIds = pairOf(row.planned, row.home)
    const key = facilityIds.join(':')
    if (pairs.has(key)) continue
    const known = counts.get(key)
    if (known) known.entries++
    else counts.set(key, { facilityIds, entries: 1 })
  }
  const names = facilityNames(db)
  return [...counts.values()]
    .sort((x, y) => x.facilityIds[0] - y.facilityIds[0] || x.facilityIds[1] - y.facilityIds[1])
    .map(({ facilityIds, entries: count }) => ({
      facilityIds, names: [names.get(facilityIds[0]) ?? '', names.get(facilityIds[1]) ?? ''], entries: count,
    }))
}

/**
 * The pairs for the facility cards: the Träger (facilities.manage) every pair and the facilities with help-outs from
 * today on but no pair; the Leitung (settings.facility) the pairs of her own facility, read-only. 403 otherwise.
 */
export function listHelpoutPairs(
  db: Db, viewer: Pick<SessionUser, 'permissions' | 'facilityId'>, today: IsoDate = todayIso(),
): HelpoutPairsDto {
  const all = db.select().from(facilityHelpoutPairs)
    .orderBy(asc(facilityHelpoutPairs.facilityAId), asc(facilityHelpoutPairs.facilityBId)).all()
    .map((row): [number, number] => [row.facilityAId, row.facilityBId])
  const named = (pairs: [number, number][]) => {
    const names = facilityNames(db)
    return Object.fromEntries([...new Set(pairs.flat())].map(id => [id, names.get(id) ?? '']))
  }
  if (can(viewer.permissions, 'facilities.manage')) return { pairs: all, names: named(all), unpaired: unpairedHelpOuts(db, today) }
  if (!can(viewer.permissions, 'settings.facility') || viewer.facilityId === null) throw new ServiceError(403, 'forbidden')
  const own = all.filter(pair => pair.includes(viewer.facilityId!))
  return { pairs: own, names: named(own), unpaired: [] }
}

/** Both facilities exist and differ (400 helpout_pair_invalid, 404 facility_not_found); for the Träger only (403). */
function checkedPair(db: Db, actor: Pick<SessionUser, 'permissions'>, facilityId: number, otherFacilityId: number): [number, number] {
  if (!can(actor.permissions, 'facilities.manage')) throw new ServiceError(403, 'forbidden')
  if (facilityId === otherFacilityId) throw new ServiceError(400, 'helpout_pair_invalid')
  const names = facilityNames(db)
  if (!names.has(facilityId) || !names.has(otherFacilityId)) throw new ServiceError(404, 'facility_not_found')
  return pairOf(facilityId, otherFacilityId)
}

/**
 * The Träger allows or ends help-outs between two facilities (mutual: one pair for both). Ending it keeps the planned
 * help-outs (marked „nicht freigegeben“ in the plan, no visibility); the dialog shows the future ones first
 * (helpOutsBetween).
 */
export function setHelpoutPair(
  db: Db, actor: Pick<SessionUser, 'permissions'>, facilityId: number, otherFacilityId: number, paired: boolean,
): void {
  const [a, b] = checkedPair(db, actor, facilityId, otherFacilityId)
  if (paired) {
    db.insert(facilityHelpoutPairs).values({ facilityAId: a, facilityBId: b }).onConflictDoNothing().run()
  }
  else {
    db.delete(facilityHelpoutPairs).where(and(eq(facilityHelpoutPairs.facilityAId, a), eq(facilityHelpoutPairs.facilityBId, b))).run()
  }
}

/**
 * The help-outs planned between the two facilities from `from` on (both directions), by date and name: shown before the
 * Träger ends their pair (they stay, marked „nicht freigegeben“). For the Träger only (403).
 */
export function helpOutsBetween(
  db: Db, actor: Pick<SessionUser, 'permissions'>, facilityId: number, otherFacilityId: number, from: IsoDate,
): PairedHelpOutDto[] {
  const [a, b] = checkedPair(db, actor, facilityId, otherFacilityId)
  const names = facilityNames(db)
  const rows = db.selectDistinct({ date: entries.date, employee: employees.name, planned: entries.helpFacilityId, home: employees.facilityId })
    .from(entries).innerJoin(employees, eq(entries.employeeId, employees.id))
    .where(and(gte(entries.date, from), or(
      and(eq(entries.helpFacilityId, a), eq(employees.facilityId, b)),
      and(eq(entries.helpFacilityId, b), eq(employees.facilityId, a)),
    ))).all()
  return rows
    .map(row => ({ date: row.date, employee: row.employee, inFacility: names.get(row.planned!) ?? '', fromFacility: names.get(row.home) ?? '' }))
    .sort((x, y) => x.date.localeCompare(y.date) || x.employee.localeCompare(y.employee, 'de'))
}
