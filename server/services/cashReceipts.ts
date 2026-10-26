import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from '../db/client'
import { cashBoxes, cashEntries, cashReceipts } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { safeFileNamePart } from '../lib/fileName'
import { checkedDocumentFile, DOCUMENT_EXTENSIONS, type DocumentMime } from '../lib/fileSignature'
import { assertActive, assertMonthOpen, type CashBoxRow } from './cashBoxes'
import { type CashActor, type CashLogAction, describeCashEntry, DIRECTION_LABELS, logCash, monthOf } from './cashLog'

type EntryRow = typeof cashEntries.$inferSelect

const RECEIPT_NAME_MAX = 200

/**
 * The rows a receipt belongs to: the entry of a box of the facility (else 404 cash_entry_not_found), for a transfer
 * both of its rows.
 */
function receiptRows(db: Db, facilityId: number, entryId: number): { entry: EntryRow; box: CashBoxRow }[] {
  const row = db.select({ entry: cashEntries, box: cashBoxes }).from(cashEntries)
    .innerJoin(cashBoxes, eq(cashBoxes.id, cashEntries.boxId))
    .where(and(eq(cashEntries.id, entryId), eq(cashBoxes.facilityId, facilityId))).get()
  if (!row) throw new ServiceError(404, 'cash_entry_not_found')
  if (row.entry.transferId === null) return [row]
  return db.select({ entry: cashEntries, box: cashBoxes }).from(cashEntries)
    .innerJoin(cashBoxes, eq(cashBoxes.id, cashEntries.boxId))
    .where(eq(cashEntries.transferId, row.entry.transferId)).all()
}

/** Every row must be changeable: active box (409 cash_box_archived), month open (409 cash_month_closed). */
function assertChangeable(db: Db, rows: { entry: EntryRow; box: CashBoxRow }[]): void {
  for (const { entry, box } of rows) {
    assertActive(box)
    assertMonthOpen(db, box.id, entry.date)
  }
}

function logReceipt(tx: Db, actor: CashActor, rows: { entry: EntryRow }[], action: CashLogAction, name: string | null, now: Date) {
  for (const { entry } of rows) {
    const what = `${DIRECTION_LABELS[entry.direction]} ${describeCashEntry(entry)}`
    logCash(tx, entry.boxId, actor, action, name === null ? what : `${what}: „${name}“`, monthOf(entry.date), now)
  }
}

/** Deletes those of the receipts no entry refers to any more; true when one was deleted (the WAL wants a checkpoint). */
export function dropUnusedReceipts(tx: Db, ids: (number | null)[]): boolean {
  const candidates = [...new Set(ids.filter((id): id is number => id !== null))]
  if (candidates.length === 0) return false
  const used = new Set(tx.select({ id: cashEntries.receiptId }).from(cashEntries)
    .where(inArray(cashEntries.receiptId, candidates)).all().map(row => row.id))
  const unused = candidates.filter(id => !used.has(id))
  if (unused.length > 0) tx.delete(cashReceipts).where(inArray(cashReceipts.id, unused)).run()
  return unused.length > 0
}

/**
 * Attaches a receipt (JPG, PNG or PDF by its first bytes, at most MAX_DOCUMENT_BYTES) to an entry, to both rows of a
 * transfer, replacing an earlier one (deleted when nothing refers to it any more). Returns the receipt's id.
 */
export function setReceipt(
  db: Db, actor: CashActor, facilityId: number, entryId: number, file: { data: Buffer; filename: string },
  now: Date = new Date(),
): number {
  const rows = receiptRows(db, facilityId, entryId)
  assertChangeable(db, rows)
  const mime = checkedDocumentFile(file.data)
  const name = file.filename.trim().slice(0, RECEIPT_NAME_MAX) || 'Beleg'
  return db.transaction((tx) => {
    const id = tx.insert(cashReceipts).values({ facilityId, mime, data: file.data, name, createdAt: now.toISOString() })
      .returning({ id: cashReceipts.id }).get().id
    const previous = rows.map(row => row.entry.receiptId)
    tx.update(cashEntries).set({ receiptId: id }).where(inArray(cashEntries.id, rows.map(row => row.entry.id))).run()
    dropUnusedReceipts(tx, previous)
    logReceipt(tx, actor, rows, previous.some(value => value !== null) ? 'receipt_replaced' : 'receipt_added', name, now)
    return id
  })
}

/** Removes the receipt of an entry (of both rows of a transfer); 404 cash_receipt_not_found when it has none. */
export function removeReceipt(db: Db, actor: CashActor, facilityId: number, entryId: number, now: Date = new Date()): void {
  const rows = receiptRows(db, facilityId, entryId)
  const previous = rows.map(row => row.entry.receiptId)
  if (previous.every(value => value === null)) throw new ServiceError(404, 'cash_receipt_not_found')
  assertChangeable(db, rows)
  db.transaction((tx) => {
    tx.update(cashEntries).set({ receiptId: null }).where(inArray(cashEntries.id, rows.map(row => row.entry.id))).run()
    dropUnusedReceipts(tx, previous)
    logReceipt(tx, actor, rows, 'receipt_removed', null, now)
  })
}

/**
 * A receipt of the facility (another facility's is 404 cash_receipt_not_found) with its stored type and a file name of
 * letters, digits, dot and dash.
 */
export function readReceipt(db: Db, facilityId: number, id: number): { data: Buffer; mimeType: string; fileName: string } {
  const row = db.select().from(cashReceipts).where(and(eq(cashReceipts.id, id), eq(cashReceipts.facilityId, facilityId))).get()
  if (!row) throw new ServiceError(404, 'cash_receipt_not_found')
  const base = safeFileNamePart(row.name.replace(/\.[A-Za-z0-9]{1,5}$/, '')) || 'Beleg'
  return { data: row.data, mimeType: row.mime, fileName: `${base}.${DOCUMENT_EXTENSIONS[row.mime as DocumentMime] ?? 'bin'}` }
}
