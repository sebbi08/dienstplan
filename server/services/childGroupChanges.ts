import { and, asc, eq, gt, gte, isNotNull, isNull, lte, or } from 'drizzle-orm'
import type { AdmissionStatus } from '../../shared/domain/children'
import { isValidIsoDate } from '../../shared/domain/dates'
import type { GroupEntry } from '../../shared/domain/occupancy'
import type { IsoDate } from '../../shared/domain/types'
import {
  REVIEW_SECTIONS, type GroupChangeDto, type GroupChangeInput, type ReviewSection, type SessionUser,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { childGroupChanges, children, groups } from '../db/schema'
import { loadEditableChild, type ChildRow } from '../lib/childRecord'
import { ServiceError } from '../lib/errors'
import { assertGroup } from './groups'

type ChangeRow = typeof childGroupChanges.$inferSelect
type Keep = Record<ReviewSection, boolean>

/**
 * The order in which every history is read: the start entry (no date; SQLite sorts NULL first), then by day. A child
 * has one start entry and at most one entry per day (unique indexes), so the id never has to decide between two
 * entries for the same day.
 */
const HISTORY_ORDER = [asc(childGroupChanges.fromDate), asc(childGroupChanges.id)]

const KEEP_COLUMN = {
  contacts: 'keepContacts', health: 'keepHealth', consents: 'keepConsents', documents: 'keepDocuments',
  careType: 'keepCareType', keyEducator: 'keepKeyEducator',
} as const satisfies Record<ReviewSection, keyof ChangeRow>

const REVIEW_COLUMN = {
  contacts: 'contactsReviewSince', health: 'healthReviewSince', consents: 'consentsReviewSince',
  documents: 'documentsReviewSince', careType: 'careTypeReviewSince', keyEducator: 'keyEducatorReviewSince',
} as const satisfies Record<ReviewSection, keyof ChildRow>

function keepOf(row: ChangeRow): Keep {
  return Object.fromEntries(REVIEW_SECTIONS.map(section => [section, row[KEEP_COLUMN[section]]])) as Keep
}

function keepColumns(keep: Keep): Pick<ChangeRow, (typeof KEEP_COLUMN)[ReviewSection]> {
  return Object.fromEntries(REVIEW_SECTIONS.map(section => [KEEP_COLUMN[section], keep[section]])) as
    Pick<ChangeRow, (typeof KEEP_COLUMN)[ReviewSection]>
}

/** A child's history, planned changes included, in the history order. */
function historyOf(db: Db, childId: number): ChangeRow[] {
  return db.select().from(childGroupChanges).where(eq(childGroupChanges.childId, childId)).orderBy(...HISTORY_ORDER).all()
}

/**
 * The group histories of the facility's children for the counting rule, planned changes included, each in the history
 * order. A group that is not the facility's (from before the child moved here) counts as no group.
 */
export function groupHistories(db: Db, facilityId: number): Map<number, GroupEntry[]> {
  const rows = db.select({ childId: childGroupChanges.childId, from: childGroupChanges.fromDate, groupId: groups.id })
    .from(childGroupChanges)
    .innerJoin(children, eq(children.id, childGroupChanges.childId))
    .leftJoin(groups, and(eq(groups.id, childGroupChanges.groupId), eq(groups.facilityId, facilityId)))
    .where(eq(children.facilityId, facilityId)).orderBy(...HISTORY_ORDER).all()
  const histories = new Map<number, GroupEntry[]>()
  for (const { childId, from, groupId } of rows) {
    const entries = histories.get(childId) ?? []
    entries.push({ from, groupId })
    histories.set(childId, entries)
  }
  return histories
}

/** The child's planned change that is not applied yet, for its record. */
export function pendingGroupChange(db: Db, childId: number): GroupChangeDto | null {
  const row = db.select({ change: childGroupChanges, groupName: groups.name }).from(childGroupChanges)
    .innerJoin(groups, eq(groups.id, childGroupChanges.groupId))
    .where(and(eq(childGroupChanges.childId, childId), isNull(childGroupChanges.appliedAt), isNotNull(childGroupChanges.fromDate)))
    .orderBy(...HISTORY_ORDER).get()
  if (!row) return null
  const { change, groupName } = row
  return { id: change.id, groupId: change.groupId!, groupName, date: change.fromDate!, keep: keepOf(change) }
}

/**
 * Writes the applied entry of a day (null = the start entry). An entry the child already has for that day is replaced
 * instead of getting a second one beside it; it keeps its sections to confirm and the time it was applied.
 */
function putAppliedEntry(
  db: Db, childId: number, fromDate: IsoDate | null, groupId: number | null, actorId: number | null, now: Date,
): void {
  const at = now.toISOString()
  const sameDay = fromDate === null ? isNull(childGroupChanges.fromDate) : eq(childGroupChanges.fromDate, fromDate)
  const existing = db.select().from(childGroupChanges).where(and(eq(childGroupChanges.childId, childId), sameDay)).get()
  if (existing) {
    db.update(childGroupChanges).set({ groupId, appliedAt: existing.appliedAt ?? at })
      .where(eq(childGroupChanges.id, existing.id)).run()
  }
  else {
    db.insert(childGroupChanges).values({ childId, groupId, fromDate, appliedAt: at, createdBy: actorId, createdAt: at }).run()
  }
}

/** The start entry of a new child's history: its group from the beginning. */
export function recordStartGroup(db: Db, childId: number, groupId: number | null, actorId: number, now: Date): void {
  putAppliedEntry(db, childId, null, groupId, actorId, now)
}

/**
 * Applies the planned changes whose day has come (`childId`: only this child's), oldest first: the child gets the
 * group and, for every section that is not kept, the mark "not confirmed since the change day". Children who left
 * before the change day are skipped. Must run inside a transaction.
 */
function applyDue(db: Db, today: IsoDate, now: Date, childId?: number): number {
  const due = db.select({ change: childGroupChanges }).from(childGroupChanges)
    .innerJoin(children, eq(children.id, childGroupChanges.childId))
    .where(and(
      isNull(childGroupChanges.appliedAt),
      lte(childGroupChanges.fromDate, today),
      or(isNull(children.leftOn), gte(children.leftOn, childGroupChanges.fromDate)),
      childId === undefined ? undefined : eq(childGroupChanges.childId, childId),
    )).orderBy(...HISTORY_ORDER).all()
  for (const { change } of due) {
    const keep = keepOf(change)
    const marks = Object.fromEntries(REVIEW_SECTIONS.filter(section => !keep[section])
      .map(section => [REVIEW_COLUMN[section], change.fromDate]))
    db.update(children).set({ groupId: change.groupId, ...marks }).where(eq(children.id, change.childId)).run()
    db.update(childGroupChanges).set({ appliedAt: now.toISOString() }).where(eq(childGroupChanges.id, change.id)).run()
  }
  return due.length
}

/**
 * The daily run: applies every planned change with a day up to today and returns how many. Running it again changes
 * nothing, because an applied change is never picked up a second time.
 */
export function applyDueGroupChanges(db: Db, today: IsoDate, now: Date = new Date()): number {
  return db.transaction(tx => applyDue(tx, today, now))
}

/**
 * The rules for a planned change, checked against the child's other entries (in the history order): a valid day, a
 * group of the facility (404 group_not_found) other than the one the child is in on that day (400 same_group), a day
 * after the last applied change (400 group_change_order) and not after the day the child leaves
 * (400 group_change_after_leaving), since such a change would never be applied.
 */
function assertChange(db: Db, facilityId: number, child: ChildRow, input: GroupChangeInput, others: ChangeRow[]): void {
  if (child.admissionStatus === 'waitlist') throw new ServiceError(400, 'waitlist_no_group_change')
  if (!isValidIsoDate(input.date)) throw new ServiceError(400, 'invalid_date')
  assertGroup(db, facilityId, input.groupId)
  let groupThen: number | null = null
  for (const entry of others) {
    if (entry.fromDate === null || entry.fromDate <= input.date) groupThen = entry.groupId
  }
  if (groupThen === input.groupId) throw new ServiceError(400, 'same_group')
  if (others.some(entry => entry.appliedAt !== null && entry.fromDate !== null && entry.fromDate >= input.date)) {
    throw new ServiceError(400, 'group_change_order')
  }
  if (child.leftOn !== null && input.date > child.leftOn) throw new ServiceError(400, 'group_change_after_leaving')
}

/**
 * Plans a group change of a contract child that has not left (409 child_archived, 400 waitlist_no_group_change); the
 * rules are those of `assertChange`, and a child has at most one change that is not applied yet
 * (409 group_change_pending). A change dated today or earlier is applied at once.
 */
export function planGroupChange(
  db: Db, actor: SessionUser, facilityId: number, childId: number, input: GroupChangeInput, today: IsoDate,
  now: Date = new Date(),
): void {
  db.transaction((tx) => {
    const child = loadEditableChild(tx, actor, facilityId, childId, today)
    // What is due counts as applied, even when the daily run has not come by yet.
    applyDue(tx, today, now, childId)
    const history = historyOf(tx, childId)
    assertChange(tx, facilityId, child, input, history)
    if (history.some(entry => entry.appliedAt === null)) throw new ServiceError(409, 'group_change_pending')
    tx.insert(childGroupChanges).values({
      childId, groupId: input.groupId, fromDate: input.date, ...keepColumns(input.keep), createdBy: actor.id,
      createdAt: now.toISOString(),
    }).run()
    if (input.date <= today) applyDue(tx, today, now, childId)
  })
}

/**
 * The facility's planned change with this id that is not applied yet; unknown or of another facility's child:
 * 404 group_change_not_found, applied (the start entry included): 409 group_change_applied.
 */
function loadChange(db: Db, facilityId: number, changeId: number): ChangeRow {
  const row = db.select({ change: childGroupChanges }).from(childGroupChanges)
    .innerJoin(children, eq(children.id, childGroupChanges.childId))
    .where(and(eq(childGroupChanges.id, changeId), eq(children.facilityId, facilityId))).get()
  if (!row) throw new ServiceError(404, 'group_change_not_found')
  if (row.change.appliedAt !== null) throw new ServiceError(409, 'group_change_applied')
  return row.change
}

/**
 * Changes a planned change that is not applied yet (409 group_change_applied, also for the start entry), with the
 * rules of planning. Moved to today or earlier it is applied at once.
 */
export function updateGroupChange(
  db: Db, actor: SessionUser, facilityId: number, changeId: number, input: GroupChangeInput, today: IsoDate,
  now: Date = new Date(),
): void {
  db.transaction((tx) => {
    const change = loadChange(tx, facilityId, changeId)
    const child = loadEditableChild(tx, actor, facilityId, change.childId, today)
    assertChange(tx, facilityId, child, input, historyOf(tx, child.id).filter(entry => entry.id !== changeId))
    tx.update(childGroupChanges).set({ groupId: input.groupId, fromDate: input.date, ...keepColumns(input.keep) })
      .where(eq(childGroupChanges.id, changeId)).run()
    if (input.date <= today) applyDue(tx, today, now, child.id)
  })
}

/** Deletes a planned change that is not applied yet (409 group_change_applied, also for the start entry). */
export function deleteGroupChange(db: Db, facilityId: number, changeId: number): void {
  const change = loadChange(db, facilityId, changeId)
  db.delete(childGroupChanges).where(eq(childGroupChanges.id, change.id)).run()
}

/**
 * Another group was chosen in the master data: the child gets it at once. For a child that has not started (waitlist,
 * or no contract start up to today) and has no applied dated change, only the start group changes; otherwise the
 * history gets a change dated today that keeps every section. A planned change for a later day stays as it is.
 * Must run inside a transaction.
 */
export function changeGroupDirectly(
  db: Db, actor: SessionUser,
  child: { id: number; admissionStatus: AdmissionStatus; entryDate: IsoDate | null; plannedEntryDate: IsoDate | null },
  groupId: number | null, today: IsoDate, now: Date,
): void {
  // What is due is applied first: its marks are set and today's entry, if any, is the one that gets replaced.
  applyDue(db, today, now, child.id)
  const current = db.select({ groupId: children.groupId }).from(children).where(eq(children.id, child.id)).get()
  if (!current || current.groupId === groupId) return
  const start = child.entryDate ?? child.plannedEntryDate
  const started = child.admissionStatus === 'contract' && start !== null && start <= today
  const hasAppliedChange = historyOf(db, child.id).some(entry => entry.fromDate !== null && entry.appliedAt !== null)
  putAppliedEntry(db, child.id, (started || hasAppliedChange) ? today : null, groupId, actor.id, now)
  db.update(children).set({ groupId }).where(eq(children.id, child.id)).run()
}

/** The child leaves on `leftOn`: a planned change after that day is deleted, so it can never be applied. */
export function deleteChangesAfterLeaving(db: Db, childId: number, leftOn: IsoDate): void {
  db.delete(childGroupChanges).where(and(
    eq(childGroupChanges.childId, childId), isNull(childGroupChanges.appliedAt), gt(childGroupChanges.fromDate, leftOn),
  )).run()
}

/**
 * The child moves to another facility: its history ends with "no group from today" and a planned change is deleted
 * (the caller clears the group on the child). Must run inside a transaction.
 */
export function endGroupHistory(db: Db, childId: number, today: IsoDate, now: Date): void {
  applyDue(db, today, now, childId)
  db.delete(childGroupChanges).where(and(eq(childGroupChanges.childId, childId), isNull(childGroupChanges.appliedAt))).run()
  putAppliedEntry(db, childId, today, null, null, now)
}
