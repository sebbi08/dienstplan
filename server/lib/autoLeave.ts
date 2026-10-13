import { and, eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { facilities } from '../db/schema'

/**
 * Switches the automatic leaving of school children off, in one facility or (`null`) in all of them, and returns
 * whether it was on anywhere. Every change that can widen whom the daily run deregisters (the school cutoff, a group
 * losing its flag "for school children" or being deleted with it, the retention period) calls this in the transaction
 * of its own change: the Träger has seen the list of the children it takes only for the old state and has to confirm
 * the new one before it is switched on again.
 */
export function switchAutoLeaveOff(db: Db, facilityId: number | null): boolean {
  const on = eq(facilities.autoLeaveSchoolChildren, true)
  const result = db.update(facilities).set({ autoLeaveSchoolChildren: false })
    .where(facilityId === null ? on : and(eq(facilities.id, facilityId), on)).run()
  return result.changes > 0
}
