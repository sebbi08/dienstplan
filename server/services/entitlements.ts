import { and, asc, desc, eq, lte } from 'drizzle-orm'
import type { LeaveEntitlement } from '../../shared/domain/leave'
import type { LeaveExtraDayDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { leaveEntitlements, leaveExtraDays } from '../db/schema'

export interface EffectiveEntitlement extends LeaveEntitlement {
  /** The year the entitlement was recorded for; earlier than the asked year when it was carried into it. */
  fromYear: number
}

/**
 * The leave entitlement of an employee in a year: the one recorded for that year, or else the last one recorded
 * before it (carried into later years until it changes, without carry-over days). Null before the first record.
 */
export function entitlementFor(db: Db, employeeId: number, year: number): EffectiveEntitlement | null {
  const row = db.select().from(leaveEntitlements)
    .where(and(eq(leaveEntitlements.employeeId, employeeId), lte(leaveEntitlements.year, year)))
    .orderBy(desc(leaveEntitlements.year)).limit(1).get()
  if (!row) return null
  return { days: row.days, carriedOverDays: row.year === year ? row.carriedOverDays : 0, fromYear: row.year }
}

/** The first year an entitlement was recorded for the employee (null when none was). */
export function firstEntitlementYear(db: Db, employeeId: number): number | null {
  return db.select({ year: leaveEntitlements.year }).from(leaveEntitlements)
    .where(eq(leaveEntitlements.employeeId, employeeId)).orderBy(asc(leaveEntitlements.year)).limit(1).get()?.year ?? null
}

/**
 * The one-off extra leave days of the employee („Zusatztag nur für dieses Jahr“, server/services/leaveExtraDays.ts), by
 * year and then in the order added; only of `year` when given.
 */
export function leaveExtraDaysOf(db: Db, employeeId: number, year?: number): LeaveExtraDayDto[] {
  return db.select().from(leaveExtraDays)
    .where(and(eq(leaveExtraDays.employeeId, employeeId), year === undefined ? undefined : eq(leaveExtraDays.year, year)))
    .orderBy(asc(leaveExtraDays.year), asc(leaveExtraDays.id)).all()
    .map(({ id, year: rowYear, days, reason, createdBy, createdAt }) => ({ id, year: rowYear, days, reason, createdBy, createdAt }))
}

/** The sum of the employee's extra days per year (a year without any is missing). */
export function leaveExtraDaysByYear(db: Db, employeeId: number): Map<number, number> {
  const byYear = new Map<number, number>()
  for (const row of leaveExtraDaysOf(db, employeeId)) byYear.set(row.year, (byYear.get(row.year) ?? 0) + row.days)
  return byYear
}
