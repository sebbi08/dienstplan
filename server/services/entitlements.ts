import { and, desc, eq, lte } from 'drizzle-orm'
import type { LeaveEntitlement } from '../../shared/domain/leave'
import type { Db } from '../db/client'
import { leaveEntitlements } from '../db/schema'

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
