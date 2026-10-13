import { eq, inArray } from 'drizzle-orm'
import type { Db } from '../db/client'
import { childDocuments, children } from '../db/schema'
import { clearedReviews, type ChildRow } from '../lib/childRecord'
import { listDocumentTypes } from './documentTypes'

/**
 * The one rule behind the "documents" marker of a child's record: a required document type of the facility is stale
 * while the child has no document of it uploaded since the marker's day. Per child with a marker (others are not in
 * the result): the ids of its stale required types, which include those without any document. An empty list means
 * nothing is left to upload, so the marker is no longer of any use.
 */
export function staleRequiredTypes(
  db: Db, facilityId: number, rows: Pick<ChildRow, 'id' | 'documentsReviewSince'>[],
): Map<number, number[]> {
  const marked = rows.filter(row => row.documentsReviewSince !== null)
  const result = new Map<number, number[]>()
  if (marked.length === 0) return result
  const since = new Map(marked.map(row => [row.id, row.documentsReviewSince!]))
  const uploaded = new Map<number, Set<number>>(marked.map(row => [row.id, new Set()]))
  const documents = db.select({ childId: childDocuments.childId, typeId: childDocuments.documentTypeId, uploadedAt: childDocuments.uploadedAt })
    .from(childDocuments).where(inArray(childDocuments.childId, marked.map(row => row.id))).all()
  for (const document of documents) {
    // uploaded_at is a UTC timestamp: its date part is compared with the calendar date of the marker.
    if (document.uploadedAt.slice(0, 10) >= since.get(document.childId)!) uploaded.get(document.childId)!.add(document.typeId)
  }
  const required = listDocumentTypes(db, facilityId).filter(type => type.required).map(type => type.id)
  for (const row of marked) result.set(row.id, required.filter(typeId => !uploaded.get(row.id)!.has(typeId)))
  return result
}

/** Clears the child's stored documents marker when no required type is stale any more (or none is required). */
export function settleDocumentReview(db: Db, childId: number): void {
  const child = db.select().from(children).where(eq(children.id, childId)).get()
  if (!child || child.documentsReviewSince === null) return
  if (staleRequiredTypes(db, child.facilityId, [child]).get(child.id)!.length === 0) {
    db.update(children).set(clearedReviews('documents')).where(eq(children.id, childId)).run()
  }
}
