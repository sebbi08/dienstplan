import { eq, inArray } from 'drizzle-orm'
import type { IsoDate } from '../../shared/domain/types'
import type { Db } from '../db/client'
import { childDocuments, children } from '../db/schema'
import { clearedReviews, type ChildRow } from '../lib/childRecord'
import { listDocumentTypes } from './documentTypes'

/**
 * The one rule behind the markers that ask for documents again: a document type is stale for a child while the child
 * has no document of it uploaded since the marker's day. `since`: the marker's day per marked child. Per marked child
 * the stale ones of `typeIds`, which include those without any document.
 */
function staleTypes(db: Db, since: Map<number, IsoDate>, typeIds: number[]): Map<number, number[]> {
  const result = new Map<number, number[]>()
  if (since.size === 0) return result
  const uploaded = new Map<number, Set<number>>([...since.keys()].map(childId => [childId, new Set()]))
  const documents = db.select({ childId: childDocuments.childId, typeId: childDocuments.documentTypeId, uploadedAt: childDocuments.uploadedAt })
    .from(childDocuments).where(inArray(childDocuments.childId, [...since.keys()])).all()
  for (const document of documents) {
    // uploaded_at is a UTC timestamp: its date part is compared with the calendar date of the marker.
    if (document.uploadedAt.slice(0, 10) >= since.get(document.childId)!) uploaded.get(document.childId)!.add(document.typeId)
  }
  for (const childId of since.keys()) result.set(childId, typeIds.filter(typeId => !uploaded.get(childId)!.has(typeId)))
  return result
}

/** The marker's day of the rows that have one. */
function markedSince<Row extends { id: number }>(rows: Row[], day: (row: Row) => IsoDate | null): Map<number, IsoDate> {
  return new Map(rows.flatMap((row): [number, IsoDate][] => {
    const since = day(row)
    return since === null ? [] : [[row.id, since]]
  }))
}

/**
 * The "documents" marker of a child's record: per child with the marker (others are not in the result) the ids of the
 * facility's required document types that are stale. An empty list means nothing is left to upload, so the marker is
 * no longer of any use.
 */
export function staleRequiredTypes(
  db: Db, facilityId: number, rows: Pick<ChildRow, 'id' | 'documentsReviewSince'>[],
): Map<number, number[]> {
  const since = markedSince(rows, row => row.documentsReviewSince)
  if (since.size === 0) return new Map()
  return staleTypes(db, since, listDocumentTypes(db, facilityId).filter(type => type.required).map(type => type.id))
}

/** The id of the facility's care contract type (at most one), as a list for the stale rule. */
function careContractTypes(db: Db, facilityId: number): number[] {
  return listDocumentTypes(db, facilityId).filter(type => type.careContract).map(type => type.id)
}

/**
 * The "contract" marker (the further care contract after a change into a group for school children): per child with
 * the marker (others are not in the result) the facility's care contract type if it is stale, else nothing. A facility
 * without such a type has nothing that could be stale; the marker then stays until it is confirmed.
 */
export function staleContractTypes(
  db: Db, facilityId: number, rows: Pick<ChildRow, 'id' | 'contractReviewSince'>[],
): Map<number, number[]> {
  const since = markedSince(rows, row => row.contractReviewSince)
  if (since.size === 0) return new Map()
  return staleTypes(db, since, careContractTypes(db, facilityId))
}

/**
 * Clears the child's stored markers that documents have settled: the documents marker when no required type is stale
 * any more (or none is required), the contract marker when a care contract was uploaded since its day.
 */
export function settleDocumentReview(db: Db, childId: number): void {
  const child = db.select().from(children).where(eq(children.id, childId)).get()
  if (!child) return
  if (child.documentsReviewSince !== null && staleRequiredTypes(db, child.facilityId, [child]).get(child.id)!.length === 0) {
    db.update(children).set(clearedReviews('documents')).where(eq(children.id, childId)).run()
  }
  if (child.contractReviewSince !== null && careContractTypes(db, child.facilityId).length > 0
    && staleContractTypes(db, child.facilityId, [child]).get(child.id)!.length === 0) {
    db.update(children).set(clearedReviews('contract')).where(eq(children.id, childId)).run()
  }
}
