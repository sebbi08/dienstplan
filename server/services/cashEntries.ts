import { and, asc, count, eq, inArray, isNull, lte, max, ne } from 'drizzle-orm'
import { formatCents, monthKey, monthSheet, type CashDirection, type CashEntryFact } from '../../shared/domain/cash'
import { daysInMonth, isValidIsoDate, toIsoDate } from '../../shared/domain/dates'
import type { IsoDate } from '../../shared/domain/types'
import type { CashMonthDto, CashTransferInfo } from '../../shared/types/api'
import type { Db } from '../db/client'
import { cashBoxes, cashClosedMonths, cashEntries } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { assertActive, assertMonthOpen, boxInfo, loadBox, startKey, transferPurpose, type CashBoxRow } from './cashBoxes'
import {
  type CashActor, describeCashEntry, describeChanges, DIRECTION_LABELS, germanDate, logCash, monthLog, monthOf,
} from './cashLog'
import { dropUnusedReceipts } from './cashReceipts'

/** At most 1.000.000,00 € per entry. */
export const MAX_CASH_CENTS = 100_000_000
export const CASH_PURPOSE_MAX = 200

/** What an entry or a transfer says: date, amount in cents and purpose (Verwendungszweck). */
export interface CashFacts { date: IsoDate; cents: number; purpose: string }
export interface CashEntryInput extends CashFacts { boxId: number; direction: CashDirection }
export interface CashTransferInput extends CashFacts { fromBoxId: number; toBoxId: number }

type EntryRow = typeof cashEntries.$inferSelect

/** A valid date not after today, an amount of 1 … 100 000 000 cents and a trimmed purpose of 1–200 characters. */
function checkedFacts(input: CashFacts, today: IsoDate): CashFacts {
  if (!isValidIsoDate(input.date)) throw new ServiceError(400, 'cash_date_invalid')
  if (input.date > today) throw new ServiceError(400, 'cash_date_future')
  if (!Number.isSafeInteger(input.cents) || input.cents < 1 || input.cents > MAX_CASH_CENTS) {
    throw new ServiceError(400, 'cash_amount_invalid')
  }
  const purpose = input.purpose.trim()
  if (purpose === '' || purpose.length > CASH_PURPOSE_MAX) throw new ServiceError(400, 'cash_purpose_invalid')
  return { date: input.date, cents: input.cents, purpose }
}

/** The box takes an entry dated `date`: active, not before its start month, the month not closed. */
function assertWritable(db: Db, box: CashBoxRow, date: IsoDate): void {
  assertActive(box)
  if (date.slice(0, 7) < startKey(box)) throw new ServiceError(400, 'cash_before_start')
  assertMonthOpen(db, box.id, date)
}

/** An entry of a box of the facility; anything else is 404 cash_entry_not_found. */
function loadEntry(db: Db, facilityId: number, id: number): { entry: EntryRow; box: CashBoxRow } {
  const row = db.select({ entry: cashEntries, box: cashBoxes }).from(cashEntries)
    .innerJoin(cashBoxes, eq(cashBoxes.id, cashEntries.boxId))
    .where(and(eq(cashEntries.id, id), eq(cashBoxes.facilityId, facilityId))).get()
  if (!row) throw new ServiceError(404, 'cash_entry_not_found')
  return row
}

/** A plain entry (not one side of a transfer, which changes only as a whole: 409 cash_entry_is_transfer). */
function loadPlainEntry(db: Db, facilityId: number, id: number): { entry: EntryRow; box: CashBoxRow } {
  const loaded = loadEntry(db, facilityId, id)
  if (loaded.entry.transferId !== null) throw new ServiceError(409, 'cash_entry_is_transfer')
  return loaded
}

const describeEntry = (entry: CashFacts & { direction: CashDirection }) =>
  `${DIRECTION_LABELS[entry.direction]} ${describeCashEntry(entry)}`

