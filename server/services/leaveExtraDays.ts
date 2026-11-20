import { and, eq } from 'drizzle-orm'
import { isValidLeaveExtraDays, LEAVE_EXTRA_REASON_MAX } from '../../shared/domain/leave'
import { can } from '../../shared/domain/permissions'
import type { SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { leaveExtraDays } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { assertEmployee, assertNotOwnBalance } from './employees'
import { entitlementFor } from './entitlements'
import { actorName } from './formTemplates'

// „Zusatztag nur für dieses Jahr“: one-off extra leave days of an employee in one year with a reason (e.g. „Dank für
// Sommerfest“). They raise only that year's available leave (yearEntitlement in leave.ts adds them), never the
// entitlement of the following years; what is left at the end of the year carries over like the other Resturlaub.
// Who may add and delete them: exactly who may change the entitlement (employees.edit, the facility's employees, not
// the own record of a Mitarbeiter: assertNotOwnBalance).

export interface LeaveExtraDaysInput {
  year: number
  days: number
  reason: string
}

function assertMayChange(db: Db, actor: SessionUser, facilityId: number, employeeId: number): void {
  if (!can(actor.permissions, 'employees.edit')) throw new ServiceError(403, 'forbidden')
  assertEmployee(db, facilityId, employeeId)
  assertNotOwnBalance(actor, employeeId)
}

/**
 * Adds extra days for a year and returns the entry's id. Days 0.5 to 30 in half days (400 leave_extra_days_invalid),
 * the reason trimmed 1 to 200 characters (400 reason_required / leave_extra_reason_too_long), and only for a year
 * with an entitlement, recorded for it or carried into it (400 leave_extra_no_entitlement: the account of a year without
 * one counts nothing).
 */
export function addLeaveExtraDays(
  db: Db, actor: SessionUser, facilityId: number, employeeId: number, input: LeaveExtraDaysInput, now: Date = new Date(),
): number {
  assertMayChange(db, actor, facilityId, employeeId)
  if (!isValidLeaveExtraDays(input.days)) throw new ServiceError(400, 'leave_extra_days_invalid')
  const reason = input.reason.trim()
  if (reason === '') throw new ServiceError(400, 'reason_required')
  if (reason.length > LEAVE_EXTRA_REASON_MAX) throw new ServiceError(400, 'leave_extra_reason_too_long')
  if (!entitlementFor(db, employeeId, input.year)) throw new ServiceError(400, 'leave_extra_no_entitlement')
  return db.insert(leaveExtraDays).values({
    employeeId, year: input.year, days: input.days, reason, createdBy: actorName(db, actor), createdAt: now.toISOString(),
  }).returning({ id: leaveExtraDays.id }).get().id
}

/** Deletes one entry of the employee (404 leave_extra_day_not_found for an unknown one or another employee's). */
export function deleteLeaveExtraDays(db: Db, actor: SessionUser, facilityId: number, employeeId: number, id: number): void {
  assertMayChange(db, actor, facilityId, employeeId)
  const removed = db.delete(leaveExtraDays)
    .where(and(eq(leaveExtraDays.id, id), eq(leaveExtraDays.employeeId, employeeId))).run().changes
  if (removed === 0) throw new ServiceError(404, 'leave_extra_day_not_found')
}
