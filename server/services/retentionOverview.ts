import { and, eq, isNotNull, lt } from 'drizzle-orm'
import { childStatus, purgeDate } from '../../shared/domain/children'
import { retentionDueDates, type RetentionSettings } from '../../shared/domain/retention'
import type { IsoDate } from '../../shared/domain/types'
import type { RetentionDeleteResult, RetentionItemCategory, RetentionItemDto, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { cashBoxes, children, employees, facilities } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { getChildRetentionYears } from './appSettings'
import { boxDeletableFrom } from './cashBoxes'
import { removeArchivedBox } from './cashPurge'
import { deleteChild } from './children'
import {
  categoryHasData, deleteCategories, deleteEmployeeRow, foreignKeyViolations, isForeignKeyError, RETENTION_CATEGORIES,
  type RetentionCategory,
} from './employeeDeletion'
import { getRetentionSettings } from './retentionSettings'

const ITEM_CATEGORIES: readonly RetentionItemCategory[] = [...RETENTION_CATEGORIES, 'record']
const KIND_ORDER: Record<RetentionItemDto['kind'], number> = { employee: 0, child: 1, cash: 2 }

type ItemKey =
  | { kind: 'employee'; id: number; category: RetentionItemCategory }
  | { kind: 'child' | 'cash'; id: number }

const KEY_PATTERN = /^(?:employee:([1-9]\d{0,15}):([A-Za-z]+)|(child|cash):([1-9]\d{0,15}))$/

/** `employee:<id>:<category>`, `child:<id>` or `cash:<id>`; anything else is 400 retention_key_invalid. */
function parseKey(key: string): ItemKey {
  const match = KEY_PATTERN.exec(key)
  const id = Number(match?.[1] ?? match?.[4])
  if (!match || !Number.isSafeInteger(id)) throw new ServiceError(400, 'retention_key_invalid')
  if (match[3]) return { kind: match[3] as 'child' | 'cash', id }
  const category = match[2] as RetentionItemCategory
  if (!ITEM_CATEGORIES.includes(category)) throw new ServiceError(400, 'retention_key_invalid')
  return { kind: 'employee', id, category }
}

/** Facility names, the retention settings per facility and the child retention, each read once per request. */
interface Context {
  today: IsoDate
  facilityName: (id: number) => string
  settings: (facilityId: number) => RetentionSettings
  childYears: () => number
}

function context(db: Db, today: IsoDate): Context {
  const names = new Map(db.select({ id: facilities.id, name: facilities.name }).from(facilities).all().map(row => [row.id, row.name]))
  const settings = new Map<number, RetentionSettings>()
  let childYears: number | null = null
  return {
    today,
    facilityName: id => names.get(id) ?? '',
    settings: (facilityId) => {
      if (!settings.has(facilityId)) settings.set(facilityId, getRetentionSettings(db, facilityId))
      return settings.get(facilityId)!
    },
    childYears: () => childYears ??= getChildRetentionYears(db),
  }
}

type EmployeeRow = { id: number; name: string; facilityId: number; leftOn: IsoDate }

/**
 * The items of an employee with a leaving day: one per category that holds data (categoryHasData), from its due date
 * (retentionDueDates with the facility's periods), and the record, due once no other category holds data. Nothing is
 * due before the day after leaving.
 */
function employeeItems(db: Db, employee: EmployeeRow, ctx: Context): RetentionItemDto[] {
  const hasData = categoryHasData(db, employee.id)
  const dueDates = retentionDueDates(employee.leftOn, ctx.settings(employee.facilityId))
  const left = employee.leftOn < ctx.today
  const item = (category: RetentionItemCategory, deletableFrom: IsoDate | null, due: boolean): RetentionItemDto => ({
    key: `employee:${employee.id}:${category}`, kind: 'employee', category, facilityId: employee.facilityId,
    facilityName: ctx.facilityName(employee.facilityId), name: employee.name, deletableFrom, due,
  })
  return [
    ...RETENTION_CATEGORIES.filter(category => hasData[category])
      .map(category => item(category, dueDates[category], left && dueDates[category] <= ctx.today)),
    item('record', null, left && RETENTION_CATEGORIES.every(category => !hasData[category])),
  ]
}

type ChildRow = { id: number; facilityId: number; firstName: string; lastName: string; leftOn: IsoDate }

function childItem(child: ChildRow, ctx: Context): RetentionItemDto {
  const deletableFrom = purgeDate(child.leftOn, ctx.childYears())
  return {
    key: `child:${child.id}`, kind: 'child', category: null, facilityId: child.facilityId,
    facilityName: ctx.facilityName(child.facilityId), name: `${child.firstName} ${child.lastName}`, deletableFrom,
    due: child.leftOn < ctx.today && deletableFrom <= ctx.today,
  }
}

type BoxRow = { id: number; facilityId: number; name: string }

/** An archived box, deletable from its deletableFrom as the cash page shows it (null: no entries or history, due). */
function cashItem(db: Db, box: BoxRow, ctx: Context): RetentionItemDto {
  const deletableFrom = boxDeletableFrom(db, box.facilityId, box.id)
  return {
    key: `cash:${box.id}`, kind: 'cash', category: null, facilityId: box.facilityId, facilityName: ctx.facilityName(box.facilityId),
    name: box.name, deletableFrom, due: deletableFrom === null || deletableFrom <= ctx.today,
  }
}

/** Due first (by facility, then name), then the later ones by date, the records without a date last. */
function compareItems(a: RetentionItemDto, b: RetentionItemDto): number {
  if (a.due !== b.due) return a.due ? -1 : 1
  if (!a.due && a.deletableFrom !== b.deletableFrom) {
    if (a.deletableFrom === null) return 1
    if (b.deletableFrom === null) return -1
    return a.deletableFrom < b.deletableFrom ? -1 : 1
  }
  return a.facilityName.localeCompare(b.facilityName, 'de') || a.facilityId - b.facilityId
    || a.name.localeCompare(b.name, 'de') || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    || ITEM_CATEGORIES.indexOf(a.category ?? 'record') - ITEM_CATEGORIES.indexOf(b.category ?? 'record')
    || a.key.localeCompare(b.key)
}

/**
 * What may be deleted after a retention period, in every facility (spec Löschübersicht §2): employees whose leaving
 * day has passed, an item per category with data and the record (employeeItems); archived child records from
 * purgeDate with the Träger's child retention; archived cash boxes from their deletableFrom. Each item says whether it
 * is due today (deletableFrom <= today). The app deletes nothing by itself; the Träger deletes from this list. The
 * route lets only the Träger read it.
 */
export function retentionOverview(db: Db, today: IsoDate): RetentionItemDto[] {
  const ctx = context(db, today)
  const left = db.select({ id: employees.id, name: employees.name, facilityId: employees.facilityId, leftOn: employees.leftOn })
    .from(employees).where(and(isNotNull(employees.leftOn), lt(employees.leftOn, today))).all() as EmployeeRow[]
  const archivedChildren = db.select({
    id: children.id, facilityId: children.facilityId, firstName: children.firstName, lastName: children.lastName,
    leftOn: children.leftOn, admissionStatus: children.admissionStatus, entryDate: children.entryDate,
  }).from(children).where(isNotNull(children.leftOn)).all().filter(row => childStatus(row, today) === 'archived') as ChildRow[]
  const boxes = db.select({ id: cashBoxes.id, facilityId: cashBoxes.facilityId, name: cashBoxes.name }).from(cashBoxes)
    .where(eq(cashBoxes.archived, true)).all()
  return [
    ...left.flatMap(employee => employeeItems(db, employee, ctx)),
    ...archivedChildren.map(child => childItem(child, ctx)),
    ...boxes.map(box => cashItem(db, box, ctx)),
  ].sort(compareItems)
}

/** The item the key names as the overview computes it (also before the leaving day); 404 retention_item_not_found. */
function findItem(db: Db, key: ItemKey, ctx: Context): RetentionItemDto {
  const missing = () => new ServiceError(404, 'retention_item_not_found')
  if (key.kind === 'employee') {
    const employee = db.select({ id: employees.id, name: employees.name, facilityId: employees.facilityId, leftOn: employees.leftOn })
      .from(employees).where(eq(employees.id, key.id)).get()
    if (!employee || employee.leftOn === null) throw missing()
    const item = employeeItems(db, employee as EmployeeRow, ctx).find(candidate => candidate.category === key.category)
    if (!item) throw missing()
    return item
  }
  if (key.kind === 'child') {
    const child = db.select().from(children).where(eq(children.id, key.id)).get()
    if (!child || child.leftOn === null || child.admissionStatus === 'waitlist') throw missing()
    return childItem(child as ChildRow, ctx)
  }
  const box = db.select().from(cashBoxes).where(eq(cashBoxes.id, key.id)).get()
  if (!box || !box.archived) throw missing()
  return cashItem(db, box, ctx)
}

/**
 * One transaction; a reference the deletion would leave behind (foreign key check, only violations it adds) or a
 * refused delete rolls it back with 409 retention_delete_blocked.
 */
function checkedTransaction(db: Db, write: (tx: Db) => number): number {
  const before = new Set(foreignKeyViolations(db))
  try {
    return db.transaction((tx) => {
      const changed = write(tx)
      if (foreignKeyViolations(tx).some(violation => !before.has(violation))) throw new ServiceError(409, 'retention_delete_blocked')
      return changed
    })
  }
  catch (error) {
    if (!(error instanceof ServiceError) && isForeignKeyError(error)) throw new ServiceError(409, 'retention_delete_blocked')
    throw error
  }
}

/** Deletes the item (checked to exist and be due); answers the rows deleted or cleared. */
function removeItem(db: Db, actor: SessionUser, key: ItemKey, ctx: Context, now: Date): number {
  const item = findItem(db, key, ctx)
  if (!item.due) throw new ServiceError(409, 'retention_not_due', item.deletableFrom ? { deletableFrom: item.deletableFrom } : undefined)
  if (key.kind === 'employee') {
    const { category } = key
    if (category === 'record') return checkedTransaction(db, tx => deleteEmployeeRow(tx, key.id))
    return checkedTransaction(db, tx => deleteCategories(tx, key.id, [category as RetentionCategory])[category as RetentionCategory])
  }
  if (key.kind === 'child') {
    return checkedTransaction(db, (tx) => {
      deleteChild(tx, item.facilityId, key.id)
      return 1
    })
  }
  const box = db.select().from(cashBoxes).where(eq(cashBoxes.id, key.id)).get()!
  return removeArchivedBox(db, actor, box, now).rows
}

function assertProvider(actor: SessionUser): void {
  if (actor.role !== 'provider') throw new ServiceError(403, 'forbidden')
}

/**
 * The Träger deletes one item of the overview, in the item's own facility (never the active one): an employee's
 * category (deleteCategories) or the employee row once nothing else is left, a child record with its contacts and
 * documents, an archived cash box (removeArchivedBox: the counterparts of its transfers stay). Due-ness is checked
 * again: 409 retention_not_due; 404 retention_item_not_found for an item that does not exist (any more), 400
 * retention_key_invalid, 403 forbidden for everyone but the Träger. Answers the rows deleted or cleared (the caller
 * checkpoints the WAL when that is more than 0).
 */
export function deleteRetentionItem(db: Db, actor: SessionUser, key: string, today: IsoDate, now: Date = new Date()): number {
  assertProvider(actor)
  return removeItem(db, actor, parseKey(key), context(db, today), now)
}

/**
 * „Alle fälligen löschen“: the given keys (as shown on the page), each in a transaction of its own. Due-ness is
 * decided once before anything is deleted, so an item that only becomes due on the way (a record whose other
 * categories went in the same request) stays until next time; employee records go after the categories. A key not
 * due, gone or invalid is skipped and reported (in the order given), the others are deleted. Answers how many items
 * were deleted. 403 forbidden for everyone but the Träger.
 */
export function deleteDueItems(
  db: Db, actor: SessionUser, keys: readonly string[], today: IsoDate, now: Date = new Date(),
): RetentionDeleteResult {
  assertProvider(actor)
  const ctx = context(db, today)
  const unique = [...new Set(keys)]
  const skipped = new Set<string>()
  const due: { key: string; parsed: ItemKey }[] = []
  for (const key of unique) {
    try {
      const parsed = parseKey(key)
      if (findItem(db, parsed, ctx).due) due.push({ key, parsed })
      else skipped.add(key)
    }
    catch (error) {
      if (!(error instanceof ServiceError)) throw error
      skipped.add(key)
    }
  }
  const isRecord = (parsed: ItemKey) => parsed.kind === 'employee' && parsed.category === 'record'
  let deleted = 0
  for (const { key, parsed } of [...due.filter(item => !isRecord(item.parsed)), ...due.filter(item => isRecord(item.parsed))]) {
    try {
      removeItem(db, actor, parsed, ctx, now)
      deleted++
    }
    catch (error) {
      if (!(error instanceof ServiceError)) throw error
      skipped.add(key)
    }
  }
  return { deleted, skipped: unique.filter(key => skipped.has(key)) }
}
