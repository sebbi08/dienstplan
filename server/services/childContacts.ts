import { asc, eq, max } from 'drizzle-orm'
import type { IsoDate } from '../../shared/domain/types'
import type { ChildContactDto, ChildContactInput, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { childContacts, children } from '../db/schema'
import { clearedReviews, loadEditableChild, sectionStamp } from '../lib/childRecord'
import { ServiceError } from '../lib/errors'
import { settleDue } from './childGroupChanges'

type ContactRow = typeof childContacts.$inferSelect

function toDto(row: ContactRow): ChildContactDto {
  return {
    id: row.id, name: row.name, relation: row.relation, phoneHome: row.phoneHome, phoneMobile: row.phoneMobile,
    phoneWork: row.phoneWork, isGuardian: row.isGuardian, mayPickUp: row.mayPickUp, emergencyRank: row.emergencyRank,
    contactBan: row.contactBan, contactBanNote: row.contactBanNote, note: row.note,
  }
}

/** The child's contacts in their order. */
export function listContacts(db: Db, childId: number): ChildContactDto[] {
  return db.select().from(childContacts).where(eq(childContacts.childId, childId))
    .orderBy(asc(childContacts.sortOrder), asc(childContacts.id)).all().map(toDto)
}

/** Trimmed values; a name is required, and a banned person is neither a pick-up nor an emergency contact and has a reason. */
function checkedContact(input: ChildContactInput): ChildContactInput {
  const checked = {
    ...input,
    name: input.name.trim(),
    relation: input.relation.trim(),
    phoneHome: input.phoneHome.trim(),
    phoneMobile: input.phoneMobile.trim(),
    phoneWork: input.phoneWork.trim(),
    contactBanNote: input.contactBanNote.trim(),
    note: input.note.trim(),
  }
  if (checked.name === '') throw new ServiceError(400, 'contact_name_required')
  if (checked.contactBan) {
    if (checked.mayPickUp || checked.emergencyRank !== null) throw new ServiceError(400, 'contact_ban_conflict')
    if (checked.contactBanNote === '') throw new ServiceError(400, 'contact_ban_note_required')
  }
  return checked
}

/** The contact, which must belong to a child of the facility (otherwise 404 contact_not_found). */
function loadContact(db: Db, facilityId: number, contactId: number): ContactRow {
  const row = db.select({ contact: childContacts, facilityId: children.facilityId }).from(childContacts)
    .innerJoin(children, eq(children.id, childContacts.childId))
    .where(eq(childContacts.id, contactId)).get()
  if (!row || row.facilityId !== facilityId) throw new ServiceError(404, 'contact_not_found')
  return row.contact
}

/**
 * The contact and its child for a change: the contact must belong to a child of the facility (404 contact_not_found)
 * and the child must not be archived (managers: 409 child_archived; everybody else gets the contact's own 404
 * contact_not_found, so nothing reveals an archived child's record).
 */
function loadEditableContact(db: Db, actor: SessionUser, facilityId: number, contactId: number, today: IsoDate): ContactRow {
  const contact = loadContact(db, facilityId, contactId)
  try {
    loadEditableChild(db, actor, facilityId, contact.childId, today)
  }
  catch (error) {
    if (error instanceof ServiceError && error.code === 'child_not_found') throw new ServiceError(404, 'contact_not_found')
    throw error
  }
  return contact
}

/**
 * Every contact write stamps the section and counts as confirming it after a group change; a change whose day has
 * come is applied first, so the marker it sets is cleared too.
 */
function stamp(db: Db, childId: number, actor: SessionUser, today: IsoDate, now: Date): void {
  settleDue(db, childId, today, now)
  db.update(children).set({ ...sectionStamp('contacts', actor.id, now), ...clearedReviews('contacts') })
    .where(eq(children.id, childId)).run()
}

/** A new contact at the end of the child's list; returns its id. */
export function addContact(
  db: Db, actor: SessionUser, facilityId: number, childId: number, input: ChildContactInput, today: IsoDate,
  now: Date = new Date(),
): number {
  loadEditableChild(db, actor, facilityId, childId, today)
  const checked = checkedContact(input)
  return db.transaction((tx) => {
    const sortOrder = (tx.select({ value: max(childContacts.sortOrder) }).from(childContacts)
      .where(eq(childContacts.childId, childId)).get()?.value ?? -1) + 1
    const { id } = tx.insert(childContacts).values({ ...checked, childId, sortOrder }).returning({ id: childContacts.id }).get()
    stamp(tx, childId, actor, today, now)
    return id
  })
}

export function updateContact(
  db: Db, actor: SessionUser, facilityId: number, contactId: number, input: ChildContactInput, today: IsoDate,
  now: Date = new Date(),
): void {
  const contact = loadEditableContact(db, actor, facilityId, contactId, today)
  const checked = checkedContact(input)
  db.transaction((tx) => {
    tx.update(childContacts).set(checked).where(eq(childContacts.id, contactId)).run()
    stamp(tx, contact.childId, actor, today, now)
  })
}

export function deleteContact(
  db: Db, actor: SessionUser, facilityId: number, contactId: number, today: IsoDate, now: Date = new Date(),
): void {
  const contact = loadEditableContact(db, actor, facilityId, contactId, today)
  db.transaction((tx) => {
    tx.delete(childContacts).where(eq(childContacts.id, contactId)).run()
    stamp(tx, contact.childId, actor, today, now)
  })
}

/** Puts the child's contacts in the given order; the ids must be exactly the child's contacts (400 invalid_order). */
export function reorderContacts(
  db: Db, actor: SessionUser, facilityId: number, childId: number, ids: number[], today: IsoDate,
  now: Date = new Date(),
): void {
  loadEditableChild(db, actor, facilityId, childId, today)
  const existing = new Set(listContacts(db, childId).map(contact => contact.id))
  if (ids.length !== existing.size || new Set(ids).size !== ids.length || !ids.every(id => existing.has(id))) {
    throw new ServiceError(400, 'invalid_order')
  }
  db.transaction((tx) => {
    ids.forEach((id, index) => tx.update(childContacts).set({ sortOrder: index }).where(eq(childContacts.id, id)).run())
    stamp(tx, childId, actor, today, now)
  })
}
