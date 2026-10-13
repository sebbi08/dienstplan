import { and, asc, eq, gte, inArray, isNull, max, or } from 'drizzle-orm'
import { ageOn, childStatus, nextBirthday, purgeDate } from '../../shared/domain/children'
import { isValidIsoDate, todayIso } from '../../shared/domain/dates'
import { isManager, mayEditChildren } from '../../shared/domain/roles'
import { computedSchoolStart } from '../../shared/domain/schoolStart'
import type { IsoDate } from '../../shared/domain/types'
import {
  CONSENT_KEYS,
  type ArchivedChildDto, type BirthdayDto, type ChildConsents, type ChildHealthInput, type ChildListItemDto, type ChildMasterInput,
  type ChildRecordDto, type ConsentKey, type PlannedChildDto, type PlannedChildrenDto, type SectionStamp, type SessionUser,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { careTypes, childContacts, childDocuments, children, documentTypes, employees, users } from '../db/schema'
import { DEFAULT_DOCUMENT_TYPES } from '../db/seed'
import { loadChild, loadEditableChild, sectionStamp, type ChildRow } from '../lib/childRecord'
import { ServiceError } from '../lib/errors'
import { getChildrenPurgedOn, getChildRetentionYears, setChildrenPurgedOn } from './appSettings'
import { assertCareType } from './careTypes'
import { listContacts } from './childContacts'
import { listDocuments } from './childDocuments'
import {
  changeGroupDirectly, deleteChangesAfterLeaving, dropPlannedChanges, endGroupHistory, pendingGroupChange, recordStartGroup,
} from './childGroupChanges'
import { assertFacility } from './facilities'
import { assertGroup, listGroups } from './groups'
import { schoolCutoffOf } from './schoolChildren'

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

/** Active children grouped in the groups' order (no group last), then by name. */
export function listChildren(db: Db, facilityId: number, status: 'active', today: IsoDate): ChildListItemDto[] {
  const rows = db.select().from(children).where(eq(children.facilityId, facilityId)).all()
    .filter(row => childStatus(row, today) === status)
  const ids = rows.map(row => row.id)
  const bans = ids.length === 0 ? [] : db.select().from(childContacts)
    .where(inArray(childContacts.childId, ids)).orderBy(asc(childContacts.sortOrder), asc(childContacts.id)).all()
    .filter(contact => contact.contactBan)
  const careTypeNames = new Map(db.select({ id: careTypes.id, name: careTypes.name }).from(careTypes)
    .where(eq(careTypes.facilityId, facilityId)).all().map(row => [row.id, row.name]))
  const staff = new Map(staffOf(db, facilityId, today).map(person => [person.id, person.name]))
  const groupRank = new Map(listGroups(db, facilityId).map((group, index) => [group.id, index]))
  const rank = (row: ChildRow) => (row.groupId === null ? Infinity : groupRank.get(row.groupId) ?? Infinity)
  rows.sort((a, b) => rank(a) - rank(b) || byName(a, b))
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
 */
export function listPlanned(db: Db, facilityId: number, today: IsoDate): PlannedChildrenDto {
  const rows = db.select().from(children).where(eq(children.facilityId, facilityId)).all()
    .filter(row => childStatus(row, today) === 'planned')
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

/** The whole record; an archived child is only visible to Träger and Leitung (others: 404 child_not_found). */
export function getChild(
  db: Db, viewer: SessionUser & { facilityId: number }, id: number, today: IsoDate,
): ChildRecordDto {
  const row = loadChild(db, viewer.facilityId, id)
  const status = childStatus(row, today)
  if (status === 'archived' && !isManager(viewer.role)) throw new ServiceError(404, 'child_not_found')
  const stampUsers = [row.masterUpdatedBy, row.contactsUpdatedBy, row.healthUpdatedBy, row.consentsUpdatedBy]
    .filter((userId): userId is number => userId !== null)
  const usernames = new Map(stampUsers.length === 0 ? [] : db.select({ id: users.id, username: users.username }).from(users)
    .where(inArray(users.id, stampUsers)).all().map(user => [user.id, user.username]))
  const stampOf = (updatedAt: string | null, updatedBy: number | null): SectionStamp =>
    ({ updatedAt, updatedBy: updatedBy === null ? null : usernames.get(updatedBy) ?? null })
  const keyEducatorName = row.keyEducatorId === null ? null
    : staffOf(db, viewer.facilityId, today).find(person => person.id === row.keyEducatorId)?.name ?? null
  return {
    id: row.id,
    status,
    master: masterOf(row, keyEducatorName === null ? null : row.keyEducatorId),
    pendingGroupChange: pendingGroupChange(db, row.id),
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
    canEdit: mayEditChildren(viewer) && status !== 'archived',
    documents: listDocuments(db, viewer, viewer.facilityId, row.id, today),
  }
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

/** A new child of the facility with the start entry of its group history; returns its id. */
export function createChild(
  db: Db, actor: SessionUser, facilityId: number, input: ChildMasterInput, now: Date = new Date(),
): number {
  const master = checkedMaster(db, facilityId, input, todayIso(now))
  return db.transaction((tx) => {
    const id = tx.insert(children)
      .values({ ...master, facilityId, createdAt: now.toISOString(), ...sectionStamp('master', actor.id, now) })
      .returning({ id: children.id }).get().id
    recordStartGroup(tx, id, master.groupId, actor.id, now)
    return id
  })
}

/**
 * Saves the master data. A child that has already started (active) cannot become a Vormerkung any more
 * (400 waitlist_after_start); one that becomes a Vormerkung loses its planned group change. Another group than the
 * stored one is a direct group change and goes into the group history (see `changeGroupDirectly`, which judges on the
 * stored record); a group that only differs because a planned change is due is not one.
 */
export function updateChildMaster(
  db: Db, actor: SessionUser, facilityId: number, id: number, input: ChildMasterInput, today: IsoDate,
  now: Date = new Date(),
): void {
  const row = loadEditableChild(db, actor, facilityId, id, today)
  if (input.admissionStatus === 'waitlist' && childStatus(row, today) === 'active') {
    throw new ServiceError(400, 'waitlist_after_start')
  }
  const master = checkedMaster(db, facilityId, input, today, row.waitlistedOn)
  // A waitlist child cannot have left: the purge job keys on leftOn and must never delete a waitlist record.
  const leftOn = master.admissionStatus === 'waitlist' ? { leftOn: null } : {}
  db.transaction((tx) => {
    if (master.groupId !== row.groupId) changeGroupDirectly(tx, actor, row, master.groupId, today, now)
    // A Vormerkung has no planned group change, as a child who left has none after its leaving day.
    if (master.admissionStatus === 'waitlist') dropPlannedChanges(tx, id, today, now)
    // The group itself is only ever written through the history, so it cannot drift from it.
    const { groupId: _, ...rest } = master
    tx.update(children).set({ ...rest, ...leftOn, ...sectionStamp('master', actor.id, now) }).where(eq(children.id, id)).run()
  })
}

export function updateChildHealth(
  db: Db, actor: SessionUser, facilityId: number, id: number, input: ChildHealthInput, today: IsoDate,
  now: Date = new Date(),
): void {
  loadEditableChild(db, actor, facilityId, id, today)
  const health: ChildHealthInput = {
    ...input,
    measlesProofDate: checkedDate(input.measlesProofDate),
    infectionBriefingDate: checkedDate(input.infectionBriefingDate),
    allergies: input.allergies.trim(),
  }
  db.update(children).set({ ...health, ...sectionStamp('health', actor.id, now) }).where(eq(children.id, id)).run()
}

export function updateChildConsents(
  db: Db, actor: SessionUser, facilityId: number, id: number, input: ChildConsents, today: IsoDate,
  now: Date = new Date(),
): void {
  loadEditableChild(db, actor, facilityId, id, today)
  const columns = Object.fromEntries(CONSENT_KEYS.map(key => [consentColumn(key), input[key]]))
  db.update(children).set({ ...columns, ...sectionStamp('consents', actor.id, now) }).where(eq(children.id, id)).run()
}

/** The next birthday of every active child of the facility, soonest first (the screens cut off what they show). */
export function listBirthdays(db: Db, facilityId: number, today: IsoDate): BirthdayDto[] {
  return db.select().from(children).where(eq(children.facilityId, facilityId)).all()
    .filter(row => childStatus(row, today) === 'active')
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
 * Registers the leaving day: today, in the future or up to a year back (400 left_on_too_early otherwise). A waitlist
 * child cannot leave, only be deleted (400 waitlist_cannot_leave). A planned group change after the leaving day is
 * deleted with it.
 */
export function leaveChild(db: Db, facilityId: number, id: number, leftOn: IsoDate, today: IsoDate): void {
  if (loadChild(db, facilityId, id).admissionStatus === 'waitlist') throw new ServiceError(400, 'waitlist_cannot_leave')
  if (!isValidIsoDate(leftOn)) throw new ServiceError(400, 'invalid_date')
  // A year back from today (29 February falls on 28 February).
  if (leftOn < purgeDate(today, -1)) throw new ServiceError(400, 'left_on_too_early')
  db.transaction((tx) => {
    tx.update(children).set({ leftOn }).where(eq(children.id, id)).run()
    deleteChangesAfterLeaving(tx, id, leftOn)
  })
}

/** Takes the registration back: the child is active (or planned) again. */
export function unleaveChild(db: Db, facilityId: number, id: number): void {
  loadChild(db, facilityId, id)
  db.update(children).set({ leftOn: null }).where(eq(children.id, id)).run()
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
 * The group history ends with "no group from today"; a planned group change is deleted.
 */
export function moveChildToFacility(db: Db, childId: number, targetFacilityId: number, now: Date = new Date()): void {
  const child = db.select({ facilityId: children.facilityId }).from(children).where(eq(children.id, childId)).get()
  if (!child) throw new ServiceError(404, 'child_not_found')
  assertFacility(db, targetFacilityId)
  if (child.facilityId === targetFacilityId) return
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
    endGroupHistory(tx, childId, todayIso(now), now)
    tx.update(children).set({ facilityId: targetFacilityId, groupId: null, careTypeId: null, keyEducatorId: null })
      .where(eq(children.id, childId)).run()
  })
}