/** „Datum … → …; Betrag … → …; Text „…“ → „…““ for what changed. */
const factChanges = (before: CashFacts, after: CashFacts) =>
  describeChanges([
    ['Datum', germanDate(before.date), germanDate(after.date)],
    ['Betrag', formatCents(before.cents), formatCents(after.cents)],
    ['Text', `„${before.purpose}“`, `„${after.purpose}“`],
  ])

/** A new income or expense of an active box; returns its id. */
export function createEntry(
  db: Db, actor: CashActor, facilityId: number, input: CashEntryInput, today: IsoDate, now: Date = new Date(),
): number {
  const box = loadBox(db, facilityId, input.boxId)
  if (input.direction !== 'in' && input.direction !== 'out') throw new ServiceError(400, 'cash_direction_invalid')
  const facts = checkedFacts(input, today)
  assertWritable(db, box, facts.date)
  return db.transaction((tx) => {
    const id = tx.insert(cashEntries).values({
      boxId: box.id, ...facts, direction: input.direction, createdAt: now.toISOString(), createdBy: actor.id,
    }).returning({ id: cashEntries.id }).get().id
    logCash(tx, box.id, actor, 'entry_created', describeEntry({ ...facts, direction: input.direction }), monthOf(facts.date), now)
    return id
  })
}

/** Changes date, amount and purpose of a plain entry; the old and the new month must be open. */
export function updateEntry(
  db: Db, actor: CashActor, facilityId: number, id: number, input: CashFacts, today: IsoDate, now: Date = new Date(),
): void {
  const { entry, box } = loadPlainEntry(db, facilityId, id)
  const facts = checkedFacts(input, today)
  assertWritable(db, box, entry.date)
  assertWritable(db, box, facts.date)
  const changes = factChanges(entry, facts)
  if (!changes) return
  db.transaction((tx) => {
    tx.update(cashEntries).set(facts).where(eq(cashEntries.id, id)).run()
    logCash(tx, box.id, actor, 'entry_updated', `${DIRECTION_LABELS[entry.direction]}: ${changes}`, monthOf(facts.date), now)
  })
}

/**
 * Deletes a plain entry of an open month (and its receipt); the others of its month move up in numbering. True when a
 * receipt was deleted along.
 */
export function deleteEntry(db: Db, actor: CashActor, facilityId: number, id: number, now: Date = new Date()): boolean {
  const { entry, box } = loadPlainEntry(db, facilityId, id)
  assertWritable(db, box, entry.date)
  return db.transaction((tx) => {
    tx.delete(cashEntries).where(eq(cashEntries.id, id)).run()
    const dropped = dropUnusedReceipts(tx, [entry.receiptId])
    logCash(tx, box.id, actor, 'entry_deleted', describeEntry(entry), monthOf(entry.date), now)
    return dropped
  })
}

/** Expense and income row of a transfer of the facility, by the expense row's id; else 404 cash_transfer_not_found. */
function loadTransfer(db: Db, facilityId: number, id: number) {
  const rows = db.select({ entry: cashEntries, box: cashBoxes }).from(cashEntries)
    .innerJoin(cashBoxes, eq(cashBoxes.id, cashEntries.boxId))
    .where(and(eq(cashEntries.transferId, id), eq(cashBoxes.facilityId, facilityId))).all()
  const out = rows.find(row => row.entry.direction === 'out' && row.entry.id === id)
  const income = rows.find(row => row.entry.direction === 'in')
  if (!out || !income) throw new ServiceError(404, 'cash_transfer_not_found')
  return { out, income, text: out.entry.transferText ?? '' }
}

/**
 * Moves money from one active box of the facility to another: an expense in the source and an income in the target,
 * both carrying the expense row's id as transferId (returned). The date's month must be open in both boxes.
 */
