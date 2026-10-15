import { and, asc, eq, isNull, max } from 'drizzle-orm'
import { isGermanState, schoolCutoffOf, type GermanState } from '../../shared/domain/states'
import type { FacilitiesDto, FacilityDto, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { coverageRules, documentTypes, employees, facilities, shiftTemplates, users } from '../db/schema'
import { DEFAULT_DOCUMENT_TYPES } from '../db/seed'
import { ServiceError } from '../lib/errors'
import { bookFreedClosureDays } from './closures'
import { facilityHolidayRules } from './holidayRules'
import { seedBuiltinRequirementTypes } from './requirements'

const ordered = [asc(facilities.sortOrder), asc(facilities.id)]

const dtoColumns = { id: facilities.id, name: facilities.name, state: facilities.state, assumptionDay: facilities.assumptionDay }

function toDto(row: FacilityDto): FacilityDto {
  return { id: row.id, name: row.name, state: row.state, assumptionDay: row.assumptionDay }
}

export function firstFacilityId(db: Db): number | null {
  return db.select({ id: facilities.id }).from(facilities).orderBy(...ordered).limit(1).get()?.id ?? null
}

function facilityExists(db: Db, id: number): boolean {
  return db.select({ id: facilities.id }).from(facilities).where(eq(facilities.id, id)).get() !== undefined
}

/** For the Träger's routes that name a facility: 404 facility_not_found when it does not exist. */
export function assertFacility(db: Db, id: number): void {
  if (!facilityExists(db, id)) throw new ServiceError(404, 'facility_not_found')
}

/**
 * The facility a user works in, fresh from the database:
 * Leitung and tablet their own, the Träger the active selection (or the first facility), a Mitarbeiter that of the employee.
 */
export function resolveFacilityId(db: Db, user: typeof users.$inferSelect): number | null {
  switch (user.role) {
    case 'admin':
    case 'terminal':
      return user.facilityId
    case 'provider':
      return user.facilityId !== null && facilityExists(db, user.facilityId) ? user.facilityId : firstFacilityId(db)
    case 'observer':
      if (user.employeeId === null) return null
      return db.select({ facilityId: employees.facilityId }).from(employees)
        .where(eq(employees.id, user.employeeId)).get()?.facilityId ?? null
  }
}

/** The Träger sees every facility, everyone else only their own. */
export function listFacilities(db: Db, viewer: SessionUser): FacilitiesDto {
  const query = db.select(dtoColumns).from(facilities)
  const rows = viewer.role === 'provider'
    ? query.orderBy(...ordered).all()
    : viewer.facilityId === null ? [] : query.where(eq(facilities.id, viewer.facilityId)).all()
  return { facilities: rows.map(toDto), activeId: viewer.facilityId }
}

/** Trimmed, non-empty name that no other facility uses (compared case-insensitively, umlauts included). */
function checkedName(db: Db, name: string, exceptId: number | null = null): string {
  const trimmed = name.trim()
  if (!trimmed) throw new ServiceError(400, 'facility_name_required')
  // In JS, not SQLite's lower(), which only folds ASCII letters (Ä ≠ ä).
  const folded = (value: string) => value.trim().toLocaleLowerCase('de')
  const clash = db.select({ id: facilities.id, name: facilities.name }).from(facilities).all()
    .some(row => row.id !== exceptId && folded(row.name) === folded(trimmed))
  if (clash) throw new ServiceError(409, 'facility_name_taken')
  return trimmed
}

/** The state code, or 400 state_invalid. */
function assertState(state: string): asserts state is GermanState {
  if (!isGermanState(state)) throw new ServiceError(400, 'state_invalid')
}

/**
 * A new facility starts empty, apart from a copy of the first facility's shift templates and coverage rules, the
 * built-in kinds of mandatory appointments (with their defaults, not the first facility's names and intervals)
 * and the default document types.
 */
export function createFacility(db: Db, name: string, state: GermanState = 'BW'): FacilityDto {
  const checked = checkedName(db, name)
  assertState(state)
  const cutoff = schoolCutoffOf(state)
  return db.transaction((tx) => {
    const source = firstFacilityId(tx)
    const sortOrder = (tx.select({ value: max(facilities.sortOrder) }).from(facilities).get()?.value ?? -1) + 1
    const facility = tx.insert(facilities).values({
      name: checked, sortOrder, state, schoolCutoffMonth: cutoff.month, schoolCutoffDay: cutoff.day, schoolAgeYears: cutoff.ageYears,
    }).returning().get()
    seedBuiltinRequirementTypes(tx, facility.id)
    if (source !== null) {
      const templates = tx.select().from(shiftTemplates).where(eq(shiftTemplates.facilityId, source))
        .orderBy(asc(shiftTemplates.sortOrder), asc(shiftTemplates.id)).all()
      if (templates.length > 0) {
        tx.insert(shiftTemplates).values(templates.map(({ id: _id, ...template }) => ({ ...template, facilityId: facility.id }))).run()
      }
      // Group rules belong to the first facility's groups; only the facility-wide rules are copied.
      const rules = tx.select().from(coverageRules).where(and(eq(coverageRules.facilityId, source), isNull(coverageRules.groupId)))
        .orderBy(asc(coverageRules.id)).all()
      if (rules.length > 0) {
        tx.insert(coverageRules).values(rules.map(({ id: _id, ...rule }) => ({ ...rule, facilityId: facility.id }))).run()
      }
    }
    tx.insert(documentTypes).values(DEFAULT_DOCUMENT_TYPES.map(type => ({ ...type, facilityId: facility.id }))).run()
    return toDto(facility)
  })
}

/**
 * The facility's name, state and Bavaria flag. The school cutoff and the automatic leaving are never touched here.
 * When the state or the flag changes, the facility's closures are booked on the days that are no holidays any more
 * (see bookFreedClosureDays), in the same transaction.
 */
export function updateFacility(
  db: Db, actor: SessionUser, id: number, input: { name: string; state: GermanState; assumptionDay: boolean }, now: Date = new Date(),
): void {
  const before = facilityHolidayRules(db, id)
  assertState(input.state)
  const checked = checkedName(db, input.name, id)
  db.transaction((tx) => {
    tx.update(facilities).set({ name: checked, state: input.state, assumptionDay: input.assumptionDay }).where(eq(facilities.id, id)).run()
    if (before.state !== input.state || before.assumptionDay !== input.assumptionDay) {
      bookFreedClosureDays(tx, actor, id, before, now)
    }
  })
}

/** Stores the facility the Träger works in (only the Träger switches; everyone else has a fixed facility). */
export function setActiveFacility(db: Db, user: SessionUser, facilityId: number): void {
  if (user.role !== 'provider') throw new ServiceError(403, 'forbidden')
  if (!facilityExists(db, facilityId)) throw new ServiceError(404, 'facility_not_found')
  db.update(users).set({ facilityId }).where(eq(users.id, user.id)).run()
}
