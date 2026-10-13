import { and, asc, eq, gt, gte, isNotNull, isNull, lte, or } from 'drizzle-orm'
import { isValidIsoDate } from '../../shared/domain/dates'
import { groupOnDay, type GroupEntry } from '../../shared/domain/occupancy'
import type { IsoDate } from '../../shared/domain/types'
import {
  KEEP_SECTIONS, type GroupChangeDto, type GroupChangeInput, type KeepSection, type ReviewSection, type SessionUser,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { childGroupChanges, children, groups } from '../db/schema'
import { loadEditableChild, REVIEW_COLUMN, type ChildRow } from '../lib/childRecord'
import { ServiceError } from '../lib/errors'
import { settleDocumentReview } from './documentReview'
import { assertGroup, isForSchoolChildren } from './groups'
// The two services call each other's functions (the school rules read the histories); neither does so while loading.
import { guardAgainstLeaving } from './schoolChildren'

type ChangeRow = typeof childGroupChanges.$inferSelect
type Keep = Record<KeepSection, boolean>

/**
 * The order in which every history is read: the start entry (no date; SQLite sorts NULL first), then by day. A child
 * has one start entry and at most one entry per day (unique indexes), so the id never has to decide between two
 * entries for the same day.
 */
const HISTORY_ORDER = [asc(childGroupChanges.fromDate), asc(childGroupChanges.id)]

const KEEP_COLUMN = {
  contacts: 'keepContacts', health: 'keepHealth', consents: 'keepConsents', documents: 'keepDocuments',
  careType: 'keepCareType', keyEducator: 'keepKeyEducator',
} as const satisfies Record<KeepSection, keyof ChangeRow>

function keepOf(row: ChangeRow): Keep {
  return Object.fromEntries(KEEP_SECTIONS.map(section => [section, row[KEEP_COLUMN[section]]])) as Keep
}

function keepColumns(keep: Keep): Pick<ChangeRow, (typeof KEEP_COLUMN)[KeepSection]> {
  return Object.fromEntries(KEEP_SECTIONS.map(section => [KEEP_COLUMN[section], keep[section]])) as
    Pick<ChangeRow, (typeof KEEP_COLUMN)[KeepSection]>
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
  return {
    id: change.id, groupId: change.groupId!, groupName, date: change.fromDate!, keep: keepOf(change),
    newContract: change.newContract,
  }
}

/**
 * Per child of the facility with a change that carries a further care contract, planned or applied: the day of the
 * latest such change. The automatic leaving of school children passes a child over whose contract change lies after
 * the leaving day: somebody concluded a contract for that time, so it neither deletes the planned change nor
 * deregisters the child to a day before the applied one, whatever became of the group's flag.
 */
export function contractChangeDays(db: Db, facilityId: number): Map<number, IsoDate> {
  const rows = db.select({ childId: childGroupChanges.childId, date: childGroupChanges.fromDate }).from(childGroupChanges)
    .innerJoin(children, eq(children.id, childGroupChanges.childId))
    .where(and(
      eq(children.facilityId, facilityId), isNotNull(childGroupChanges.fromDate), eq(childGroupChanges.newContract, true),
    )).orderBy(...HISTORY_ORDER).all()
  // In the history order, so the latest day of a child is the one that stays in the map.
  return new Map(rows.map(row => [row.childId, row.date!]))
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
 * group and, for every section that is not kept, the mark "not confirmed since the change day"; a change into a group
 * that is for school children on that day marks the further care contract likewise. Children who left before the
 * change day are skipped. Must run inside a transaction.
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
    const marked: ReviewSection[] = KEEP_SECTIONS.filter(section => !keep[section])
    // What the group is now decides, not what it was when the change was planned: a group flagged since then asks
    // for the contract, one that lost the flag is an ordinary group.
    const intoSchoolGroup = isForSchoolChildren(db, change.groupId)
    if (intoSchoolGroup) marked.push('contract')
    const marks = Object.fromEntries(marked.map(section => [REVIEW_COLUMN[section], change.fromDate]))
    db.update(children).set({ groupId: change.groupId, ...marks }).where(eq(children.id, change.childId)).run()
    db.update(childGroupChanges).set({ appliedAt: now.toISOString() }).where(eq(childGroupChanges.id, change.id)).run()
    // A documents marker nobody could act on (nothing required, or everything uploaded since) is not set at all, and
    // neither is a contract marker when the care contract was already uploaded since the change day.
    if (!keep.documents || intoSchoolGroup) settleDocumentReview(db, change.childId)
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
 * Applies the child's due changes before a request is judged: a change whose day has come counts as applied, even
 * when the daily run has not come by yet (so a save clears the marker the change sets, instead of being followed by
 * it). In a transaction of its own, so it stays applied when the request is refused.
 */
export function settleDue(db: Db, childId: number, today: IsoDate, now: Date): void {
  db.transaction(tx => applyDue(tx, today, now, childId))
}

/**
 * The rules for a planned change, checked against the child's other entries (in the history order): a valid day, a
 * group of the facility (404 group_not_found) other than the one the child is in on that day (400 same_group), a day
 * after the last applied change (400 group_change_order) and not after the day the child leaves
 * (400 group_change_after_leaving), since such a change would never be applied. A change into a group for school
 * children needs the further care contract to be confirmed (400 new_contract_required). Returns whether the change
 * carries that contract: only one into such a group does, whatever the request says for another group.
 */
function assertChange(db: Db, facilityId: number, child: ChildRow, input: GroupChangeInput, others: ChangeRow[]): boolean {
  if (child.admissionStatus === 'waitlist') throw new ServiceError(400, 'waitlist_no_group_change')
  if (!isValidIsoDate(input.date)) throw new ServiceError(400, 'invalid_date')
  assertGroup(db, facilityId, input.groupId)
  const groupThen = groupOnDay(others.map(entry => ({ from: entry.fromDate, groupId: entry.groupId })), input.date)
  if (groupThen === input.groupId) throw new ServiceError(400, 'same_group')
  if (others.some(entry => entry.appliedAt !== null && entry.fromDate !== null && entry.fromDate >= input.date)) {
    throw new ServiceError(400, 'group_change_order')
  }
  if (child.leftOn !== null && input.date > child.leftOn) throw new ServiceError(400, 'group_change_after_leaving')
  const forSchoolChildren = isForSchoolChildren(db, input.groupId)
  if (forSchoolChildren && input.newContract !== true) throw new ServiceError(400, 'new_contract_required')
  return forSchoolChildren
}

/**
 * Plans a group change of a contract child that has not left (409 child_archived, 400 waitlist_no_group_change); the
 * rules are those of `assertChange`, and a child has at most one change that is not applied yet
 * (409 group_change_pending). A change dated today or earlier is applied at once.
 *
 * Planning, changing and deleting a planned change are all refused when the automatic leaving would deregister the
 * child at its next run because of it (409 would_deregister, see `guardAgainstLeaving`): a backdated change out of
 * the group for school children, or a planned change into one that is retargeted.
 */
export function planGroupChange(
  db: Db, actor: SessionUser, facilityId: number, childId: number, input: GroupChangeInput, today: IsoDate,
  now: Date = new Date(),
): void {
  const child = loadEditableChild(db, actor, facilityId, childId, today)
  settleDue(db, childId, today, now)
  db.transaction((tx) => {
    const assertStays = guardAgainstLeaving(tx, facilityId, today, childId)
    const history = historyOf(tx, childId)
    const newContract = assertChange(tx, facilityId, child, input, history)
    if (history.some(entry => entry.appliedAt === null)) throw new ServiceError(409, 'group_change_pending')
    tx.insert(childGroupChanges).values({
      childId, groupId: input.groupId, fromDate: input.date, ...keepColumns(input.keep), newContract, createdBy: actor.id,
      createdAt: now.toISOString(),
    }).run()
    if (input.date <= today) applyDue(tx, today, now, childId)
    assertStays(childId)
  })
}

/**
 * The facility's planned change with this id that can still be changed; unknown or of another facility's child:
 * 404 group_change_not_found. What is due is settled first, so a change whose day has come is applied like the start
 * entry and every other applied one: 409 group_change_applied.
 */
function loadPlannedChange(db: Db, facilityId: number, changeId: number, today: IsoDate, now: Date): ChangeRow {
  const found = db.select({ childId: childGroupChanges.childId }).from(childGroupChanges)
    .innerJoin(children, eq(children.id, childGroupChanges.childId))
    .where(and(eq(childGroupChanges.id, changeId), eq(children.facilityId, facilityId))).get()
  if (!found) throw new ServiceError(404, 'group_change_not_found')
  settleDue(db, found.childId, today, now)
  const change = db.select().from(childGroupChanges).where(eq(childGroupChanges.id, changeId)).get()
  if (!change) throw new ServiceError(404, 'group_change_not_found')
  if (change.appliedAt !== null) throw new ServiceError(409, 'group_change_applied')
  return change
}

/**
 * Changes a planned change until the day before it takes effect (409 group_change_applied afterwards, and for the
 * start entry), with the rules of planning. Moved to today or earlier it is applied at once.
 */
export function updateGroupChange(
  db: Db, actor: SessionUser, facilityId: number, changeId: number, input: GroupChangeInput, today: IsoDate,
  now: Date = new Date(),
): void {
  const change = loadPlannedChange(db, facilityId, changeId, today, now)
  db.transaction((tx) => {
    const child = loadEditableChild(tx, actor, facilityId, change.childId, today)
    const assertStays = guardAgainstLeaving(tx, facilityId, today, child.id)
    const newContract = assertChange(tx, facilityId, child, input, historyOf(tx, child.id).filter(entry => entry.id !== changeId))
    tx.update(childGroupChanges)
      .set({ groupId: input.groupId, fromDate: input.date, ...keepColumns(input.keep), newContract })
      .where(eq(childGroupChanges.id, changeId)).run()
    if (input.date <= today) applyDue(tx, today, now, child.id)
    assertStays(child.id)
  })
}

/**
 * Deletes a planned change until the day before it takes effect (409 group_change_applied afterwards, and for the
 * start entry). A change that is all that keeps the child from the automatic leaving (it leads into a group for school
 * children after the school start) is not deleted: 409 would_deregister.
 */
export function deleteGroupChange(
  db: Db, facilityId: number, changeId: number, today: IsoDate, now: Date = new Date(),
): void {
  const change = loadPlannedChange(db, facilityId, changeId, today, now)
  db.transaction((tx) => {
    const assertStays = guardAgainstLeaving(tx, facilityId, today, change.childId)
    tx.delete(childGroupChanges).where(eq(childGroupChanges.id, change.id)).run()
    assertStays(change.childId)
  })
}

/**
 * Another group was chosen in the master data: the child gets it at once. `child` is the record as stored before this
 * save, because whether the child has started must not depend on what is saved together with the group: for a child
 * that had not started (waitlist, or no contract start up to today) and has no applied dated change, only the start
 * group changes; otherwise the history gets a change dated today that keeps every section. Such a change cannot lead
 * into a group for school children (400 new_contract_required): that needs a further care contract, which only a
 * planned change can confirm. A planned change for a later day stays as it is. Must run inside a transaction.
 */
export function changeGroupDirectly(
  db: Db, actor: SessionUser, child: Pick<ChildRow, 'id' | 'admissionStatus' | 'entryDate' | 'plannedEntryDate'>,
  groupId: number | null, today: IsoDate, now: Date,
): void {
  // What is due is applied first: its marks are set and today's entry, if any, is the one that gets replaced.
  applyDue(db, today, now, child.id)
  const current = db.select({ groupId: children.groupId }).from(children).where(eq(children.id, child.id)).get()
  if (!current || current.groupId === groupId) return
  const start = child.entryDate ?? child.plannedEntryDate
  const started = child.admissionStatus === 'contract' && start !== null && start <= today
  const hasAppliedChange = historyOf(db, child.id).some(entry => entry.fromDate !== null && entry.appliedAt !== null)
  const dated = started || hasAppliedChange
  if (dated && isForSchoolChildren(db, groupId)) throw new ServiceError(400, 'new_contract_required')
  putAppliedEntry(db, child.id, dated ? today : null, groupId, actor.id, now)
  db.update(children).set({ groupId }).where(eq(children.id, child.id)).run()
}

/**
 * The child leaves on `leftOn`, by hand or by the automatic leaving of school children: the leaving day is stored and
 * a planned change after that day is deleted, so it can never be applied (nor block deleting its group). The one place
 * that sets a leaving day, so neither happens without the other. Must run inside a transaction.
 */
export function registerLeaving(db: Db, childId: number, leftOn: IsoDate): void {
  db.update(children).set({ leftOn }).where(eq(children.id, childId)).run()
  db.delete(childGroupChanges).where(and(
    eq(childGroupChanges.childId, childId), isNull(childGroupChanges.appliedAt), gt(childGroupChanges.fromDate, leftOn),
  )).run()
}

/**
 * The child can have no planned change any more (it becomes a Vormerkung or moves to another facility): what is due
 * is still applied, the rest is deleted and so never applied. Must run inside a transaction.
 */
export function dropPlannedChanges(db: Db, childId: number, today: IsoDate, now: Date): void {
  applyDue(db, today, now, childId)
  db.delete(childGroupChanges).where(and(eq(childGroupChanges.childId, childId), isNull(childGroupChanges.appliedAt))).run()
}

/**
 * The child moves to another facility: its history ends with "no group from today" and a planned change is deleted
 * (the caller clears the group on the child). Must run inside a transaction.
 */
export function endGroupHistory(db: Db, childId: number, today: IsoDate, now: Date): void {
  dropPlannedChanges(db, childId, today, now)
  putAppliedEntry(db, childId, today, null, null, now)
}
