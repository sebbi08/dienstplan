import type { Db } from '../../server/db/client'
import { facilities, facilityEveRules } from '../../server/db/schema'
import type { EveMode } from '../../shared/domain/eveRules'

/**
 * Lets 24 and 31 December count the same in every year for every facility of the test database (no TVöD, no paid free
 * years): a whole leave day by default, or half. For tests about the leave mechanics around the turn of the year.
 */
export function sameEveRuleEveryYear(db: Db, mode: Exclude<EveMode, 'paid'> = 'whole'): void {
  db.delete(facilityEveRules).run()
  const ids = db.select({ id: facilities.id }).from(facilities).all().map(row => row.id)
  if (ids.length > 0) db.insert(facilityEveRules).values(ids.map(facilityId => ({ facilityId, fromYear: 0, mode }))).run()
  db.update(facilities).set({ tvoedSue: false, christmasEveHalfLeave: mode === 'half', christmasEvePaidFree: false }).run()
}
