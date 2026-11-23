import { and, asc, eq, gt, isNull } from 'drizzle-orm'
import type { Db } from '../db/client'
import { childDocuments, employeeDocuments, printTemplates } from '../db/schema'
import { fillableFile } from '../lib/pdfForm'

/**
 * Judges the files stored before the `fillable` column existed (null): templates, child documents and personnel
 * documents, a few at a time, giving the event loop back after each file so requests are answered in between. Until a
 * file is judged it offers no „Ausfüllen“. Started once after the migrations; stops at the first error (logged), the
 * next start goes on from where it stopped. Returns the number of files judged.
 */
const TABLES = [printTemplates, childDocuments, employeeDocuments] as const

const nextTick = () => new Promise<void>(resolve => setImmediate(resolve))

export async function backfillFillable(db: Db, batchSize = 20): Promise<number> {
  // Nothing during the server's start itself: the first file is judged after the start-up has finished.
  await nextTick()
  let judged = 0
  for (const table of TABLES) {
    let after = 0
    for (;;) {
      const ids = db.select({ id: table.id }).from(table).where(and(isNull(table.fillable), gt(table.id, after)))
        .orderBy(asc(table.id)).limit(batchSize).all()
      if (ids.length === 0) break
      for (const { id } of ids) {
        const row = db.select({ data: table.data, mimeType: table.mimeType }).from(table).where(eq(table.id, id)).get()
        // Replaced or deleted meanwhile: the write judged it already, or there is nothing left to judge.
        if (row) db.update(table).set({ fillable: fillableFile(row.data, row.mimeType) }).where(and(eq(table.id, id), isNull(table.fillable))).run()
        judged++
        after = id
        await nextTick()
      }
    }
  }
  return judged
}
