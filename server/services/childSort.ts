import { eq } from 'drizzle-orm'
import { childComparator, DEFAULT_CHILD_SORT, isChildSort, type ChildSort } from '../../shared/domain/childSort'
import type { Db } from '../db/client'
import { facilities } from '../db/schema'
import { ServiceError } from '../lib/errors'

/** The facility's sort order of the child lists (404 facility_not_found); an unknown stored value counts as the default. */
export function getChildSort(db: Db, facilityId: number): ChildSort {
  const row = db.select({ childSort: facilities.childSort }).from(facilities).where(eq(facilities.id, facilityId)).get()
  if (!row) throw new ServiceError(404, 'facility_not_found')
  return isChildSort(row.childSort) ? row.childSort : DEFAULT_CHILD_SORT
}

/** Stores the facility's sort order of the child lists (404 facility_not_found). */
export function setChildSort(db: Db, facilityId: number, sort: ChildSort): void {
  getChildSort(db, facilityId)
  db.update(facilities).set({ childSort: sort }).where(eq(facilities.id, facilityId)).run()
}

/** The comparator of the children inside a group, as the facility chose it. */
export function childOrder(db: Db, facilityId: number) {
  return childComparator(getChildSort(db, facilityId))
}
