import { and, asc, eq, max } from 'drizzle-orm'
import { SHEET_COLUMNS_MAX, SHEET_NAME_MAX, isOverviewFieldKey, type OverviewColumnRef } from '../../shared/domain/childConsents'
import type { OverviewSheetDto, OverviewSheetInput } from '../../shared/types/api'
import type { Db } from '../db/client'
import { childConsentQuestions, childOverviewSheets } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { uniqueName } from '../lib/uniqueName'

// The tabs of the children overview (Kinder → Übersicht), each facility its own (Einstellungen → Kinder → Reiter der
// Übersicht): a name and the columns in order, consent questions of the facility and fixed fields.

type SheetRow = typeof childOverviewSheets.$inferSelect

const toDto = (row: SheetRow): OverviewSheetDto => ({ id: row.id, name: row.name, sortOrder: row.sortOrder, columns: row.columns })

function sheetRows(db: Db, facilityId: number): SheetRow[] {
  return db.select().from(childOverviewSheets).where(eq(childOverviewSheets.facilityId, facilityId))
    .orderBy(asc(childOverviewSheets.sortOrder), asc(childOverviewSheets.id)).all()
}

/** The facility's tabs in their order. */
export function listOverviewSheets(db: Db, facilityId: number): OverviewSheetDto[] {
  return sheetRows(db, facilityId).map(toDto)
}

function loadSheet(db: Db, facilityId: number, id: number): SheetRow {
  const row = db.select().from(childOverviewSheets)
    .where(and(eq(childOverviewSheets.id, id), eq(childOverviewSheets.facilityId, facilityId))).get()
  if (!row) throw new ServiceError(404, 'overview_sheet_not_found')
  return row
}

/** A trimmed name of 1–40 characters no other tab of the facility has (regardless of case). */
function checkedName(db: Db, facilityId: number, name: string, exceptId: number | null = null): string {
  if (name.trim().length > SHEET_NAME_MAX) throw new ServiceError(400, 'overview_sheet_name_required')
  return uniqueName(sheetRows(db, facilityId), name, exceptId, { required: 'overview_sheet_name_required', taken: 'overview_sheet_name_taken' })
}

/**
 * The columns as stored: known fields and questions of the facility only (400 overview_column_unknown, also for a
 * question of another facility), each once (400 overview_column_twice), at most SHEET_COLUMNS_MAX. A hidden question
 * may stay a column (the settings show a hint); it still shows its answers.
 */
function checkedColumns(db: Db, facilityId: number, columns: OverviewColumnRef[]): OverviewColumnRef[] {
  if (columns.length > SHEET_COLUMNS_MAX) throw new ServiceError(400, 'overview_too_many_columns')
  const questions = new Set(db.select({ id: childConsentQuestions.id }).from(childConsentQuestions)
    .where(eq(childConsentQuestions.facilityId, facilityId)).all().map(row => row.id))
  const seen = new Set<string>()
  return columns.map((column) => {
    const valid = column.type === 'field' ? isOverviewFieldKey(column.key) : column.type === 'consent' && questions.has(column.questionId)
    if (!valid) throw new ServiceError(400, 'overview_column_unknown')
    const key = column.type === 'field' ? `field:${column.key}` : `consent:${column.questionId}`
    if (seen.has(key)) throw new ServiceError(400, 'overview_column_twice')
    seen.add(key)
    return column.type === 'field' ? { type: 'field', key: column.key } : { type: 'consent', questionId: column.questionId }
  })
}

/** A new tab at the end. */
export function createOverviewSheet(db: Db, facilityId: number, input: OverviewSheetInput): OverviewSheetDto {
  const name = checkedName(db, facilityId, input.name)
  const columns = checkedColumns(db, facilityId, input.columns)
  return db.transaction((tx) => {
    const sortOrder = (tx.select({ value: max(childOverviewSheets.sortOrder) }).from(childOverviewSheets)
      .where(eq(childOverviewSheets.facilityId, facilityId)).get()?.value ?? -1) + 1
    return toDto(tx.insert(childOverviewSheets).values({ facilityId, name, sortOrder, columns }).returning().get())
  })
}

/** Renames the tab and sets its columns. */
export function updateOverviewSheet(db: Db, facilityId: number, id: number, input: OverviewSheetInput): OverviewSheetDto {
  loadSheet(db, facilityId, id)
  const name = checkedName(db, facilityId, input.name, id)
  const columns = checkedColumns(db, facilityId, input.columns)
  return toDto(db.update(childOverviewSheets).set({ name, columns }).where(eq(childOverviewSheets.id, id)).returning().get())
}

export function deleteOverviewSheet(db: Db, facilityId: number, id: number): void {
  loadSheet(db, facilityId, id)
  db.delete(childOverviewSheets).where(eq(childOverviewSheets.id, id)).run()
}

/** The new order of all the facility's tabs (400 invalid_order unless it is exactly them, each once). */
export function reorderOverviewSheets(db: Db, facilityId: number, ids: number[]): void {
  const existing = new Set(sheetRows(db, facilityId).map(row => row.id))
  if (ids.length !== existing.size || new Set(ids).size !== ids.length || !ids.every(id => existing.has(id))) {
    throw new ServiceError(400, 'invalid_order')
  }
  db.transaction((tx) => {
    ids.forEach((id, index) => tx.update(childOverviewSheets).set({ sortOrder: index }).where(eq(childOverviewSheets.id, id)).run())
  })
}
