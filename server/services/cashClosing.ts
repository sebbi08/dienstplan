import { and, eq } from 'drizzle-orm'
import { canClose, monthKey, monthsToReopen, type CashSheetRow } from '../../shared/domain/cash'
import { cashCsv } from '../../shared/domain/cashCsv'
import type { IsoDate } from '../../shared/domain/types'
import type { SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { cashClosedMonths } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { closedMonths, loadBox, startKey } from './cashBoxes'
import { cashMonth } from './cashEntries'
import { type CashActor, logCash, monthOf } from './cashLog'

export const CASH_REOPEN_REASON_MAX = 200

/** „03/2026“ */
const monthLabel = (key: string) => `${key.slice(5, 7)}/${key.slice(0, 4)}`

/**
 * Closes a month of a box of the facility: it must be over (or today its last day) and the previous month closed
 * (the start month has none); else 409 cash_close_<reason> (not_over, previous_open, already_closed, before_start).
 */
export function closeMonth(
  db: Db, actor: CashActor, facilityId: number, boxId: number, year: number, month: number, today: IsoDate,
  now: Date = new Date(),
): void {
  const box = loadBox(db, facilityId, boxId)
  const result = canClose({ year, month, today, startMonth: { year: box.startYear, month: box.startMonth }, closed: closedMonths(db, boxId) })
  if (result !== 'ok') throw new ServiceError(409, `cash_close_${result}`)
  const key = monthKey(year, month)
  db.transaction((tx) => {
    tx.insert(cashClosedMonths).values({ boxId, year, month, closedAt: now.toISOString(), closedBy: actor.username }).run()
    logCash(tx, boxId, actor, 'month_closed', `Monat ${monthLabel(key)}`, key, now)
  })
}

/**
 * Reopens a closed month of a box of the facility and every later closed month of it (only the Träger: 403 forbidden
 * otherwise), with a reason of 1–200 characters (400 cash_reopen_reason_invalid). A month that is not closed is 409
 * cash_month_not_closed. One log line on the given month names all reopened months and the reason.
 */
export function reopenMonth(
  db: Db, provider: CashActor & Pick<SessionUser, 'role'>, facilityId: number, boxId: number, year: number, month: number,
  reason: string, now: Date = new Date(),
): string[] {
  if (provider.role !== 'provider') throw new ServiceError(403, 'forbidden')
  const text = reason.trim()
  if (text === '' || text.length > CASH_REOPEN_REASON_MAX) throw new ServiceError(400, 'cash_reopen_reason_invalid')
  loadBox(db, facilityId, boxId)
  const closed = closedMonths(db, boxId)
  const key = monthKey(year, month)
  if (!closed.has(key)) throw new ServiceError(409, 'cash_month_not_closed')
  const months = monthsToReopen(year, month, closed)
  db.transaction((tx) => {
    for (const value of months) {
      const [y, m] = value.split('-').map(Number) as [number, number]
      tx.delete(cashClosedMonths).where(and(
        eq(cashClosedMonths.boxId, boxId), eq(cashClosedMonths.year, y), eq(cashClosedMonths.month, m),
      )).run()
    }
    const label = months.length === 1 ? 'Monat' : 'Monate'
    logCash(tx, boxId, provider, 'month_reopened', `${label} ${months.map(monthLabel).join(', ')} – Begründung: „${text}“`, key, now)
  })
  return months
}

/** The box name in a file name: anything but letters (also umlauts), digits, „_“ and „-“ becomes „_“. */
export const csvNamePart = (name: string) => name.replace(/[^A-Za-z0-9äöüÄÖÜß_-]/g, '_')

/**
 * The CSV file of a box of the facility for a month or (month null) the calendar year: the year's months from the
 * start month (at the earliest January) to the running month (at the latest December), numbers restarting each month;
 * opening of the first, closing of the last month. Months before the start or after the running month are refused
 * like the month sheet (400 cash_before_start, cash_month_future).
 */
export function boxCsv(
  db: Db, facilityId: number, boxId: number, year: number, month: number | null, today: IsoDate,
): { filename: string; body: string } {
  const box = loadBox(db, facilityId, boxId)
  const name = `Kasse-${csvNamePart(box.name)}-${year}`
  if (month !== null) {
    const sheet = cashMonth(db, facilityId, boxId, year, month, today)
    return {
      filename: `${name}-${String(month).padStart(2, '0')}.csv`,
      body: cashCsv({ boxName: box.name, from: { year, month }, to: { year, month }, opening: sheet.opening, closing: sheet.closing, rows: sheet.rows }),
    }
  }
  const start = startKey(box)
  const first = start > monthKey(year, 1) ? box.startMonth : 1
  if (start > monthKey(year, 12)) throw new ServiceError(400, 'cash_before_start')
  const current = monthOf(today)
  const last = current < monthKey(year, 12) ? Number(current.slice(5, 7)) : 12
  // Also a start month after the running month leaves nothing to export.
  if (current < monthKey(year, 1) || first > last) throw new ServiceError(400, 'cash_month_future')
  const sheets = []
  for (let value = first; value <= last; value++) sheets.push(cashMonth(db, facilityId, boxId, year, value, today))
  const rows: CashSheetRow[] = sheets.flatMap(sheet => sheet.rows)
  return {
    filename: `${name}.csv`,
    body: cashCsv({
      boxName: box.name, from: { year, month: first }, to: { year, month: last },
      opening: sheets[0]!.opening, closing: sheets.at(-1)!.closing, rows,
    }),
  }
}