export function createTransfer(
  db: Db, actor: CashActor, facilityId: number, input: CashTransferInput, today: IsoDate, now: Date = new Date(),
): number {
  const from = loadBox(db, facilityId, input.fromBoxId)
  const to = loadBox(db, facilityId, input.toBoxId)
  if (from.id === to.id) throw new ServiceError(400, 'cash_transfer_same_box')
  const facts = checkedFacts(input, today)
  assertWritable(db, from, facts.date)
  assertWritable(db, to, facts.date)
  return db.transaction((tx) => {
    const base = { date: facts.date, cents: facts.cents, transferText: facts.purpose, createdAt: now.toISOString(), createdBy: actor.id }
    const id = tx.insert(cashEntries).values({ ...base, boxId: from.id, direction: 'out', purpose: transferPurpose('out', to.name, facts.purpose) })
      .returning({ id: cashEntries.id }).get().id
    tx.update(cashEntries).set({ transferId: id }).where(eq(cashEntries.id, id)).run()
    tx.insert(cashEntries).values({
      ...base, boxId: to.id, direction: 'in', purpose: transferPurpose('in', from.name, facts.purpose), transferId: id,
    }).run()
    logCash(tx, from.id, actor, 'transfer_created', `an ${to.name}: ${describeCashEntry(facts)}`, monthOf(facts.date), now)
    logCash(tx, to.id, actor, 'transfer_created', `von ${from.name}: ${describeCashEntry(facts)}`, monthOf(facts.date), now)
    return id
  })
}

/** Changes date, amount and text of both rows of a transfer; the old and the new month must be open in both boxes. */
export function updateTransfer(
  db: Db, actor: CashActor, facilityId: number, id: number, input: CashFacts, today: IsoDate, now: Date = new Date(),
): void {
  const { out, income, text } = loadTransfer(db, facilityId, id)
  const facts = checkedFacts(input, today)
  for (const side of [out, income]) {
    assertWritable(db, side.box, side.entry.date)
    assertWritable(db, side.box, facts.date)
  }
  const changes = factChanges({ ...out.entry, purpose: text }, facts)
  if (!changes) return
  db.transaction((tx) => {
    const base = { date: facts.date, cents: facts.cents, transferText: facts.purpose }
    tx.update(cashEntries).set({ ...base, purpose: transferPurpose('out', income.box.name, facts.purpose) })
      .where(eq(cashEntries.id, out.entry.id)).run()
    tx.update(cashEntries).set({ ...base, purpose: transferPurpose('in', out.box.name, facts.purpose) })
      .where(eq(cashEntries.id, income.entry.id)).run()
    logCash(tx, out.box.id, actor, 'transfer_updated', `an ${income.box.name}: ${changes}`, monthOf(facts.date), now)
    logCash(tx, income.box.id, actor, 'transfer_updated', `von ${out.box.name}: ${changes}`, monthOf(facts.date), now)
  })
}

/**
 * Deletes both rows of a transfer (and their receipt); its month must be open in both boxes. True when a receipt was
 * deleted along.
 */
export function deleteTransfer(db: Db, actor: CashActor, facilityId: number, id: number, now: Date = new Date()): boolean {
  const { out, income, text } = loadTransfer(db, facilityId, id)
  for (const side of [out, income]) assertWritable(db, side.box, side.entry.date)
  const facts = { date: out.entry.date, cents: out.entry.cents, purpose: text }
  return db.transaction((tx) => {
    tx.delete(cashEntries).where(eq(cashEntries.transferId, id)).run()
    const dropped = dropUnusedReceipts(tx, [out.entry.receiptId, income.entry.receiptId])
    logCash(tx, out.box.id, actor, 'transfer_deleted', `an ${income.box.name}: ${describeCashEntry(facts)}`, monthOf(facts.date), now)
    logCash(tx, income.box.id, actor, 'transfer_deleted', `von ${out.box.name}: ${describeCashEntry(facts)}`, monthOf(facts.date), now)
    return dropped
  })
}

