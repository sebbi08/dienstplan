import { and, eq, inArray, isNotNull, isNull, notExists, sql } from 'drizzle-orm'
import type { EmployeeDocumentFolder } from '../../shared/domain/personnel'
import { signRequestDeletableFrom, type SignRequestStatus } from '../../shared/domain/signRequests'
import type { IsoDate } from '../../shared/domain/types'
import type { Db } from '../db/client'
import { signRequestRecipients, signRequests } from '../db/schema'

/**
 * Deleting requests to sign without losing the record of a signature (docs/BETRIEB.md „Zum Unterschreiben senden“): a
 * request goes with its PDF, but recipients who signed or declined keep their row (when, SHA-256, reason) on a request
 * row without the file, until their own retention category („Beurteilungen und Zeugnisse“) deletes them. Kept apart
 * from server/services/signRequests.ts so the deletion of employee data (employeeDeletion.ts) and the overview of
 * Löschfristen can use it without the rest of the feature.
 */

/**
 * Removes a request: the open and withdrawn recipients go (they carry no record), the PDF is dropped and the request
 * hidden; a request without recipients left goes entirely. Answers the rows deleted or cleared.
 */
export function removeSignRequest(tx: Db, id: number, now: Date): number {
  let changed = tx.delete(signRequestRecipients)
    .where(and(eq(signRequestRecipients.requestId, id), inArray(signRequestRecipients.status, ['open', 'withdrawn']))).run().changes
  const kept = tx.select({ id: signRequestRecipients.id }).from(signRequestRecipients).where(eq(signRequestRecipients.requestId, id)).all().length
  if (kept === 0) return changed + tx.delete(signRequests).where(eq(signRequests.id, id)).run().changes
  changed += tx.update(signRequests).set({ fileData: null, deletedAt: now.toISOString() })
    .where(and(eq(signRequests.id, id), isNull(signRequests.deletedAt))).run().changes
  return changed
}

/** Deletes the removed requests whose last record has gone (with the employees' data). Answers how many. */
export function dropOrphanSignRequests(tx: Db): number {
  return tx.delete(signRequests).where(and(
    isNotNull(signRequests.deletedAt),
    notExists(tx.select({ one: sql`1` }).from(signRequestRecipients).where(eq(signRequestRecipients.requestId, signRequests.id))),
  )).run().changes
}

/**
 * The PDFs sent from the employee's personnel file (all, or those from `folders`) go with that data: each such request is
 * removed (removeSignRequest). Answers the rows deleted or cleared.
 */
export function dropSourceSnapshots(tx: Db, employeeId: number, folders: readonly EmployeeDocumentFolder[] | null = null): number {
  const rows = tx.select({ id: signRequests.id }).from(signRequests).where(and(
    eq(signRequests.sourceEmployeeId, employeeId), isNull(signRequests.deletedAt),
    folders === null ? undefined : inArray(signRequests.sourceFolder, [...folders]),
  )).all()
  const now = new Date()
  return rows.reduce((sum, row) => sum + removeSignRequest(tx, row.id, now), 0)
}

/** A finished request as Löschfristen lists it: deletable from one year after its last recipient finished. */
export interface SignRequestRetentionRow {
  id: number
  facilityId: number
  title: string
  deletableFrom: IsoDate
}

/** The finished requests not removed yet (every recipient signed, declined or withdrawn), with their date. */
export function finishedSignRequests(db: Db): SignRequestRetentionRow[] {
  const requests = db.select({ id: signRequests.id, facilityId: signRequests.facilityId, title: signRequests.title, createdAt: signRequests.createdAt })
    .from(signRequests).where(isNull(signRequests.deletedAt)).all()
  if (requests.length === 0) return []
  const recipients = db.select({
    requestId: signRequestRecipients.requestId, status: signRequestRecipients.status, signedAt: signRequestRecipients.signedAt,
    declinedAt: signRequestRecipients.declinedAt, withdrawnAt: signRequestRecipients.withdrawnAt,
  }).from(signRequestRecipients).where(inArray(signRequestRecipients.requestId, requests.map(request => request.id))).all() as {
    requestId: number; status: SignRequestStatus; signedAt: string | null; declinedAt: string | null; withdrawnAt: string | null
  }[]
  return requests.flatMap((request) => {
    const deletableFrom = signRequestDeletableFrom(request.createdAt, recipients.filter(row => row.requestId === request.id))
    return deletableFrom === null ? [] : [{ id: request.id, facilityId: request.facilityId, title: request.title, deletableFrom }]
  })
}
