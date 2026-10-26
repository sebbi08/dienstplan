import { and, asc, eq, gte, inArray, isNull, max, or } from 'drizzle-orm'
import { ageOn, childStatus, hiddenFromViewer, nextBirthday, purgeDate } from '../../shared/domain/children'
import { isValidIsoDate, todayIso } from '../../shared/domain/dates'
import { groupRight } from '../../shared/domain/groupAccess'
import { isManager, mayEditChildren } from '../../shared/domain/roles'
import { computedSchoolStart, type SchoolCutoff } from '../../shared/domain/schoolStart'
import type { IsoDate } from '../../shared/domain/types'
import {
  CONSENT_KEYS,
  type ArchivedChildDto, type BirthdayDto, type ChildConsents, type ChildHealthInput, type ChildListItemDto, type ChildMasterInput,
  type ChildMasterUpdateInput, type ChildRecordDto, type ChildrenOverviewDto, type ConsentKey, type GroupAccess, type OpenChildDto,
  type OverviewContactDto, type PlannedChildDto, type PlannedChildrenDto, type ReviewSection, type SectionStamp,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { careTypes, childContacts, childDocuments, children, documentTypes, employees, users } from '../db/schema'
import { DEFAULT_DOCUMENT_TYPES } from '../db/seed'
import {
  assertGroupRight, clearedReviews, loadChild, loadEditableChild, openReviews, REVIEW_COLUMN, REVIEW_STAMP_SECTION, seesGroup,
  sectionStamp, type ChildRow,
} from '../lib/childRecord'
import type { ChildActor, ChildViewer } from '../lib/childViewer'
import { ServiceError } from '../lib/errors'
import { getChildrenPurgedOn, getChildRetentionYears, setChildrenPurgedOn } from './appSettings'
import { assertCareType } from './careTypes'
import { listContacts } from './childContacts'
import { listDocuments } from './childDocuments'
import {
  changeGroupDirectly, dropPlannedChanges, endGroupHistory, pendingGroupChange, recordStartGroup, registerLeaving, settleDue,
} from './childGroupChanges'
import { staleRequiredTypes } from './documentReview'
import { assertFacility } from './facilities'
import { assertGroup, listGroups } from './groups'
import { meetingsOf, overviewMeetingsOf } from './parentMeetings'
import { moveChildForms } from './childForms'
import { developmentDocOf } from './reminders'
import { guardAgainstLeaving, leavesAtNextRun, schoolCutoffOf } from './schoolChildren'

type ConsentColumn = `consent${Capitalize<ConsentKey>}`
const consentColumn = (key: ConsentKey) => `consent${key[0]!.toUpperCase()}${key.slice(1)}` as ConsentColumn

const byName = (a: { lastName: string; firstName: string }, b: { lastName: string; firstName: string }) =>
  a.lastName.localeCompare(b.lastName, 'de') || a.firstName.localeCompare(b.firstName, 'de')

/** The facility's employees who can be a Bezugserzieher: they have not left (leaving today or later still counts). */
function staffOf(db: Db, facilityId: number, today: IsoDate): { id: number; name: string }[] {
  return db.select({ id: employees.id, name: employees.name }).from(employees)
    .where(and(eq(employees.facilityId, facilityId), or(isNull(employees.leftOn), gte(employees.leftOn, today))))
    .orderBy(asc(employees.sortOrder), asc(employees.name)).all()
}

/** Id and name of the facility's staff who can be chosen as Bezugserzieher, in the order of the employee list. */
export function listChildStaff(db: Db, facilityId: number, today: IsoDate): { id: number; name: string }[] {
  return staffOf(db, facilityId, today)
}

/** The order of the child list and the overview: the groups' order (no group last), then oldest first, then by name. */
function listOrder(db: Db, facilityId: number): (a: ChildRow, b: ChildRow) => number {
  const groupRank = new Map(listGroups(db, facilityId).map((group, index) => [group.id, index]))
  const rank = (row: ChildRow) => (row.groupId === null ? Infinity : groupRank.get(row.groupId) ?? Infinity)
  return (a, b) => rank(a) - rank(b) || a.birthDate.localeCompare(b.birthDate) || byName(a, b)
}

/**
 * Active children grouped in the groups' order (no group last), then oldest first; only those whose group the viewer's
 * group access (`groups`, null = every group) lets them see.
 */
export function listChildren(
  db: Db, facilityId: number, status: 'active', today: IsoDate, groups: GroupAccess | null,
): ChildListItemDto[] {
  const rows = db.select().from(children).where(eq(children.facilityId, facilityId)).all()
    .filter(row => childStatus(row, today) === status && seesGroup(groups, row.groupId))
  const ids = rows.map(row => row.id)
  const bans = ids.length === 0 ? [] : db.select().from(childContacts)
    .where(inArray(childContacts.childId, ids)).orderBy(asc(childContacts.sortOrder), asc(childContacts.id)).all()
    .filter(contact => contact.contactBan)
  const careTypeNames = new Map(db.select({ id: careTypes.id, name: careTypes.name }).from(careTypes)
    .where(eq(careTypes.facilityId, facilityId)).all().map(row => [row.id, row.name]))
  const staff = new Map(staffOf(db, facilityId, today).map(person => [person.id, person.name]))
  rows.sort(listOrder(db, facilityId))
  return rows.map(row => ({
    id: row.id,
    lastName: row.lastName,
    firstName: row.firstName,
    birthDate: row.birthDate,
    age: ageOn(row.birthDate, today),
    groupId: row.groupId,
    careTypeName: row.careTypeId === null ? null : careTypeNames.get(row.careTypeId) ?? null,
    keyEducatorId: row.keyEducatorId !== null && staff.has(row.keyEducatorId) ? row.keyEducatorId : null,
    keyEducatorName: row.keyEducatorId === null ? null : staff.get(row.keyEducatorId) ?? null,
    entryDate: row.entryDate,
    plannedEntryDate: row.plannedEntryDate,
    hasAllergies: row.allergies.trim() !== '',
    contactBans: bans.filter(contact => contact.childId === row.id).map(contact => ({ name: contact.name, note: contact.contactBanNote })),
  }))
}

/** Date comparison with undated rows last. */
const nullsLast = (a: string | null, b: string | null) => (a ?? '9999-99-99').localeCompare(b ?? '9999-99-99')

/**
 * The facility's planned children: the waitlist (Vormerkungen) by waitlist date and name, and the contract children
 * who have not started yet by their start (entry date, else planned entry date) and name; undated ones come last.
 * The part the facility's tablet switches hide from the viewer is empty, and children of groups the viewer does not
 * see (by their promised or wished-for group) are left out.
 */
export function listPlanned(db: Db, viewer: ChildViewer, today: IsoDate): PlannedChildrenDto {
  const { facilityId } = viewer
  const rows = db.select().from(children).where(eq(children.facilityId, facilityId)).all()
    .filter(row => childStatus(row, today) === 'planned' && !hiddenFromViewer(row, viewer.visibility, today)
      && seesGroup(viewer.groups, row.groupId))
  const ids = rows.map(row => row.id)
  // The first contact by sort order is the one whose number is shown.
  const firstContact = new Map<number, typeof childContacts.$inferSelect>()
  if (ids.length > 0) {
    for (const contact of db.select().from(childContacts).where(inArray(childContacts.childId, ids))
      .orderBy(asc(childContacts.sortOrder), asc(childContacts.id)).all()) {
      if (!firstContact.has(contact.childId)) firstContact.set(contact.childId, contact)
    }
  }
  const careTypeNames = new Map(db.select({ id: careTypes.id, name: careTypes.name }).from(careTypes)
    .where(eq(careTypes.facilityId, facilityId)).all().map(row => [row.id, row.name]))
  const toDto = (row: ChildRow): PlannedChildDto => {
    const contact = firstContact.get(row.id)
    return {
      id: row.id,
      lastName: row.lastName,
      firstName: row.firstName,
      birthDate: row.birthDate,
      plannedStart: row.entryDate ?? row.plannedEntryDate,
      groupId: row.groupId,
      careTypeName: row.careTypeId === null ? null : careTypeNames.get(row.careTypeId) ?? null,
      phone: contact?.phoneMobile || contact?.phoneHome || contact?.phoneWork || '',
      note: row.note,
      waitlistedOn: row.admissionStatus === 'waitlist' ? row.waitlistedOn : null,
    }
  }
  return {
    waitlist: rows.filter(row => row.admissionStatus === 'waitlist').map(toDto)
      .sort((a, b) => nullsLast(a.waitlistedOn, b.waitlistedOn) || byName(a, b)),
    contracted: rows.filter(row => row.admissionStatus === 'contract').map(toDto)
      .sort((a, b) => nullsLast(a.plannedStart, b.plannedStart) || byName(a, b)),
  }
}

/** The master data; keyEducatorId is the effective one (null when the person left or is no longer in the facility). */
function masterOf(row: ChildRow, keyEducatorId: number | null): ChildMasterInput {
  return {
    lastName: row.lastName, firstName: row.firstName, birthDate: row.birthDate, address: row.address,
    groupId: row.groupId, careTypeId: row.careTypeId, entryDate: row.entryDate, plannedEntryDate: row.plannedEntryDate,
    admissionStatus: row.admissionStatus, waitlistedOn: row.waitlistedOn, infoMeetingDate: row.infoMeetingDate, schoolStartDate: row.schoolStartDate, primarySchool: row.primarySchool,
    schoolDistrict: row.schoolDistrict, keyEducatorId, note: row.note,
  }
}

function healthOf(row: ChildRow): ChildHealthInput {
  return {
    measlesProof: row.measlesProof, measlesProofDate: row.measlesProofDate,
    infectionBriefingDate: row.infectionBriefingDate, allergies: row.allergies,
    mayTakeTemperature: row.mayTakeTemperature, mayApplySunscreen: row.mayApplySunscreen,
    mayApplyPlaster: row.mayApplyPlaster,
  }
}

function consentsOf(row: ChildRow): ChildConsents {
  return Object.fromEntries(CONSENT_KEYS.map(key => [key, row[consentColumn(key)]])) as ChildConsents
}

/**
 * The whole record; an archived child is only visible to Träger and Leitung, a child the tablet hides from the viewer
 * or whose group the viewer does not see not at all (others: 404 child_not_found). A child of a group the viewer may
 * only read cannot be edited, whatever the viewer's other rights. Whether a parent meeting is still planned is judged
 * at `now`; its confidential note only goes to Leitung and Träger.
 */
export function getChild(
  db: Db, viewer: ChildViewer, id: number, today: IsoDate, now: Date = new Date(),
): ChildRecordDto {
  const row = loadChild(db, viewer.facilityId, id)
  const status = childStatus(row, today)
  if (status === 'archived' && !isManager(viewer.role)) throw new ServiceError(404, 'child_not_found')
  if (hiddenFromViewer(row, viewer.visibility, today)) throw new ServiceError(404, 'child_not_found')
  assertGroupRight(viewer, row.groupId, 'read')
  const stampUsers = [row.masterUpdatedBy, row.contactsUpdatedBy, row.healthUpdatedBy, row.consentsUpdatedBy]
    .filter((userId): userId is number => userId !== null)
  const usernames = new Map(stampUsers.length === 0 ? [] : db.select({ id: users.id, username: users.username }).from(users)
    .where(inArray(users.id, stampUsers)).all().map(user => [user.id, user.username]))
  const stampOf = (updatedAt: string | null, updatedBy: number | null): SectionStamp =>
    ({ updatedAt, updatedBy: updatedBy === null ? null : usernames.get(updatedBy) ?? null })
  const keyEducatorName = row.keyEducatorId === null ? null
    : staffOf(db, viewer.facilityId, today).find(person => person.id === row.keyEducatorId)?.name ?? null
  const canEdit = mayEditChildren(viewer) && status !== 'archived' && groupRight(row.groupId, viewer.groups) === 'write'
  return {
    id: row.id,
    status,
    master: masterOf(row, keyEducatorName === null ? null : row.keyEducatorId),
    pendingGroupChange: pendingGroupChange(db, row.id),
    reviews: effectiveReviews(db, viewer.facilityId, [row]).get(row.id)!,
    computedSchoolStart: computedSchoolStart(row.birthDate, schoolCutoffOf(db, viewer.facilityId)),
    keyEducatorName,
    health: healthOf(row),
    consents: consentsOf(row),
    contacts: listContacts(db, row.id),
    stamps: {
      master: stampOf(row.masterUpdatedAt, row.masterUpdatedBy),
      contacts: stampOf(row.contactsUpdatedAt, row.contactsUpdatedBy),
      health: stampOf(row.healthUpdatedAt, row.healthUpdatedBy),
      consents: stampOf(row.consentsUpdatedAt, row.consentsUpdatedBy),
    },
    leftOn: row.leftOn,
    purgeOn: row.leftOn !== null && isManager(viewer.role) ? purgeDate(row.leftOn, getChildRetentionYears(db)) : null,
    canEdit,
    documents: listDocuments(db, viewer, viewer.facilityId, row.id, today),
    developmentDoc: developmentDocOf(db, viewer, row, status, today),
    meetings: meetingsOf(db, viewer, row.id, now),
    canEditMeetings: canEdit,
  }
}

/**
 * The facility's school cutoff for everyone who sees child records: the form computes with it the school start of a
 * child being entered, as `getChild` does for a stored one. The cutoff is not sensitive.
 */
export function childSchoolCutoff(db: Db, viewer: ChildViewer): SchoolCutoff {
  return schoolCutoffOf(db, viewer.facilityId)
}

/**
 * Only Träger and Leitung set the school start by hand (403 school_start_managers_only): for everyone else the input
 * has to carry the stored value (`stored`; null for a new child, whose school start then stays the computed one).
 */
function assertSchoolStartRight(actor: ChildActor, input: IsoDate | null, stored: IsoDate | null): void {
  if (!isManager(actor.role) && input !== stored) throw new ServiceError(403, 'school_start_managers_only')
}

function checkedDate(value: IsoDate | null): IsoDate | null {
  if (value !== null && !isValidIsoDate(value)) throw new ServiceError(400, 'invalid_date')
  return value
}

/**
 * Trimmed texts, valid dates, a birth date that is not in the future, group and care type of the facility and a
 * Bezugserzieher from the facility's staff who has not left (400 key_educator_not_found otherwise). A waitlist child
 * has no entry date (400 waitlist_has_entry) and keeps its waitlist date (`storedWaitlistedOn` on an update, else
 * today); a contract child has none.
 */
function checkedMaster(
  db: Db, facilityId: number, input: ChildMasterInput, today: IsoDate, storedWaitlistedOn: IsoDate | null = null,
): ChildMasterInput {
  const lastName = input.lastName.trim()
  const firstName = input.firstName.trim()
  if (lastName === '' || firstName === '') throw new ServiceError(400, 'name_required')
  const birthDate = checkedDate(input.birthDate)!
  if (birthDate > today) throw new ServiceError(400, 'birth_date_in_future')
  assertGroup(db, facilityId, input.groupId)
  assertCareType(db, facilityId, input.careTypeId)
  if (input.keyEducatorId !== null && !staffOf(db, facilityId, today).some(person => person.id === input.keyEducatorId)) {
    throw new ServiceError(400, 'key_educator_not_found')
  }
  const entryDate = checkedDate(input.entryDate)
  const waitlisted = input.admissionStatus === 'waitlist'
  if (waitlisted && entryDate !== null) throw new ServiceError(400, 'waitlist_has_entry')
  const waitlistedOn = checkedDate(input.waitlistedOn)
  return {
    ...input, lastName, firstName, birthDate,
    address: input.address.trim(),
    entryDate,
    plannedEntryDate: checkedDate(input.plannedEntryDate),
    waitlistedOn: waitlisted ? waitlistedOn ?? storedWaitlistedOn ?? today : null,
    infoMeetingDate: checkedDate(input.infoMeetingDate),
    schoolStartDate: checkedDate(input.schoolStartDate),
    primarySchool: input.primarySchool.trim(),
    schoolDistrict: input.schoolDistrict.trim(),
    note: input.note.trim(),
  }
}

/**
 * A new child of the facility with the start entry of its group history; returns its id. Without a school start the
 * computed one counts (nothing is stored, so it follows later changes of cutoff or birth date); only Träger and Leitung
 * may enter one (403 school_start_managers_only, see `assertSchoolStartRight`). A record the automatic
 * leaving would take at its next run is not created (409 would_deregister, see `guardAgainstLeaving`). A person with
 * group rights creates it only in a group they may write in: 403 group_read_only for a read-only group, 404
 * group_not_found for a hidden one.
 */
export function createChild(
  db: Db, actor: ChildActor, facilityId: number, input: ChildMasterInput, now: Date = new Date(),
): number {
  const today = todayIso(now)
  // A person with group rights creates children only in a group they may write in (or without group).
  assertGroupRight(actor, input.groupId, 'write', 'group_not_found')
  assertSchoolStartRight(actor, input.schoolStartDate, null)
  const master = checkedMaster(db, facilityId, input, today)
  return db.transaction((tx) => {
    const assertStays = guardAgainstLeaving(tx, facilityId, today)
    const id = tx.insert(children)
      .values({ ...master, facilityId, createdAt: now.toISOString(), ...sectionStamp('master', actor.id, now) })
      .returning({ id: children.id }).get().id
    recordStartGroup(tx, id, master.groupId, actor.id, now)
    assertStays(id)
    return id
  })
}

/**
 * Saves the master data. Only Träger and Leitung change the school start: everyone else leaves it out (the stored one
 * stays) or sends the stored one (403 school_start_managers_only for another value, clearing included). A child that has already started (active) cannot become a Vormerkung any more
 * (400 waitlist_after_start); one that becomes a Vormerkung loses its planned group change.
 *
 * Another group than the one the form was loaded with (`baseGroupId`; left out: the stored one) is a direct group
 * change and goes into the group history (see `changeGroupDirectly`, which judges on the stored record). The group
 * the form was loaded with is none, whatever the stored group is by now: a form that was open while a planned change
 * was applied, or that is saved on the change day before the daily run, never undoes that change. The group it sends
 * is not even looked at then (it may have been deleted since). A chosen group must be one the actor may write in
 * (403 group_read_only for a read-only group, 404 group_not_found for a hidden one).
 *
 * A save after which the automatic leaving would deregister the child at its next run, though it would not have
 * before, is refused and nothing of it is stored (409 would_deregister, see `guardAgainstLeaving`): clearing a later
 * school start, another birth or entry date, a contract for a Vormerkung, a group change on the school start day.
 */
export function updateChildMaster(
  db: Db, actor: ChildActor, facilityId: number, id: number, input: ChildMasterUpdateInput, today: IsoDate,
  now: Date = new Date(),
): void {
  // The group stored before the due changes are settled: what a form without `baseGroupId` was loaded with.
  const storedGroupId = loadChild(db, facilityId, id).groupId
  const row = loadEditableChild(db, actor, facilityId, id, today, now)
  if (input.admissionStatus === 'waitlist' && childStatus(row, today) === 'active') {
    throw new ServiceError(400, 'waitlist_after_start')
  }
  const { baseGroupId = storedGroupId, schoolStartDate = row.schoolStartDate, ...rest } = input
  assertSchoolStartRight(actor, schoolStartDate, row.schoolStartDate)
  const fields = { ...rest, schoolStartDate }
  const groupChosen = fields.groupId !== baseGroupId
  // A person with group rights moves a child only into a group they may write in (or out of every group).
  if (groupChosen) assertGroupRight(actor, fields.groupId, 'write', 'group_not_found')
  const master = checkedMaster(
    db, facilityId, { ...fields, groupId: groupChosen ? fields.groupId : row.groupId }, today, row.waitlistedOn,
  )
  // A waitlist child cannot have left: the purge job keys on leftOn and must never delete a waitlist record.
  const leftOn = master.admissionStatus === 'waitlist' ? { leftOn: null } : {}
  db.transaction((tx) => {
    // A change whose day has come is applied first, so this save clears the markers it sets.
    settleDue(tx, id, today, now)
    const assertStays = guardAgainstLeaving(tx, facilityId, today, id)
    if (groupChosen) changeGroupDirectly(tx, actor, row, master.groupId, today, now)
    // A Vormerkung has no planned group change, as a child who left has none after its leaving day.
    if (master.admissionStatus === 'waitlist') dropPlannedChanges(tx, id, today, now)
    // The group itself is only ever written through the history, so it cannot drift from it.
    const { groupId: _, ...rest } = master
    tx.update(children).set({
      ...rest, ...leftOn, ...clearedReviews('careType', 'keyEducator'), ...sectionStamp('master', actor.id, now),
    }).where(eq(children.id, id)).run()
    assertStays(id)
  })
}

export function updateChildHealth(
  db: Db, actor: ChildActor, facilityId: number, id: number, input: ChildHealthInput, today: IsoDate,
  now: Date = new Date(),
): void {
  loadEditableChild(db, actor, facilityId, id, today, now)
  settleDue(db, id, today, now)
  const health: ChildHealthInput = {
    ...input,
    measlesProofDate: checkedDate(input.measlesProofDate),
    infectionBriefingDate: checkedDate(input.infectionBriefingDate),
    allergies: input.allergies.trim(),
  }
  db.update(children).set({ ...health, ...clearedReviews('health'), ...sectionStamp('health', actor.id, now) })
    .where(eq(children.id, id)).run()
}

export function updateChildConsents(
  db: Db, actor: ChildActor, facilityId: number, id: number, input: ChildConsents, today: IsoDate,
  now: Date = new Date(),
): void {
  loadEditableChild(db, actor, facilityId, id, today, now)
  settleDue(db, id, today, now)
  const columns = Object.fromEntries(CONSENT_KEYS.map(key => [consentColumn(key), input[key]]))
  db.update(children).set({ ...columns, ...clearedReviews('consents'), ...sectionStamp('consents', actor.id, now) })
    .where(eq(children.id, id)).run()
}

/**
 * Confirms a section after a group change: its marker goes away. A section without marker is left as it is (no stamp).
 * The same write rules as for every change of the record apply (archived: 409 child_archived / 404 child_not_found).
 */
export function confirmSection(
  db: Db, actor: ChildActor, facilityId: number, childId: number, section: ReviewSection, today: IsoDate,
  now: Date = new Date(),
): void {
  loadEditableChild(db, actor, facilityId, childId, today, now)
  // A marker a due change sets is set first, so confirming also clears it.
  settleDue(db, childId, today, now)
  if (loadChild(db, facilityId, childId)[REVIEW_COLUMN[section]] === null) return
  const stampSection = REVIEW_STAMP_SECTION[section]
  db.update(children).set({ ...clearedReviews(section), ...(stampSection && sectionStamp(stampSection, actor.id, now)) })
    .where(eq(children.id, childId)).run()
}

/**
 * The open markers of the rows. The documents marker only counts while a required document type is still stale (see
 * `staleRequiredTypes`): without one there is nothing to upload and nothing to confirm.
 */
function effectiveReviews(db: Db, facilityId: number, rows: ChildRow[]): Map<number, Partial<Record<ReviewSection, IsoDate>>> {
  const stale = staleRequiredTypes(db, facilityId, rows)
  return new Map(rows.map((row) => {
    const reviews = openReviews(row)
    if (stale.get(row.id)?.length === 0) delete reviews.documents
    return [row.id, reviews]
  }))
}

/**
 * The facility's active children with sections still to be confirmed, in the order of the child list; only those whose
 * group the viewer's group access (`groups`, null = every group) lets them see.
 */
export function listOpenReviews(db: Db, facilityId: number, today: IsoDate, groups: GroupAccess | null): OpenChildDto[] {
  const rows = db.select().from(children).where(eq(children.facilityId, facilityId)).all()
    .filter(row => childStatus(row, today) === 'active' && seesGroup(groups, row.groupId))
    .sort(listOrder(db, facilityId))
  const reviews = effectiveReviews(db, facilityId, rows)
  return rows
    .map(row => ({
      id: row.id,
      name: `${row.firstName} ${row.lastName}`,
      groupId: row.groupId,
      sections: Object.keys(reviews.get(row.id)!) as ReviewSection[],
    }))
    .filter(item => item.sections.length > 0)
}

/**
 * The next birthday of every active child of the facility whose group the viewer's group access (`groups`, null = every
 * group) lets them see, soonest first (the screens cut off what they show).
 */
export function listBirthdays(db: Db, facilityId: number, today: IsoDate, groups: GroupAccess | null): BirthdayDto[] {
  return db.select().from(children).where(eq(children.facilityId, facilityId)).all()
    .filter(row => childStatus(row, today) === 'active' && seesGroup(groups, row.groupId))
    .map(row => ({ row, birthday: nextBirthday(row.birthDate, today) }))
    .sort((a, b) => a.birthday.date.localeCompare(b.birthday.date) || byName(a.row, b.row))
    .map(({ row, birthday }) => ({
      childId: row.id,
      name: `${row.firstName} ${row.lastName}`,
      birthDate: row.birthDate,
      groupId: row.groupId,
      date: birthday.date,
      turns: birthday.turns,
    }))
}

/**
 * The values of the Excel-like overview tables for the facility's active children whose group the viewer sees, in the
 * order of the child list: consents, health fields, address and the contacts in the record's order (without their
 * internal note) and the parent meetings newest first (date, start, kind, planned at `now`; never the confidential
 * note, not even for Leitung and Träger). Contacts and meetings of children the viewer does not see are never read.
 * `groups` are the listed children's groups in the groups' order, children without group last (`{ id: null, name: '' }`).
 */
export function childrenOverview(db: Db, viewer: ChildViewer, today: IsoDate, now: Date = new Date()): ChildrenOverviewDto {
  const { facilityId } = viewer
  const rows = db.select().from(children).where(eq(children.facilityId, facilityId)).all()
    .filter(row => childStatus(row, today) === 'active' && seesGroup(viewer.groups, row.groupId))
    .sort(listOrder(db, facilityId))
  const ids = rows.map(row => row.id)
  const contactsOf = new Map<number, OverviewContactDto[]>(ids.map(id => [id, []]))
  if (ids.length > 0) {
    for (const contact of db.select().from(childContacts).where(inArray(childContacts.childId, ids))
      .orderBy(asc(childContacts.sortOrder), asc(childContacts.id)).all()) {
      contactsOf.get(contact.childId)!.push({
        name: contact.name, relation: contact.relation, phoneHome: contact.phoneHome, phoneMobile: contact.phoneMobile,
        phoneWork: contact.phoneWork, isGuardian: contact.isGuardian, mayPickUp: contact.mayPickUp,
        contactBan: contact.contactBan, contactBanNote: contact.contactBanNote, emergencyRank: contact.emergencyRank,
      })
    }
  }
  const meetingsOfChild = overviewMeetingsOf(db, ids, now)
  const listed = new Set(rows.map(row => row.groupId))
  const groups: ChildrenOverviewDto['groups'] = listGroups(db, facilityId)
    .filter(group => listed.has(group.id)).map(group => ({ id: group.id, name: group.name }))
  if (listed.has(null)) groups.push({ id: null, name: '' })
  return {
    groups,
    children: rows.map(row => ({
      id: row.id,
      lastName: row.lastName,
      firstName: row.firstName,
      groupId: row.groupId,
      address: row.address,
      consents: consentsOf(row),
      ...healthOf(row),
      contacts: contactsOf.get(row.id)!,
      meetings: meetingsOfChild.get(row.id)!,
    })),
  }
}

/**
 * Registers the leaving day: today, in the future or up to a year back (400 left_on_too_early otherwise). A waitlist
 * child cannot leave, only be deleted (400 waitlist_cannot_leave). A planned group change after the leaving day is
 * deleted with it.
 */
export function leaveChild(db: Db, facilityId: number, id: number, leftOn: IsoDate, today: IsoDate): void {
  if (loadChild(db, facilityId, id).admissionStatus === 'waitlist') throw new ServiceError(400, 'waitlist_cannot_leave')
  if (!isValidIsoDate(leftOn)) throw new ServiceError(400, 'invalid_date')
  // A year back from today (29 February falls on 28 February).
  if (leftOn < purgeDate(today, -1)) throw new ServiceError(400, 'left_on_too_early')
  db.transaction(tx => registerLeaving(tx, id, leftOn))
}

/**
 * Takes the leaving back: the child is active (or planned) again. While the facility deregisters school children
 * automatically, a child the next run would take again at once (see `schoolLeavers`: its school start is reached and
 * no group for school children makes it stay) needs a new school start after today, which is stored as its manual one
 * (400 school_start_required otherwise, and the leaving stays). With the switch off, and for every other child,
 * `newSchoolStart` is not needed and left unused: nothing deregisters the child again, and the Träger sees it in the
 * preview before switching on. A child that has not left stays as it is.
 */
export function unleaveChild(
  db: Db, facilityId: number, id: number, today: IsoDate, newSchoolStart?: IsoDate, now: Date = new Date(),
): void {
  if (loadChild(db, facilityId, id).leftOn === null) return
  // The group history decides: a change whose day has come counts as applied first, as for every write that judges on it.
  settleDue(db, id, today, now)
  db.transaction((tx) => {
    tx.update(children).set({ leftOn: null }).where(eq(children.id, id)).run()
    // Judged on the record as it is now, without its leaving day; refusing rolls that back.
    if (!leavesAtNextRun(tx, facilityId, id, today)) return
    if (newSchoolStart === undefined) throw new ServiceError(400, 'school_start_required')
    if (!isValidIsoDate(newSchoolStart)) throw new ServiceError(400, 'invalid_date')
    if (newSchoolStart <= today) throw new ServiceError(400, 'school_start_required')
    tx.update(children).set({ schoolStartDate: newSchoolStart }).where(eq(children.id, id)).run()
  })
}

/** Deletes the record at once; contacts and documents go with it (ON DELETE CASCADE). */
export function deleteChild(db: Db, facilityId: number, id: number): void {
  loadChild(db, facilityId, id)
  db.delete(children).where(eq(children.id, id)).run()
}

/** The facility's archived children, the latest leaving first, with the day their record is deleted. */
export function listArchive(db: Db, facilityId: number, today: IsoDate): ArchivedChildDto[] {
  const years = getChildRetentionYears(db)
  return db.select().from(children).where(eq(children.facilityId, facilityId)).all()
    .filter(row => childStatus(row, today) === 'archived')
    .sort((a, b) => b.leftOn!.localeCompare(a.leftOn!) || byName(a, b))
    .map(row => ({
      id: row.id,
      name: `${row.firstName} ${row.lastName}`,
      leftOn: row.leftOn!,
      purgeOn: purgeDate(row.leftOn!, years),
    }))
}

/** How many archived children (all facilities) would be deleted at the next daily run with a retention of `years`. */
export function countChildrenToPurge(db: Db, years: number, today: IsoDate): number {
  return db.select({ leftOn: children.leftOn }).from(children).all()
    .filter(row => row.leftOn !== null && purgeDate(row.leftOn, years) <= today).length
}

/**
 * Deletes every child (all facilities) whose purge date has come, with contacts and documents, in one transaction.
 * Runs at most once per calendar day; returns how many records were deleted.
 */
export function purgeExpiredChildren(db: Db, today: IsoDate): number {
  if (getChildrenPurgedOn(db) === today) return 0
  return db.transaction((tx) => {
    const years = getChildRetentionYears(tx)
    const expired = tx.select({ id: children.id, leftOn: children.leftOn }).from(children).all()
      .filter(row => row.leftOn !== null && purgeDate(row.leftOn, years) <= today)
      .map(row => row.id)
    if (expired.length > 0) tx.delete(children).where(inArray(children.id, expired)).run()
    setChildrenPurgedOn(tx, today)
    return expired.length
  })
}

const OTHER_DOCUMENT_TYPE = 'Sonstiges'
const sameName = (a: string, b: string) => a.localeCompare(b, 'de', { sensitivity: 'accent' }) === 0

/**
 * The Träger moves a record to another facility with its contacts and documents. Group and care type belong to the old
 * facility and are cleared, and so is the Bezugserzieher (an employee of the old facility); every document gets the
 * like-named document type of the new facility, otherwise its "Sonstiges" (created with the default flags when missing).
 * The group history ends with "no group from today"; a planned group change is deleted. The day of the move is stored
 * with the record (`facilitySince`): the occupancy of the new facility counts the child from that day on, and the old
 * facility's no longer knows it, also for the months it was there.
 *
 * A child is not moved into a facility that deregisters school children automatically when the next run there would
 * deregister it at once (409 school_start_reached, nothing is moved): it arrives without a group, and with a school
 * start by the target facility's cutoff. Whether it would is asked of the automatic leaving's own selection
 * (`schoolLeavers`) for the moved record, so a Vormerkung, a child that has not started, one with a leaving day and
 * those the selection passes over on purpose move as before.
 */
export function moveChildToFacility(db: Db, childId: number, targetFacilityId: number, now: Date = new Date()): void {
  const child = db.select({ facilityId: children.facilityId }).from(children).where(eq(children.id, childId)).get()
  if (!child) throw new ServiceError(404, 'child_not_found')
  assertFacility(db, targetFacilityId)
  if (child.facilityId === targetFacilityId) return
  const today = todayIso(now)
  db.transaction((tx) => {
    const typesOf = (facilityId: number) => tx.select({ id: documentTypes.id, name: documentTypes.name })
      .from(documentTypes).where(eq(documentTypes.facilityId, facilityId)).all()
    const sourceNames = new Map(typesOf(child.facilityId).map(type => [type.id, type.name]))
    const targetTypes = typesOf(targetFacilityId)
    let other = targetTypes.find(type => sameName(type.name, OTHER_DOCUMENT_TYPE))?.id ?? null
    const otherType = (): number => {
      if (other === null) {
        const template = DEFAULT_DOCUMENT_TYPES.find(type => type.name === OTHER_DOCUMENT_TYPE)!
        const sortOrder = (tx.select({ value: max(documentTypes.sortOrder) }).from(documentTypes)
          .where(eq(documentTypes.facilityId, targetFacilityId)).get()?.value ?? -1) + 1
        other = tx.insert(documentTypes).values({ ...template, facilityId: targetFacilityId, sortOrder })
          .returning({ id: documentTypes.id }).get().id
      }
      return other
    }
    const documents = tx.select({ id: childDocuments.id, typeId: childDocuments.documentTypeId }).from(childDocuments)
      .where(eq(childDocuments.childId, childId)).all()
    for (const document of documents) {
      const name = sourceNames.get(document.typeId)
      const match = name === undefined ? undefined : targetTypes.find(type => sameName(type.name, name))
      tx.update(childDocuments).set({ documentTypeId: match?.id ?? otherType() }).where(eq(childDocuments.id, document.id)).run()
    }
    endGroupHistory(tx, childId, today, now)
    moveChildForms(tx, childId, targetFacilityId)
    tx.update(children)
      .set({ facilityId: targetFacilityId, facilitySince: today, groupId: null, careTypeId: null, keyEducatorId: null })
      .where(eq(children.id, childId)).run()
    // Judged on the record as it is there now; refusing rolls the whole move back.
    if (leavesAtNextRun(tx, targetFacilityId, childId, today)) throw new ServiceError(409, 'school_start_reached')
  })
}
