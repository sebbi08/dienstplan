import { asc, eq } from 'drizzle-orm'
import { formatCents, monthKey } from '../../shared/domain/cash'
import { todayIso } from '../../shared/domain/dates'
import type { IsoDate } from '../../shared/domain/types'
import type { CashLogDto, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { cashLog } from '../db/schema'

/** Who writes to a cash book: Träger or Leitung (the guard checked the role), named in the log by their user name. */
export type CashActor = Pick<SessionUser, 'id' | 'username'>

export type CashLogAction =
  | 'box_created' | 'box_updated' | 'box_archived' | 'box_activated'
  | 'entry_created' | 'entry_updated' | 'entry_deleted'
  | 'transfer_created' | 'transfer_updated' | 'transfer_deleted'
  | 'month_closed' | 'month_reopened'

/** Appends a line to the box's log (never changed or deleted afterwards). */
export function logCash(tx: Db, boxId: number, actor: CashActor, action: CashLogAction, detail: string, now: Date = new Date()): void {
  tx.insert(cashLog).values({ boxId, at: now.toISOString(), actor: actor.username, action, detail }).run()
}

/** „03.03.2026“ */
export function germanDate(iso: IsoDate): string {
  const [year, month, day] = iso.split('-')
  return `${day}.${month}.${year}`
}

/** The facts of an entry as the log names them. */
export function describeCashEntry(entry: { date: IsoDate; cents: number; purpose: string }): string {
  return `${germanDate(entry.date)}, ${formatCents(entry.cents)}, „${entry.purpose}“`
}

/** „Datum 03.03.2026 → 05.03.2026; Betrag 12,50 € → 13,00 €“ for the fields that changed (empty when none did). */
export function describeChanges(changes: [label: string, before: string, after: string][]): string {
  return changes.filter(([, before, after]) => before !== after)
    .map(([label, before, after]) => `${label} ${before} → ${after}`).join('; ')
}

/** The box's log lines written in the month (Berlin time), oldest first. */
export function monthLog(db: Db, boxId: number, year: number, month: number): CashLogDto[] {
  const key = monthKey(year, month)
  return db.select({ id: cashLog.id, at: cashLog.at, actor: cashLog.actor, action: cashLog.action, detail: cashLog.detail })
    .from(cashLog).where(eq(cashLog.boxId, boxId)).orderBy(asc(cashLog.at), asc(cashLog.id)).all()
    .filter(line => todayIso(new Date(line.at)).slice(0, 7) === key)
}
