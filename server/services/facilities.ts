import { asc, eq, max, sql } from 'drizzle-orm'
import type { FacilitiesDto, FacilityDto, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { coverageRules, employees, facilities, shiftTemplates, users } from '../db/schema'
import { ServiceError } from '../lib/errors'

const ordered = [asc(facilities.sortOrder), asc(facilities.id)]

function toDto(row: { id: number; name: string }): FacilityDto {
  return { id: row.id, name: row.name }
}

export function firstFacilityId(db: Db): number | null {
  return db.select({ id: facilities.id }).from(facilities).orderBy(...ordered).limit(1).get()?.id ?? null
}

function facilityExists(db: Db, id: number): boolean {
  return db.select({ id: facilities.id }).from(facilities).where(eq(facilities.id, id)).get() !== undefined
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
  const query = db.select({ id: facilities.id, name: facilities.name }).from(facilities)
  const rows = viewer.role === 'provider'
    ? query.orderBy(...ordered).all()
    : viewer.facilityId === null ? [] : query.where(eq(facilities.id, viewer.facilityId)).all()
  return { facilities: rows.map(toDto), activeId: viewer.facilityId }
}

/** Trimmed, non-empty name that no other facility uses (compared case-insensitively). */
function checkedName(db: Db, name: string, exceptId: number | null = null): string {
  const trimmed = name.trim()
  if (!trimmed) throw new ServiceError(400, 'facility_name_required')
  const clash = db.select({ id: facilities.id }).from(facilities)
    .where(sql`lower(${facilities.name}) = lower(${trimmed})`).all()
    .some(row => row.id !== exceptId)
  if (clash) throw new ServiceError(409, 'facility_name_taken')
  return trimmed
}

/** A new facility starts empty, apart from a copy of the first facility's shift templates and coverage rules. */
export function createFacility(db: Db, name: string): FacilityDto {
  const checked = checkedName(db, name)
  return db.transaction((tx) => {
    const source = firstFacilityId(tx)
    const sortOrder = (tx.select({ value: max(facilities.sortOrder) }).from(facilities).get()?.value ?? -1) + 1
    const facility = tx.insert(facilities).values({ name: checked, sortOrder }).returning().get()
    if (source !== null) {
      const templates = tx.select().from(shiftTemplates).where(eq(shiftTemplates.facilityId, source))
        .orderBy(asc(shiftTemplates.sortOrder), asc(shiftTemplates.id)).all()
      if (templates.length > 0) {
        tx.insert(shiftTemplates).values(templates.map(({ id: _id, ...template }) => ({ ...template, facilityId: facility.id }))).run()
      }
      const rules = tx.select().from(coverageRules).where(eq(coverageRules.facilityId, source))
        .orderBy(asc(coverageRules.id)).all()
      if (rules.length > 0) {
        tx.insert(coverageRules).values(rules.map(({ id: _id, ...rule }) => ({ ...rule, facilityId: facility.id }))).run()
      }
    }
    return toDto(facility)
  })
}

export function renameFacility(db: Db, id: number, name: string): void {
  if (!facilityExists(db, id)) throw new ServiceError(404, 'facility_not_found')
  const checked = checkedName(db, name, id)
  db.update(facilities).set({ name: checked }).where(eq(facilities.id, id)).run()
}

/** Stores the facility the Träger works in (only the Träger switches; everyone else has a fixed facility). */
export function setActiveFacility(db: Db, user: SessionUser, facilityId: number): void {
  if (user.role !== 'provider') throw new ServiceError(403, 'forbidden')
  if (!facilityExists(db, facilityId)) throw new ServiceError(404, 'facility_not_found')
  db.update(users).set({ facilityId }).where(eq(users.id, user.id)).run()
}
