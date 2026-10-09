import { asc, eq, inArray } from 'drizzle-orm'
import { ageOn, childStatus, nextBirthday } from '../../shared/domain/children'
import { isValidIsoDate, todayIso } from '../../shared/domain/dates'
import { isManager, mayEditChildren } from '../../shared/domain/roles'
import type { IsoDate } from '../../shared/domain/types'
import {
  CONSENT_KEYS,
  type BirthdayDto, type ChildConsents, type ChildHealthInput, type ChildListItemDto, type ChildMasterInput,
  type ChildRecordDto, type ConsentKey, type SectionStamp, type SessionUser,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { careTypes, childContacts, children, users } from '../db/schema'
import { loadChild, loadEditableChild, sectionStamp, type ChildRow } from '../lib/childRecord'
import { ServiceError } from '../lib/errors'
import { assertCareType } from './careTypes'
import { listContacts } from './childContacts'
import { listDocuments } from './childDocuments'
import { assertGroup, listGroups } from './groups'

type ConsentColumn = `consent${Capitalize<ConsentKey>}`
const consentColumn = (key: ConsentKey) => `consent${key[0]!.toUpperCase()}${key.slice(1)}` as ConsentColumn

const byName = (a: { lastName: string; firstName: string }, b: { lastName: string; firstName: string }) =>
  a.lastName.localeCompare(b.lastName, 'de') || a.firstName.localeCompare(b.firstName, 'de')

/** Active children grouped in the groups' order (no group last), or planned children by their (planned) entry date. */
export function listChildren(db: Db, facilityId: number, status: 'active' | 'planned', today: IsoDate): ChildListItemDto[] {
  const rows = db.select().from(children).where(eq(children.facilityId, facilityId)).all()
    .filter(row => childStatus(row, today) === status)
  const ids = rows.map(row => row.id)
  const bans = ids.length === 0 ? [] : db.select().from(childContacts)
    .where(inArray(childContacts.childId, ids)).orderBy(asc(childContacts.sortOrder), asc(childContacts.id)).all()
    .filter(contact => contact.contactBan)
  const careTypeNames = new Map(db.select({ id: careTypes.id, name: careTypes.name }).from(careTypes)
    .where(eq(careTypes.facilityId, facilityId)).all().map(row => [row.id, row.name]))
  const groupRank = new Map(listGroups(db, facilityId).map((group, index) => [group.id, index]))
  const rank = (row: ChildRow) => (row.groupId === null ? Infinity : groupRank.get(row.groupId) ?? Infinity)
  const dateKey = (row: ChildRow) => row.entryDate ?? row.plannedEntryDate ?? '9999-99-99'
  rows.sort(status === 'active'
    ? (a, b) => rank(a) - rank(b) || byName(a, b)
    : (a, b) => dateKey(a).localeCompare(dateKey(b)) || byName(a, b))
  return rows.map(row => ({
    id: row.id,
    lastName: row.lastName,
    firstName: row.firstName,
    birthDate: row.birthDate,
    age: ageOn(row.birthDate, today),
    groupId: row.groupId,
    careTypeName: row.careTypeId === null ? null : careTypeNames.get(row.careTypeId) ?? null,
    entryDate: row.entryDate,
    plannedEntryDate: row.plannedEntryDate,
    hasAllergies: row.allergies.trim() !== '',
    contactBans: bans.filter(contact => contact.childId === row.id).map(contact => ({ name: contact.name, note: contact.contactBanNote })),
  }))
}

function masterOf(row: ChildRow): ChildMasterInput {
  return {
    lastName: row.lastName, firstName: row.firstName, birthDate: row.birthDate, address: row.address,
    groupId: row.groupId, careTypeId: row.careTypeId, entryDate: row.entryDate, plannedEntryDate: row.plannedEntryDate,
    infoMeetingDate: row.infoMeetingDate, schoolStartDate: row.schoolStartDate, primarySchool: row.primarySchool,
    note: row.note,
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
  return {
    id: row.id,
    status,
    master: masterOf(row),
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
    purgeOn: null,
    canEdit: mayEditChildren(viewer) && status !== 'archived',
    documents: listDocuments(db, viewer, viewer.facilityId, row.id, today),
  }
}

function checkedDate(value: IsoDate | null): IsoDate | null {
  if (value !== null && !isValidIsoDate(value)) throw new ServiceError(400, 'invalid_date')
  return value
}

/** Trimmed texts, valid dates, a birth date that is not in the future and group and care type of the facility. */
function checkedMaster(db: Db, facilityId: number, input: ChildMasterInput, today: IsoDate): ChildMasterInput {
  const lastName = input.lastName.trim()
  const firstName = input.firstName.trim()
  if (lastName === '' || firstName === '') throw new ServiceError(400, 'name_required')
  const birthDate = checkedDate(input.birthDate)!
  if (birthDate > today) throw new ServiceError(400, 'birth_date_in_future')
  assertGroup(db, facilityId, input.groupId)
  assertCareType(db, facilityId, input.careTypeId)
  return {
    ...input, lastName, firstName, birthDate,
    address: input.address.trim(),
    entryDate: checkedDate(input.entryDate),
    plannedEntryDate: checkedDate(input.plannedEntryDate),
    infoMeetingDate: checkedDate(input.infoMeetingDate),
    schoolStartDate: checkedDate(input.schoolStartDate),
    primarySchool: input.primarySchool.trim(),
    note: input.note.trim(),
  }
}

/** A new child of the facility; returns its id. */
export function createChild(
  db: Db, actor: SessionUser, facilityId: number, input: ChildMasterInput, now: Date = new Date(),
): number {
  const master = checkedMaster(db, facilityId, input, todayIso(now))
  return db.insert(children)
    .values({ ...master, facilityId, createdAt: now.toISOString(), ...sectionStamp('master', actor.id, now) })
    .returning({ id: children.id }).get().id
}

export function updateChildMaster(
  db: Db, actor: SessionUser, facilityId: number, id: number, input: ChildMasterInput, today: IsoDate,
  now: Date = new Date(),
): void {
  loadEditableChild(db, actor, facilityId, id, today)
  const master = checkedMaster(db, facilityId, input, today)
  db.update(children).set({ ...master, ...sectionStamp('master', actor.id, now) }).where(eq(children.id, id)).run()
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
