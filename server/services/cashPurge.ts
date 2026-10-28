import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm'
import { confirmsName } from '../../shared/domain/confirmName'
import { todayIso } from '../../shared/domain/dates'
import { can } from '../../shared/domain/permissions'
import type { IsoDate } from '../../shared/domain/types'
import type { SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { cashBoxes, cashClosedMonths, cashEntries, cashLog } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { boxDeletableFrom, loadBox, type CashBoxRow } from './cashBoxes'
import { type CashActor, describeCashEntry, DIRECTION_LABELS, logCash, monthOf } from './cashLog'
import { dropUnusedReceipts } from './cashReceipts'
import { foreignKeyViolations } from './employeeDeletion'

/**
 * „Endgültig löschen“ of an archived box once its retention period has run (spec Löschfristen §4), see removeArchivedBox.
 *
 * Only the Träger (403 forbidden; deleting after a period is the Träger's, spec Löschübersicht §3), a box of the facility (404 cash_box_not_found), archived (409
 * cash_box_not_archived), from its deletableFrom on (409 cash_box_retention; a box with neither entries nor history at
 * any time), and `confirm` the box name as confirmsName compares it (400 cash_box_confirm_mismatch). True when the deletion took a
 * receipt along (the caller checkpoints the WAL anyway: entries and log are gone as well).
 */
export function purgeBox(
  db: Db, actor: SessionUser, facilityId: number, id: number, confirm: string, today: IsoDate = todayIso(), now: Date = new Date(),
): boolean {
  if (!can(actor.permissions, 'cash.purge')) throw new ServiceError(403, 'forbidden')
  const box = loadBox(db, facilityId, id)
  if (!box.archived) throw new ServiceError(409, 'cash_box_not_archived')
  const deletableFrom = boxDeletableFrom(db, facilityId, id)
  if (deletableFrom !== null && today < deletableFrom) throw new ServiceError(409, 'cash_box_retention', { deletableFrom })
  if (!confirmsName(confirm, box.name)) throw new ServiceError(400, 'cash_box_confirm_mismatch')
  return removeArchivedBox(db, actor, box, now).receiptDropped
}

/**
 * Deletes the box for good, its checks done by the caller (purgeBox, the Träger's retention overview): the box, its
 * entries, their receipts (a transfer's receipt stays while the counterpart uses it), closed months and log, in one
 * transaction. The counterpart rows of its transfers in other boxes stay as plain entries (link and transfer text
 * cleared, the purpose as it was), with a line in their box's log, also in a closed month there. A reference the
 * deletion would leave behind rolls it back (409 cash_box_purge_blocked). Answers the rows changed and whether a
 * receipt went along.
 */
export function removeArchivedBox(
  db: Db, actor: CashActor, box: CashBoxRow, now: Date = new Date(),
): { rows: number; receiptDropped: boolean } {
  const id = box.id
  // Only violations the purge would add count: an old one elsewhere (say from a restored backup) blocks nothing.
  const before = new Set(foreignKeyViolations(db))
  return db.transaction((tx) => {
    let rows = 0
    const own = tx.select({ receiptId: cashEntries.receiptId, transferId: cashEntries.transferId }).from(cashEntries)
      .where(eq(cashEntries.boxId, id)).all()
    const transferIds = [...new Set(own.map(row => row.transferId).filter((value): value is number => value !== null))]
    if (transferIds.length > 0) {
      for (const row of tx.select().from(cashEntries).where(and(
        inArray(cashEntries.transferId, transferIds), ne(cashEntries.boxId, id), isNotNull(cashEntries.transferId),
      )).all()) {
        rows += tx.update(cashEntries).set({ transferId: null, transferText: null }).where(eq(cashEntries.id, row.id)).run().changes
        logCash(tx, row.boxId, actor, 'transfer_unlinked',
          `${DIRECTION_LABELS[row.direction]} ${describeCashEntry(row)}: Kasse ${box.name} endgültig gelöscht, bleibt als normaler Eintrag`,
          monthOf(row.date), now)
      }
    }
    rows += tx.delete(cashEntries).where(eq(cashEntries.boxId, id)).run().changes
    const receiptDropped = dropUnusedReceipts(tx, own.map(row => row.receiptId))
    rows += tx.delete(cashClosedMonths).where(eq(cashClosedMonths.boxId, id)).run().changes
    rows += tx.delete(cashLog).where(eq(cashLog.boxId, id)).run().changes
    rows += tx.delete(cashBoxes).where(eq(cashBoxes.id, id)).run().changes
    if (foreignKeyViolations(tx).some(violation => !before.has(violation))) throw new ServiceError(409, 'cash_box_purge_blocked')
    return { rows, receiptDropped }
  })
}