/**
 * The month's sheet of a box of the facility (opening, rows with numbers and running balance), closing and log; not
 * before the start month (400 cash_before_start), not after the running month (400 cash_month_future).
 */
export function cashMonth(db: Db, facilityId: number, boxId: number, year: number, month: number, today: IsoDate): CashMonthDto {
  const box = loadBox(db, facilityId, boxId)
  if (monthKey(year, month) < startKey(box)) throw new ServiceError(400, 'cash_before_start')
  if (monthKey(year, month) > monthOf(today)) throw new ServiceError(400, 'cash_month_future')
  const last = toIsoDate(year, month, daysInMonth(year, month))
  const stored = db.select().from(cashEntries).where(and(eq(cashEntries.boxId, boxId), lte(cashEntries.date, last)))
    .orderBy(asc(cashEntries.date), asc(cashEntries.id)).all()
  const facts: CashEntryFact[] = stored.map(row => ({
    id: row.id, date: row.date, direction: row.direction, cents: row.cents, purpose: row.purpose,
    hasReceipt: row.receiptId !== null, transferId: row.transferId,
  }))
  const sheet = monthSheet({
    kind: box.kind, startBalance: box.startBalance, startMonth: { year: box.startYear, month: box.startMonth }, year, month, entries: facts,
  })

  const byId = new Map(stored.map(row => [row.id, row]))
  const transferIds = sheet.rows.map(row => row.transferId).filter((value): value is number => value !== null)
  const others = new Map<number, { boxId: number; name: string }>()
  if (transferIds.length > 0) {
    for (const row of db.select({ transferId: cashEntries.transferId, boxId: cashBoxes.id, name: cashBoxes.name }).from(cashEntries)
      .innerJoin(cashBoxes, eq(cashBoxes.id, cashEntries.boxId))
      .where(and(inArray(cashEntries.transferId, transferIds), ne(cashEntries.boxId, boxId))).all()) {
      others.set(row.transferId!, { boxId: row.boxId, name: row.name })
    }
  }
  const closed = db.select({ at: cashClosedMonths.closedAt, by: cashClosedMonths.closedBy }).from(cashClosedMonths).where(and(
    eq(cashClosedMonths.boxId, boxId), eq(cashClosedMonths.year, year), eq(cashClosedMonths.month, month),
  )).get() ?? null

  return {
    box: boxInfo(db, box),
    year,
    month,
    opening: sheet.opening,
    income: sheet.income,
    expense: sheet.expense,
    closing: sheet.closing,
    negative: sheet.negative,
    rows: sheet.rows.map((row) => {
      const other = row.transferId === null ? undefined : others.get(row.transferId)
      const transfer: CashTransferInfo | null = other
        ? { otherBoxId: other.boxId, otherBoxName: other.name, text: byId.get(row.id)?.transferText ?? '' }
        : null
      return { ...row, receiptId: byId.get(row.id)?.receiptId ?? null, transfer }
    }),
    closed,
    log: monthLog(db, boxId, year, month),
  }
}

/** Purposes of the facility's entries (transfers excluded) containing the query, most used first, at most 8. */
export function purposeSuggestions(db: Db, facilityId: number, query: string): string[] {
  const folded = (value: string) => value.toLocaleLowerCase('de')
  const needle = folded(query.trim())
  return db.select({ purpose: cashEntries.purpose, uses: count(), last: max(cashEntries.id) }).from(cashEntries)
    .innerJoin(cashBoxes, eq(cashBoxes.id, cashEntries.boxId))
    .where(and(eq(cashBoxes.facilityId, facilityId), isNull(cashEntries.transferId)))
    .groupBy(cashEntries.purpose).all()
    .filter(row => folded(row.purpose).includes(needle))
    .sort((a, b) => b.uses - a.uses || (b.last ?? 0) - (a.last ?? 0))
    .slice(0, 8)
    .map(row => row.purpose)
}
