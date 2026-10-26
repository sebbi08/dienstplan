import { and, asc, eq, inArray, isNotNull, isNull, max, ne, notInArray, sql } from 'drizzle-orm'
import { formatCents, monthKey, type CashDirection, type CashKind, type YearMonth } from '../../shared/domain/cash'
import type { IsoDate } from '../../shared/domain/types'
import type { CashBoxDto, CashBoxInfoDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { cashBoxes, cashClosedMonths, cashEntries, cashLog, groups } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { uniqueName } from '../lib/uniqueName'
import { BOX_LOG_ACTIONS, type CashActor, describeChanges, logCash } from './cashLog'
import { assertGroup } from './groups'

export type CashBoxRow = typeof cashBoxes.$inferSelect

export interface CashBoxInput {
  name: string
  kind: CashKind
  groupId: number | null
  startYear: number
  startMonth: number
  startBalance: number
}

export const CASH_BOX_NAME_MAX = 60
export const KIND_LABELS: Record<CashKind, string> = { cash: 'Bar', account: 'EC/Konto' }

/** A box of the facility; another facility's box is 404 cash_box_not_found (no existence leak). */
export function loadBox(db: Db, facilityId: number, id: number): CashBoxRow {
  const row = db.select().from(cashBoxes).where(and(eq(cashBoxes.id, id), eq(cashBoxes.facilityId, facilityId))).get()
  if (!row) throw new ServiceError(404, 'cash_box_not_found')
  return row
}

/** The box's closed months as 'YYYY-MM'. */
export function closedMonths(db: Db, boxId: number): Set<string> {
  return new Set(db.select({ year: cashClosedMonths.year, month: cashClosedMonths.month }).from(cashClosedMonths)
    .where(eq(cashClosedMonths.boxId, boxId)).all().map(row => monthKey(row.year, row.month)))
}

/** 409 cash_month_closed when the date's month is closed in the box. */
export function assertMonthOpen(db: Db, boxId: number, date: IsoDate): void {
  const [year, month] = date.split('-').map(Number) as [number, number]
  const row = db.select({ boxId: cashClosedMonths.boxId }).from(cashClosedMonths).where(and(
    eq(cashClosedMonths.boxId, boxId), eq(cashClosedMonths.year, year), eq(cashClosedMonths.month, month),
  )).get()
  if (row) throw new ServiceError(409, 'cash_month_closed')
}

/** 409 cash_box_archived for a stillgelegte box. */
export function assertActive(box: CashBoxRow): void {
  if (box.archived) throw new ServiceError(409, 'cash_box_archived')
}

export const startKey = (box: Pick<CashBoxRow, 'startYear' | 'startMonth'>) => monthKey(box.startYear, box.startMonth)

const scopeLabel = (groupName: string | null) => groupName ?? 'Einrichtung'
const monthLabel = (year: number, month: number) => `${String(month).padStart(2, '0')}/${year}`

function groupName(db: Db, groupId: number | null): string | null {
  if (groupId === null) return null
  return db.select({ name: groups.name }).from(groups).where(eq(groups.id, groupId)).get()?.name ?? null
}

function toInfo(row: CashBoxRow, name: string | null): CashBoxInfoDto {
  return {
    id: row.id, name: row.name, kind: row.kind, groupId: row.groupId, groupName: name, startYear: row.startYear,
    startMonth: row.startMonth, startBalance: row.startBalance, archived: row.archived, sortOrder: row.sortOrder,
  }
}

export function boxInfo(db: Db, row: CashBoxRow): CashBoxInfoDto {
  return toInfo(row, groupName(db, row.groupId))
}

/**
 * The facility's boxes: active ones first, then the facility's own before the groups' (in the groups' order), within
 * a scope by their order. Each with today's balance, the latest closed month and whether receipts are missing.
 */
export function listBoxes(db: Db, facilityId: number, today: IsoDate): CashBoxDto[] {
  const rows = db.select({ box: cashBoxes, groupName: groups.name, groupOrder: groups.sortOrder }).from(cashBoxes)
    .leftJoin(groups, eq(groups.id, cashBoxes.groupId)).where(eq(cashBoxes.facilityId, facilityId)).all()
  const ids = rows.map(row => row.box.id)
  if (ids.length === 0) return []

  const balances = new Map(db.select({
    boxId: cashEntries.boxId,
    total: sql<number>`coalesce(sum(case when ${cashEntries.direction} = 'in' then ${cashEntries.cents} else -${cashEntries.cents} end), 0)`,
  }).from(cashEntries).where(and(inArray(cashEntries.boxId, ids), sql`${cashEntries.date} <= ${today}`))
    .groupBy(cashEntries.boxId).all().map(row => [row.boxId, Number(row.total)]))
  const withEntries = new Set(db.selectDistinct({ boxId: cashEntries.boxId }).from(cashEntries)
    .where(inArray(cashEntries.boxId, ids)).all().map(row => row.boxId))
  const closedThrough = new Map<number, YearMonth>()
  for (const row of db.select({ boxId: cashClosedMonths.boxId, year: cashClosedMonths.year, month: cashClosedMonths.month })
    .from(cashClosedMonths).where(inArray(cashClosedMonths.boxId, ids)).all()) {
    const current = closedThrough.get(row.boxId)
    if (!current || monthKey(row.year, row.month) > monthKey(current.year, current.month)) {
      closedThrough.set(row.boxId, { year: row.year, month: row.month })
    }
  }
  // Expenses without receipt in the open period; a transfer's receipt is optional.
  const missing = new Set<number>()
  for (const row of db.select({ boxId: cashEntries.boxId, date: cashEntries.date }).from(cashEntries).where(and(
    inArray(cashEntries.boxId, ids), eq(cashEntries.direction, 'out'), isNull(cashEntries.receiptId), isNull(cashEntries.transferId),
  )).all()) {
    const closed = closedThrough.get(row.boxId)
    if (!closed || row.date.slice(0, 7) > monthKey(closed.year, closed.month)) missing.add(row.boxId)
  }

  return rows
    .sort((a, b) => Number(a.box.archived) - Number(b.box.archived)
      || Number(a.box.groupId !== null) - Number(b.box.groupId !== null)
      || (a.groupOrder ?? 0) - (b.groupOrder ?? 0) || (a.box.groupId ?? 0) - (b.box.groupId ?? 0)
      || a.box.sortOrder - b.box.sortOrder || a.box.id - b.box.id)
    .map(({ box, groupName: name }) => ({
      ...toInfo(box, name),
      balanceToday: box.startBalance + (balances.get(box.id) ?? 0),
      closedThrough: closedThrough.get(box.id) ?? null,
      missingReceipts: missing.has(box.id),
      hasEntries: withEntries.has(box.id),
    }))
}

/** Trimmed name (1–60 chars, unique in the facility regardless of case), checked group and start values. */
function checkedInput(db: Db, facilityId: number, input: CashBoxInput, exceptId: number | null): CashBoxInput {
  const existing = db.select({ id: cashBoxes.id, name: cashBoxes.name }).from(cashBoxes).where(eq(cashBoxes.facilityId, facilityId)).all()
  const name = uniqueName(existing, input.name, exceptId, { required: 'cash_box_name_required', taken: 'cash_box_name_taken' })
  if (name.length > CASH_BOX_NAME_MAX) throw new ServiceError(400, 'cash_box_name_too_long')
  if (input.kind !== 'cash' && input.kind !== 'account') throw new ServiceError(400, 'cash_box_kind_invalid')
  assertGroup(db, facilityId, input.groupId)
  if (!Number.isInteger(input.startYear) || !Number.isInteger(input.startMonth) || input.startMonth < 1 || input.startMonth > 12) {
    throw new ServiceError(400, 'cash_start_month_invalid')
  }
  if (!Number.isSafeInteger(input.startBalance) || input.startBalance < 0) throw new ServiceError(400, 'cash_start_balance_invalid')
  return { ...input, name }
}

function nextSortOrder(db: Db, facilityId: number, groupId: number | null): number {
  const row = db.select({ value: max(cashBoxes.sortOrder) }).from(cashBoxes).where(and(
    eq(cashBoxes.facilityId, facilityId), groupId === null ? isNull(cashBoxes.groupId) : eq(cashBoxes.groupId, groupId),
  )).get()
  return (row?.value ?? -1) + 1
}

/** A new box at the end of its scope; returns its id. */
export function createBox(db: Db, actor: CashActor, facilityId: number, input: CashBoxInput, now: Date = new Date()): number {
  const values = checkedInput(db, facilityId, input, null)
  return db.transaction((tx) => {
    const id = tx.insert(cashBoxes).values({
      facilityId, ...values, archived: false, sortOrder: nextSortOrder(tx, facilityId, values.groupId), createdAt: now.toISOString(),
    }).returning({ id: cashBoxes.id }).get().id
    logCash(tx, id, actor, 'box_created', `${values.name} (${KIND_LABELS[values.kind]}, ${scopeLabel(groupName(tx, values.groupId))}, `
      + `ab ${monthLabel(values.startYear, values.startMonth)}, Anfangsbestand ${formatCents(values.startBalance)})`, null, now)
    return id
  })
}

/**
 * Renames the box, changes kind, scope, start values and archived. Start month and start balance only change while
 * the start month is open, and the start month never moves past an entry. Moving to another scope puts it last there.
 */
export function updateBox(
  db: Db, actor: CashActor, facilityId: number, id: number, input: CashBoxInput & { archived: boolean }, now: Date = new Date(),
): void {
  const box = loadBox(db, facilityId, id)
  const values = checkedInput(db, facilityId, input, id)
  const startChanged = values.startYear !== box.startYear || values.startMonth !== box.startMonth
  if (startChanged || values.startBalance !== box.startBalance) {
    if (closedMonths(db, id).has(startKey(box))) throw new ServiceError(409, 'cash_month_closed')
  }
  if (startChanged) {
    const first = db.select({ date: cashEntries.date }).from(cashEntries).where(eq(cashEntries.boxId, id))
      .orderBy(asc(cashEntries.date)).limit(1).get()
    if (first && first.date.slice(0, 7) < monthKey(values.startYear, values.startMonth)) {
      throw new ServiceError(409, 'cash_entries_before_start')
    }
  }
  db.transaction((tx) => {
    const sortOrder = values.groupId === box.groupId ? box.sortOrder : nextSortOrder(tx, facilityId, values.groupId)
    tx.update(cashBoxes).set({ ...values, archived: input.archived, sortOrder }).where(eq(cashBoxes.id, id)).run()
    const changes = describeChanges([
      ['Name', box.name, values.name],
      ['Art', KIND_LABELS[box.kind], KIND_LABELS[values.kind]],
      ['Zuordnung', scopeLabel(groupName(tx, box.groupId)), scopeLabel(groupName(tx, values.groupId))],
      ['Startmonat', monthLabel(box.startYear, box.startMonth), monthLabel(values.startYear, values.startMonth)],
      ['Anfangsbestand', formatCents(box.startBalance), formatCents(values.startBalance)],
    ])
    if (changes) logCash(tx, id, actor, 'box_updated', changes, null, now)
    if (input.archived !== box.archived) logCash(tx, id, actor, input.archived ? 'box_archived' : 'box_activated', values.name, null, now)
    if (values.name !== box.name) renameInTransfers(tx, id, values.name)
  })
}

/** „Umbuchung an ‹Kasse›: ‹text›“ (expense) or „Umbuchung von ‹Kasse›: ‹text›“ (income). */
export const transferPurpose = (direction: CashDirection, otherName: string, text: string) =>
  `Umbuchung ${direction === 'out' ? 'an' : 'von'} ${otherName}: ${text}`

/**
 * After a rename: the other boxes' transfer rows naming this box get the new name, in open months of active boxes only
 * (closed months and archived boxes stay as they are).
 */
function renameInTransfers(tx: Db, boxId: number, name: string): void {
  const ids = tx.select({ transferId: cashEntries.transferId }).from(cashEntries)
    .where(and(eq(cashEntries.boxId, boxId), isNotNull(cashEntries.transferId))).all().map(row => row.transferId!)
  if (ids.length === 0) return
  const closed = new Map<number, Set<string>>()
  for (const { entry, archived } of tx.select({ entry: cashEntries, archived: cashBoxes.archived }).from(cashEntries)
    .innerJoin(cashBoxes, eq(cashBoxes.id, cashEntries.boxId))
    .where(and(inArray(cashEntries.transferId, ids), ne(cashEntries.boxId, boxId))).all()) {
    if (archived) continue
    if (!closed.has(entry.boxId)) closed.set(entry.boxId, closedMonths(tx, entry.boxId))
    if (closed.get(entry.boxId)!.has(entry.date.slice(0, 7))) continue
    tx.update(cashEntries).set({ purpose: transferPurpose(entry.direction, name, entry.transferText ?? '') })
      .where(eq(cashEntries.id, entry.id)).run()
  }
}

/**
 * Deletes a box that never had entries or closings (its few box lines and nothing else go along); one with entries
 * is 409 cash_box_has_entries, one whose log has more than box lines 409 cash_box_has_history (only archive it).
 */
export function deleteBox(db: Db, facilityId: number, id: number): void {
  loadBox(db, facilityId, id)
  if (db.select({ id: cashEntries.id }).from(cashEntries).where(eq(cashEntries.boxId, id)).get()) {
    throw new ServiceError(409, 'cash_box_has_entries')
  }
  if (db.select({ id: cashLog.id }).from(cashLog).where(and(eq(cashLog.boxId, id), notInArray(cashLog.action, BOX_LOG_ACTIONS))).get()) {
    throw new ServiceError(409, 'cash_box_has_history')
  }
  db.delete(cashBoxes).where(eq(cashBoxes.id, id)).run()
}
