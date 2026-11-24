import { asc, eq } from 'drizzle-orm'
import {
  addressLine, CONTACT_KINDS, CONTACT_OWNERS, isEmailAddress, isPhoneNumber, isPostalCode, isWebsite, MAX_CONTACT_ENTRIES,
  MAX_CONTACT_TEXT, type FacilityContactDto, type FacilityContactEntry,
} from '../../shared/domain/facilityContact'
import { can } from '../../shared/domain/permissions'
import type { SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { facilities, facilityContacts } from '../db/schema'
import { ServiceError } from '../lib/errors'

/**
 * The facility's contact data (Kontakt, spec: facility contact data). Stored on the facility (address, website, Träger,
 * Leitung) and in facility_contacts (phone numbers and e-mails, each belonging to the facility, its Leitung or its Träger).
 * The Träger edits it for any facility (facilities.manage, like the other master data of a facility); the Leitung
 * reads the data of the own facility.
 */

function assertFacilityExists(db: Db, facilityId: number): void {
  if (!db.select({ id: facilities.id }).from(facilities).where(eq(facilities.id, facilityId)).get()) {
    throw new ServiceError(404, 'facility_not_found')
  }
}

/** Reading: the Träger any facility, the Leitung (settings of the facility) only the own one; 403 forbidden otherwise. */
function assertCanRead(viewer: SessionUser, facilityId: number): void {
  if (can(viewer.permissions, 'facilities.manage')) return
  if (can(viewer.permissions, 'settings.facility') && viewer.facilityId === facilityId) return
  throw new ServiceError(403, 'forbidden')
}

function entriesOf(db: Db, facilityId: number): FacilityContactEntry[] {
  return db.select().from(facilityContacts).where(eq(facilityContacts.facilityId, facilityId))
    .orderBy(asc(facilityContacts.sortOrder), asc(facilityContacts.id)).all()
    .map(({ kind, value, belongsTo, label }) => ({ kind, value, belongsTo, label }))
}

/** The facility's contact data as stored (everything '' / empty until the Träger enters it). */
export function getFacilityContact(db: Db, viewer: SessionUser, facilityId: number): FacilityContactDto {
  assertCanRead(viewer, facilityId)
  const row = db.select().from(facilities).where(eq(facilities.id, facilityId)).get()
  if (!row) throw new ServiceError(404, 'facility_not_found')
  return {
    street: row.street, postalCode: row.postalCode, city: row.city, website: row.website,
    operator: row.operatorName, manager: row.managerName, contacts: entriesOf(db, facilityId),
  }
}

function checkedText(value: unknown): string {
  if (typeof value !== 'string') throw new ServiceError(400, 'facility_contact_invalid')
  const trimmed = value.trim()
  if (trimmed.length > MAX_CONTACT_TEXT) throw new ServiceError(400, 'facility_contact_text_too_long')
  return trimmed
}

function checkedEntry(entry: FacilityContactEntry): FacilityContactEntry {
  if (!(CONTACT_KINDS as readonly unknown[]).includes(entry.kind) || !(CONTACT_OWNERS as readonly unknown[]).includes(entry.belongsTo)) {
    throw new ServiceError(400, 'facility_contact_invalid')
  }
  const value = checkedText(entry.value)
  if (value === '') throw new ServiceError(400, 'facility_contact_value_required')
  if (entry.kind === 'email' ? !isEmailAddress(value) : !isPhoneNumber(value)) {
    throw new ServiceError(400, entry.kind === 'email' ? 'facility_contact_email_invalid' : 'facility_contact_phone_invalid')
  }
  return { kind: entry.kind, value, belongsTo: entry.belongsTo, label: checkedText(entry.label ?? '') }
}

/**
 * The contact data as the routes answer them: of the facility named (`?facilityId=`, a facility card on the settings
 * page), else of the facility the request works in; who may read which is decided by getFacilityContact.
 */
export function readFacilityContact(db: Db, viewer: SessionUser & { facilityId: number }, named: number | undefined): FacilityContactDto {
  return getFacilityContact(db, viewer, named ?? viewer.facilityId)
}

/** Stores the contact data of the facility named, else of the request's facility, and answers them as stored. */
export function writeFacilityContact(
  db: Db, actor: SessionUser & { facilityId: number }, named: number | undefined, input: FacilityContactDto,
): FacilityContactDto {
  const facilityId = named ?? actor.facilityId
  setFacilityContact(db, actor, facilityId, input)
  return getFacilityContact(db, actor, facilityId)
}

/**
 * The Träger stores the facility's contact data (all of it at once; the contacts replace the stored list, in the given
 * order). Texts are trimmed; PLZ is five digits or empty (400 facility_postal_code_invalid), the website a host name with or
 * without https:// (400 facility_website_invalid), an e-mail plausibly formatted (400 facility_contact_email_invalid), a phone
 * number digits, blanks and + / - ( ) with at least three digits (400 facility_contact_phone_invalid). Nothing is stored
 * when anything is invalid. Only with facilities.manage (403 forbidden); 404 facility_not_found.
 */
export function setFacilityContact(db: Db, actor: SessionUser, facilityId: number, input: FacilityContactDto): void {
  if (!can(actor.permissions, 'facilities.manage')) throw new ServiceError(403, 'forbidden')
  assertFacilityExists(db, facilityId)
  const postalCode = checkedText(input.postalCode)
  if (postalCode !== '' && !isPostalCode(postalCode)) throw new ServiceError(400, 'facility_postal_code_invalid')
  const website = checkedText(input.website)
  if (website !== '' && !isWebsite(website)) throw new ServiceError(400, 'facility_website_invalid')
  const values = {
    street: checkedText(input.street), postalCode, city: checkedText(input.city), website,
    operatorName: checkedText(input.operator), managerName: checkedText(input.manager),
  }
  if (!Array.isArray(input.contacts) || input.contacts.length > MAX_CONTACT_ENTRIES) {
    throw new ServiceError(400, 'facility_contact_too_many')
  }
  const contacts = input.contacts.map(checkedEntry)
  db.transaction((tx) => {
    tx.update(facilities).set(values).where(eq(facilities.id, facilityId)).run()
    tx.delete(facilityContacts).where(eq(facilityContacts.facilityId, facilityId)).run()
    if (contacts.length > 0) {
      tx.insert(facilityContacts).values(contacts.map((entry, sortOrder) => ({ ...entry, facilityId, sortOrder }))).run()
    }
  })
}

/** What a printout needs of a facility: its name, address and phone numbers (see facilityContactData). */
export interface FacilityContactSummary {
  name: string
  street: string
  postalCode: string
  city: string
  /** „Straße, PLZ Ort“ ('' when nothing is set). */
  address: string
  /** The number to print: the first phone number of the facility itself, otherwise the first one of any owner ('' = none). */
  phone: string
  /** Every phone number, in the stored order. */
  phones: string[]
  website: string
  /** The Träger's name and the phone numbers and e-mail addresses that belong to the Träger. */
  operator: string
  operatorPhones: string[]
  operatorEmails: string[]
  /** The Leitung's name(s) and the phone numbers and e-mail addresses that belong to the Leitung. */
  manager: string
  managerPhones: string[]
  managerEmails: string[]
}

/**
 * The facility's name, address and phone for later features (e.g. the accident report's prefill), without a permission
 * check: the caller has already checked that its user may work in the facility. null for a facility that does not exist.
 */
export function facilityContactData(db: Db, facilityId: number): FacilityContactSummary | null {
  const row = db.select().from(facilities).where(eq(facilities.id, facilityId)).get()
  if (!row) return null
  const entries = entriesOf(db, facilityId)
  const phoneEntries = entries.filter(entry => entry.kind === 'phone')
  const preferred = phoneEntries.find(entry => entry.belongsTo === 'facility') ?? phoneEntries[0]
  const of = (kind: 'phone' | 'email', owner: 'leitung' | 'traeger') => entries
    .filter(entry => entry.kind === kind && entry.belongsTo === owner).map(entry => entry.value)
  return {
    operator: row.operatorName, operatorPhones: of('phone', 'traeger'), operatorEmails: of('email', 'traeger'),
    manager: row.managerName, managerPhones: of('phone', 'leitung'), managerEmails: of('email', 'leitung'),
    name: row.name, street: row.street, postalCode: row.postalCode, city: row.city,
    address: addressLine(row.street, row.postalCode, row.city), phone: preferred?.value ?? '',
    phones: phoneEntries.map(entry => entry.value), website: row.website,
  }
}
