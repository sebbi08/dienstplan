import { and, asc, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm'
import {
  CONTACT_LIMITS, DEFAULT_CONTACT_CATEGORIES, comparableContactName, isEmailAddress, isSchoolCategory, normalizedWebsite,
} from '../../shared/domain/contacts'
import { can } from '../../shared/domain/permissions'
import type {
  ContactCategoryDto, ContactCategoryInput, ContactDto, ContactInput, ContactsDto, SchoolOptionDto, SessionUser,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { children, contactCategories, contacts, users } from '../db/schema'
import { ServiceError } from '../lib/errors'

/**
 * The facility's address book („Kontakte“): external business contacts (schools, Jugendamt, Fachberatung …) in
 * categories of the facility's own. Whoever holds contacts.manage (Leitung and Träger by default) sees every contact of
 * the facility and maintains them and the categories; everyone else of the facility (Mitarbeiter accounts) and the
 * facility's tablet see only the contacts marked „auch für Mitarbeitende und am Tablet sichtbar“. Contacts for all
 * facilities (`facilityId` null) are the Träger's (contacts.global) and show in every facility. Another facility's
 * contact or category is 404.
 */
export type ContactViewer = Pick<SessionUser, 'permissions'> & { facilityId: number }
export type ContactActor = Pick<SessionUser, 'id' | 'permissions'> & { facilityId: number }

type CategoryRow = typeof contactCategories.$inferSelect
type ContactRow = typeof contacts.$inferSelect

/** Sees every contact of the facility (not just those for the staff) and maintains them. */
const manages = (viewer: Pick<SessionUser, 'permissions'>) => can(viewer.permissions, 'contacts.manage')

function assertManager(actor: Pick<SessionUser, 'permissions'>): void {
  if (!manages(actor)) throw new ServiceError(403, 'forbidden')
}

// ---- categories ------------------------------------------------------------

/** The facility's categories in their order (ties by id). */
export const facilityContactCategories = (db: Db, facilityId: number): CategoryRow[] =>
  db.select().from(contactCategories).where(eq(contactCategories.facilityId, facilityId))
    .orderBy(asc(contactCategories.sortOrder), asc(contactCategories.id)).all()

/** Gives a facility the example categories (a new facility; existing ones got them from 0109_contacts). */
export function seedContactCategories(db: Db, facilityId: number): void {
  db.insert(contactCategories).values(DEFAULT_CONTACT_CATEGORIES.map((name, sortOrder) => ({ facilityId, name, sortOrder }))).run()
}

/** The trimmed category name (at most 60 characters); an empty one is 400 contact_category_name_required. */
function checkedCategoryName(name: string): string {
  const trimmed = name.trim()
  if (trimmed === '') throw new ServiceError(400, 'contact_category_name_required')
  return trimmed.slice(0, CONTACT_LIMITS.categoryName)
}

/** The trimmed name, unique regardless of case among the facility's categories (409 contact_category_name_taken). */
function uniqueCategoryName(db: Db, facilityId: number, name: string, current: CategoryRow | null): string {
  const checked = checkedCategoryName(name)
  const clash = facilityContactCategories(db, facilityId)
    .some(row => row.id !== current?.id && comparableContactName(row.name) === comparableContactName(checked))
  if (clash) throw new ServiceError(409, 'contact_category_name_taken')
  return checked
}

/** A category of the actor's facility (else 404 contact_category_not_found) that the actor maintains (else 403). */
function loadCategory(db: Db, actor: ContactActor, id: number): CategoryRow {
  assertManager(actor)
  const row = db.select().from(contactCategories)
    .where(and(eq(contactCategories.id, id), eq(contactCategories.facilityId, actor.facilityId))).get()
  if (!row) throw new ServiceError(404, 'contact_category_not_found')
  return row
}

/** A new category at the end of the facility's list; returns its id. */
export function createContactCategory(db: Db, actor: ContactActor, input: ContactCategoryInput): number {
  assertManager(actor)
  const name = uniqueCategoryName(db, actor.facilityId, input.name, null)
  const last = facilityContactCategories(db, actor.facilityId).at(-1)
  return db.insert(contactCategories).values({ facilityId: actor.facilityId, name, sortOrder: last ? last.sortOrder + 1 : 0 })
    .returning({ id: contactCategories.id }).get().id
}

/** Renames the category. */
export function renameContactCategory(db: Db, actor: ContactActor, id: number, input: ContactCategoryInput): void {
  const current = loadCategory(db, actor, id)
  db.update(contactCategories).set({ name: uniqueCategoryName(db, actor.facilityId, input.name, current) })
    .where(eq(contactCategories.id, id)).run()
}

/** Swaps the category with its neighbour; at an end nothing changes. The facility's list is numbered afresh. */
export function moveContactCategory(db: Db, actor: ContactActor, id: number, direction: 'up' | 'down'): void {
  loadCategory(db, actor, id)
  const all = facilityContactCategories(db, actor.facilityId)
  const at = all.findIndex(row => row.id === id)
  const other = direction === 'up' ? at - 1 : at + 1
  if (other < 0 || other >= all.length) return
  const swapped = [...all]
  swapped[at] = all[other]!
  swapped[other] = all[at]!
  db.transaction((tx) => {
    swapped.forEach((row, index) => {
      if (row.sortOrder !== index) tx.update(contactCategories).set({ sortOrder: index }).where(eq(contactCategories.id, row.id)).run()
    })
  })
}

/**
 * Deletes an empty category; one holding contacts of the facility is 409 contact_category_not_empty. Contacts for all
 * facilities filed by its name do not count: they move to „Vom Träger“.
 */
export function deleteContactCategory(db: Db, actor: ContactActor, id: number): void {
  loadCategory(db, actor, id)
  const used = db.select({ id: contacts.id }).from(contacts).where(eq(contacts.categoryId, id)).limit(1).get()
  if (used) throw new ServiceError(409, 'contact_category_not_empty')
  db.delete(contactCategories).where(eq(contactCategories.id, id)).run()
}

/**
 * The category names to offer the Träger for a contact for all facilities (contacts.global, else 403): every name a
 * facility uses or such a contact carries, once regardless of case, alphabetical.
 */
export function globalContactCategoryNames(db: Db, actor: Pick<SessionUser, 'permissions'>): string[] {
  if (!can(actor.permissions, 'contacts.global')) throw new ServiceError(403, 'forbidden')
  const names = [
    ...db.select({ name: contactCategories.name }).from(contactCategories)
      .orderBy(asc(contactCategories.facilityId), asc(contactCategories.sortOrder), asc(contactCategories.id)).all().map(row => row.name),
    ...db.select({ name: contacts.categoryName }).from(contacts).where(isNotNull(contacts.categoryName)).all().map(row => row.name ?? ''),
  ]
  const byName = new Map<string, string>()
  for (const name of names) {
    const key = comparableContactName(name)
    if (key !== '' && !byName.has(key)) byName.set(key, name.trim())
  }
  return [...byName.values()].sort((a, b) => a.localeCompare(b, 'de'))
}

// ---- placing ---------------------------------------------------------------

/** The facility's own contacts and those for all facilities. */
const ofFacility = (facilityId: number) => or(eq(contacts.facilityId, facilityId), isNull(contacts.facilityId))

/**
 * Where a contact shows in the facility: a facility's own in its category; one for all facilities in the facility's
 * category of the same name (regardless of case), otherwise under „Vom Träger“ (null).
 */
function placer(categories: readonly CategoryRow[]): (row: Pick<ContactRow, 'facilityId' | 'categoryId' | 'categoryName'>) => CategoryRow | null {
  const byId = new Map(categories.map(category => [category.id, category]))
  const byName = new Map<string, CategoryRow>()
  for (const category of categories) {
    const key = comparableContactName(category.name)
    if (!byName.has(key)) byName.set(key, category)
  }
  return row => (row.facilityId !== null
    ? (row.categoryId === null ? undefined : byId.get(row.categoryId)) ?? null
    : byName.get(comparableContactName(row.categoryName ?? '')) ?? null)
}

/** Whether the viewer sees the contact: whoever maintains the contacts all, everyone else only those for the staff. */
const seesContact = (viewer: Pick<SessionUser, 'permissions'>, row: Pick<ContactRow, 'visibleToStaff'>) =>
  manages(viewer) || row.visibleToStaff

/** A contact for all facilities is the Träger's (contacts.global); a facility's own needs contacts.manage. */
const mayEdit = (viewer: Pick<SessionUser, 'permissions'>, row: Pick<ContactRow, 'facilityId'>) =>
  row.facilityId === null ? can(viewer.permissions, 'contacts.global') : manages(viewer)

/** „Vom Träger“ last, then by organisation and person. */
function compareContacts(a: { row: ContactRow; category: CategoryRow | null }, b: { row: ContactRow; category: CategoryRow | null }): number {
  const order = (entry: { category: CategoryRow | null }) => entry.category?.sortOrder ?? Infinity
  return order(a) - order(b) || (a.category?.id ?? 0) - (b.category?.id ?? 0) || a.row.sortOrder - b.row.sortOrder
    || a.row.organisation.localeCompare(b.row.organisation, 'de') || a.row.person.localeCompare(b.row.person, 'de') || a.row.id - b.row.id
}

/**
 * The address book of the viewer's facility: every category in its order with the contacts the viewer sees in it, and
 * those contacts (by category, „Vom Träger“ last, then by organisation).
 */
export function listContacts(db: Db, viewer: ContactViewer): ContactsDto {
  const categories = facilityContactCategories(db, viewer.facilityId)
  const place = placer(categories)
  const rows = db.select().from(contacts).where(ofFacility(viewer.facilityId)).all()
    .filter(row => seesContact(viewer, row))
    .map(row => ({ row, category: place(row) }))
    .sort(compareContacts)
  const managing = manages(viewer)
  // Who changed a contact when is for those who maintain them: the login names never reach the staff or the tablet.
  const userIds = managing ? [...new Set(rows.map(({ row }) => row.updatedBy).filter((id): id is number => id !== null))] : []
  const usernames = new Map(userIds.length === 0 ? [] : db.select({ id: users.id, username: users.username }).from(users)
    .where(inArray(users.id, userIds)).all().map(user => [user.id, user.username]))
  const counts = new Map<number, number>()
  const owns = new Map<number, number>()
  for (const { row, category } of rows) {
    if (!category) continue
    counts.set(category.id, (counts.get(category.id) ?? 0) + 1)
    if (row.facilityId !== null) owns.set(category.id, (owns.get(category.id) ?? 0) + 1)
  }
  return {
    categories: categories.map((category): ContactCategoryDto => ({
      id: category.id, name: category.name, contactCount: counts.get(category.id) ?? 0, ownCount: managing ? owns.get(category.id) ?? 0 : 0,
    })),
    contacts: rows.map(({ row, category }): ContactDto => ({
      id: row.id,
      categoryId: category?.id ?? null,
      global: row.facilityId === null,
      globalCategoryName: row.facilityId === null ? row.categoryName ?? '' : null,
      organisation: row.organisation,
      person: row.person,
      role: row.role,
      phone: row.phone,
      mobile: row.mobile,
      email: row.email,
      street: row.street,
      postalCode: row.postalCode,
      city: row.city,
      website: row.website,
      note: row.note,
      visibleToStaff: row.visibleToStaff,
      updatedAt: managing ? row.updatedAt : '',
      updatedBy: row.updatedBy === null ? null : usernames.get(row.updatedBy) ?? null,
      canEdit: mayEdit(viewer, row),
    })),
    canManage: managing,
    canManageGlobal: can(viewer.permissions, 'contacts.global'),
  }
}

/** How many contacts the staff of the facility see (Mitarbeiter accounts get the menu entry only when there are any). */
export function staffContactCount(db: Db, facilityId: number): number {
  return db.select({ id: contacts.id }).from(contacts)
    .where(and(ofFacility(facilityId), eq(contacts.visibleToStaff, true))).all().length
}

// ---- contacts --------------------------------------------------------------

/** A text field trimmed and cut to its limit. */
const field = (value: string, limit: number) => value.trim().slice(0, limit)

/**
 * The checked fields: an organisation (400 contact_organisation_required), a valid e-mail address when one is given
 * (400 contact_email_invalid) and a website with http or https (400 contact_website_invalid; without a scheme https://
 * is put in front).
 */
function checkedFields(input: ContactInput) {
  const organisation = field(input.organisation, CONTACT_LIMITS.organisation)
  if (organisation === '') throw new ServiceError(400, 'contact_organisation_required')
  const email = field(input.email, CONTACT_LIMITS.email)
  if (email !== '' && !isEmailAddress(email)) throw new ServiceError(400, 'contact_email_invalid')
  const website = normalizedWebsite(input.website)
  if (website === null || website.length > CONTACT_LIMITS.website) throw new ServiceError(400, 'contact_website_invalid')
  return {
    organisation,
    person: field(input.person, CONTACT_LIMITS.person),
    role: field(input.role, CONTACT_LIMITS.role),
    phone: field(input.phone, CONTACT_LIMITS.phone),
    mobile: field(input.mobile, CONTACT_LIMITS.mobile),
    email,
    street: field(input.street, CONTACT_LIMITS.street),
    postalCode: field(input.postalCode, CONTACT_LIMITS.postalCode),
    city: field(input.city, CONTACT_LIMITS.city),
    website,
    note: field(input.note, CONTACT_LIMITS.note),
    visibleToStaff: input.visibleToStaff,
  }
}

/** The category of a facility's contact: one of the facility's (else 400 contact_category_invalid). */
function chosenCategory(db: Db, facilityId: number, id: number | null | undefined): number {
  const row = id == null
    ? undefined
    : db.select({ id: contactCategories.id }).from(contactCategories)
      .where(and(eq(contactCategories.id, id), eq(contactCategories.facilityId, facilityId))).get()
  if (!row) throw new ServiceError(400, 'contact_category_invalid')
  return row.id
}

/** Where the contact is filed: a facility's category, or for all facilities a category name. */
function filing(db: Db, facilityId: number, global: boolean, input: ContactInput) {
  return global
    ? { categoryId: null, categoryName: checkedCategoryName(input.categoryName ?? '') }
    : { categoryId: chosenCategory(db, facilityId, input.categoryId), categoryName: null }
}

/** A new contact of the actor's facility, or for all facilities (Träger, contacts.global); returns its id. */
export function createContact(db: Db, actor: ContactActor, input: ContactInput, now: Date = new Date()): number {
  assertManager(actor)
  const global = input.scope === 'all'
  if (global && !can(actor.permissions, 'contacts.global')) throw new ServiceError(403, 'forbidden')
  const values = { ...checkedFields(input), ...filing(db, actor.facilityId, global, input) }
  return db.insert(contacts).values({
    ...values, facilityId: global ? null : actor.facilityId, updatedAt: now.toISOString(), updatedBy: actor.id,
  }).returning({ id: contacts.id }).get().id
}

/**
 * A contact of the actor's facility or for all facilities (else 404 address_contact_not_found) that the actor may
 * change (else 403: a contact for all facilities is the Träger's).
 */
function loadEditable(db: Db, actor: ContactActor, id: number): ContactRow {
  assertManager(actor)
  const row = db.select().from(contacts).where(and(eq(contacts.id, id), ofFacility(actor.facilityId))).get()
  if (!row) throw new ServiceError(404, 'address_contact_not_found')
  if (!mayEdit(actor, row)) throw new ServiceError(403, 'forbidden')
  return row
}

/** Changes the contact; where it is kept (the facility or all facilities) stays. */
export function updateContact(db: Db, actor: ContactActor, id: number, input: ContactInput, now: Date = new Date()): void {
  const row = loadEditable(db, actor, id)
  const values = { ...checkedFields(input), ...filing(db, actor.facilityId, row.facilityId === null, input) }
  db.update(contacts).set({ ...values, updatedAt: now.toISOString(), updatedBy: actor.id }).where(eq(contacts.id, id)).run()
}

/** Deletes the contact; a child that had it as „künftige Schule“ keeps none (the reference is set null). */
export function deleteContact(db: Db, actor: ContactActor, id: number): void {
  loadEditable(db, actor, id)
  db.delete(contacts).where(eq(contacts.id, id)).run()
}

// ---- the future school of a child ------------------------------------------

/** The shown name of a school: the organisation with the city („Grundschule Süd, Heidelberg“). */
const schoolName = (row: Pick<ContactRow, 'organisation' | 'city'>) => (row.city ? `${row.organisation}, ${row.city}` : row.organisation)

/**
 * The schools to choose as a child's „künftige Schule“ in the facility: its contacts and those for all facilities that
 * show in a category whose name contains „Schule“ (a contact for all facilities without such a category: when its own
 * category name does), alphabetical. Only their names, also for whoever does not see every contact: the child's record
 * is the place this is chosen.
 */
export function schoolOptions(db: Db, facilityId: number): SchoolOptionDto[] {
  const place = placer(facilityContactCategories(db, facilityId))
  return db.select().from(contacts).where(ofFacility(facilityId)).all()
    .filter((row) => {
      const category = place(row)
      return isSchoolCategory(category?.name ?? (row.facilityId === null ? row.categoryName ?? '' : ''))
    })
    .map(row => ({ id: row.id, name: schoolName(row) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de') || a.id - b.id)
}

/**
 * The checked „künftige Schule“ of a child of the facility: none, one of `schoolOptions`, or the stored one even when it
 * no longer is (its category was renamed); else 400 future_school_invalid.
 */
export function checkedFutureSchool(db: Db, facilityId: number, id: number | null, stored: number | null): number | null {
  if (id === null || id === stored) return id
  if (!schoolOptions(db, facilityId).some(option => option.id === id)) throw new ServiceError(400, 'future_school_invalid')
  return id
}

/** The shown names of the schools by contact id (for the child's record and the list of school children). */
export function schoolNames(db: Db, ids: readonly (number | null)[]): Map<number, string> {
  const wanted = [...new Set(ids.filter((id): id is number => id !== null))]
  if (wanted.length === 0) return new Map()
  return new Map(db.select({ id: contacts.id, organisation: contacts.organisation, city: contacts.city }).from(contacts)
    .where(inArray(contacts.id, wanted)).all().map(row => [row.id, schoolName(row)]))
}

/** The shown name of one school (null for none). */
export function schoolNameOf(db: Db, id: number | null): string | null {
  return id === null ? null : schoolNames(db, [id]).get(id) ?? null
}

/**
 * Whether a child moving to another facility keeps its „künftige Schule“: only one for all facilities (a facility's own
 * contact stays behind).
 */
export function schoolStaysOnMove(db: Db, childId: number): boolean {
  const row = db.select({ facilityId: contacts.facilityId }).from(children)
    .innerJoin(contacts, eq(contacts.id, children.futureSchoolContactId)).where(eq(children.id, childId)).get()
  return row !== undefined && row.facilityId === null
}
