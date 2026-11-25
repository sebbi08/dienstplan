import { and, asc, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm'
import {
  CONTACT_LIMITS, DEFAULT_CONTACT_CATEGORIES, comparableContactName, contactLevels, contactViewLevel, contactVisibility, isEmailAddress,
  isSchoolCategory, normalizedWebsite, seesAtLevel,
} from '../../shared/domain/contacts'
import { groupsAllow, inFacilityScope, isOrphan, type Audience, type DocumentScope, type ItemTargets } from '../../shared/domain/documentTargets'
import { can } from '../../shared/domain/permissions'
import { swappedSiblings, type TemplateVisibility } from '../../shared/domain/templateCategories'
import type {
  ContactCategoryDto, ContactCategoryInput, ContactDto, ContactInput, ContactsDto, Role, SchoolOptionDto, SessionUser,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { children, contactCategories, contacts, users } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { assertMayCreateCategories, createMissingCategories } from './categoryAdopt'
import {
  checkedTargets, facilitiesInScope, loadTargets, targetNames, targetOptions, targetsDto, targetsInput, targetsOf, writeTargets,
} from './documentTargets'

/**
 * The facility's address book („Kontakte“): external business contacts (schools, Jugendamt, Fachberatung …) in
 * categories of the facility's own. Whoever holds contacts.manage (Leitung and Träger by default) sees every contact of
 * the facility and maintains them and the categories; everyone else of the facility (Mitarbeiter accounts) and the
 * facility's tablet see only the contacts marked „auch für Mitarbeitende und am Tablet sichtbar“ whose groups allow them
 * („Gilt für“, shared/domain/documentTargets.ts: all groups, or their home group chosen; at the tablet the unlocking
 * person's). Contacts of the Träger (`facilityId` null, contacts.global) show in all facilities or in those chosen.
 * Another facility's contact or category is 404. On top, each category says who sees it and its contacts („Wer sieht
 * sie?“, like the print template categories; the stricter of category and contact wins, shared/domain/contacts.ts): a
 * category for Leitung and Träger hides its contacts from the staff and the tablet, one for the Träger alone also from
 * the Leitung, who can neither see it (404) nor give a category that visibility (403).
 */
export type ContactViewer = Pick<SessionUser, 'role' | 'permissions'> & { facilityId: number; homeGroupId?: number | null }
export type ContactActor = Pick<SessionUser, 'id' | 'role' | 'permissions'> & { facilityId: number }

type CategoryRow = typeof contactCategories.$inferSelect
type ContactRow = typeof contacts.$inferSelect

/** Sees every contact of the facility (not just those for the staff) and maintains them. */
const manages = (viewer: Pick<SessionUser, 'permissions'>) => can(viewer.permissions, 'contacts.manage')

function assertManager(actor: Pick<SessionUser, 'permissions'>): void {
  if (!manages(actor)) throw new ServiceError(403, 'forbidden')
}

/** The widest visibility the viewer sees: the staff and the tablet 'all', Leitung 'managers', the Träger 'provider'. */
const levelOf = (viewer: Pick<SessionUser, 'role' | 'permissions'>): TemplateVisibility => contactViewLevel(viewer.role, manages(viewer))

/** Whether the viewer sees the category (and so the contacts filed in it). */
const seesCategory = (viewer: Pick<SessionUser, 'role' | 'permissions'>, row: Pick<CategoryRow, 'visibility'>) =>
  seesAtLevel(levelOf(viewer), row.visibility)

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

/**
 * A category of the actor's facility that the actor sees (else 404 contact_category_not_found) and maintains (else
 * 403).
 */
function loadCategory(db: Db, actor: ContactActor, id: number): CategoryRow {
  assertManager(actor)
  const row = db.select().from(contactCategories)
    .where(and(eq(contactCategories.id, id), eq(contactCategories.facilityId, actor.facilityId))).get()
  if (!row || !seesCategory(actor, row)) throw new ServiceError(404, 'contact_category_not_found')
  return row
}

/** „Wer sieht sie?“ as the actor may give it: one of the visibilities they see (else 403: a Leitung not „nur Träger“). */
function checkedVisibility(actor: ContactActor, visibility: TemplateVisibility): TemplateVisibility {
  if (!contactLevels(levelOf(actor)).includes(visibility)) throw new ServiceError(403, 'forbidden')
  return visibility
}

/** A new category at the end of the facility's list (for all unless said otherwise); returns its id. */
export function createContactCategory(db: Db, actor: ContactActor, input: ContactCategoryInput): number {
  assertManager(actor)
  const visibility = checkedVisibility(actor, input.visibility ?? 'all')
  const name = uniqueCategoryName(db, actor.facilityId, input.name, null)
  const last = facilityContactCategories(db, actor.facilityId).at(-1)
  return db.insert(contactCategories).values({ facilityId: actor.facilityId, name, visibility, sortOrder: last ? last.sortOrder + 1 : 0 })
    .returning({ id: contactCategories.id }).get().id
}

/** Renames the category and sets who sees it (without `visibility` that stays as it is). */
export function renameContactCategory(db: Db, actor: ContactActor, id: number, input: ContactCategoryInput): void {
  const current = loadCategory(db, actor, id)
  const visibility = checkedVisibility(actor, input.visibility ?? current.visibility)
  db.update(contactCategories).set({ name: uniqueCategoryName(db, actor.facilityId, input.name, current), visibility })
    .where(eq(contactCategories.id, id)).run()
}

/**
 * Swaps the category with its neighbour among those the actor sees (hidden ones keep their places); at an end nothing
 * changes. The facility's list is numbered afresh.
 */
export function moveContactCategory(db: Db, actor: ContactActor, id: number, direction: 'up' | 'down'): void {
  loadCategory(db, actor, id)
  const all = facilityContactCategories(db, actor.facilityId).map(row => ({ ...row, parentId: null }))
  const swapped = swappedSiblings(all, all.filter(row => seesCategory(actor, row)), id, direction)
  if (!swapped) return
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

/** The facility's own contacts and the Träger's (whose „Gilt für“ decides whether they show here). */
const ofFacility = (facilityId: number) => or(eq(contacts.facilityId, facilityId), isNull(contacts.facilityId))

/** Where a contact shows in the facility: its category there (null = „Vom Träger“), with its „Gilt für“. */
interface Placement { category: CategoryRow | null; targets: ItemTargets | undefined }

/**
 * Where a contact shows in the facility: a facility's own in its category; one of the Träger in the facility's category
 * of the same name (regardless of case), otherwise under „Vom Träger“ (category null). A contact not for this facility
 * („Gilt für“) is nowhere (null) – except, for the Träger (`orphans`), one whose chosen facilities are all gone: under
 * „Vom Träger“, to be given facilities again or deleted.
 */
function placer(categories: readonly CategoryRow[], facilityId: number, targets: ReadonlyMap<number, ItemTargets>, orphans = false) {
  const byId = new Map(categories.map(category => [category.id, category]))
  const byName = new Map<string, CategoryRow>()
  for (const category of categories) {
    const key = comparableContactName(category.name)
    if (!byName.has(key)) byName.set(key, category)
  }
  return (row: Pick<ContactRow, 'id' | 'facilityId' | 'categoryId' | 'categoryName'>): Placement | null => {
    const itemTargets = targets.get(row.id)
    if (row.facilityId !== null) {
      if (row.facilityId !== facilityId) return null
      return { category: (row.categoryId === null ? undefined : byId.get(row.categoryId)) ?? null, targets: itemTargets }
    }
    if (!itemTargets) return null
    const orphan = isOrphan(itemTargets)
    if (orphan ? !orphans : !inFacilityScope(itemTargets, facilityId)) return null
    return { category: orphan ? null : byName.get(comparableContactName(row.categoryName ?? '')) ?? null, targets: itemTargets }
  }
}

/** The audience of a viewer: their role and home group (none given: none). */
const audienceOf = (viewer: { role: Role; homeGroupId?: number | null }): Audience => ({ role: viewer.role, homeGroupId: viewer.homeGroupId ?? null })

/**
 * Whether the viewer sees the contact placed so: as far as the category's and the contact's own visibility allow (the
 * stricter wins); whoever maintains the contacts then every such contact for the facility, everyone else (Mitarbeiter,
 * Gruppenleitung, the tablet) only those for all whose groups allow them (all groups, or their home group chosen there;
 * at the tablet the unlocking person's).
 */
function seesContact(viewer: ContactViewer, row: Pick<ContactRow, 'visibleToStaff'>, placement: Placement): boolean {
  if (!seesAtLevel(levelOf(viewer), contactVisibility(placement.category?.visibility ?? null, row.visibleToStaff))) return false
  if (manages(viewer)) return true
  return !placement.targets || groupsAllow(placement.targets, viewer.facilityId, audienceOf(viewer))
}

/** A contact of the Träger is the Träger's (contacts.global); a facility's own needs contacts.manage. */
const mayEdit = (viewer: Pick<SessionUser, 'permissions'>, row: Pick<ContactRow, 'facilityId'>) =>
  row.facilityId === null ? can(viewer.permissions, 'contacts.global') : manages(viewer)

/** „Vom Träger“ last, then by organisation and person. */
function compareContacts(a: { row: ContactRow; category: CategoryRow | null }, b: { row: ContactRow; category: CategoryRow | null }): number {
  const order = (entry: { category: CategoryRow | null }) => entry.category?.sortOrder ?? Infinity
  return order(a) - order(b) || (a.category?.id ?? 0) - (b.category?.id ?? 0) || a.row.sortOrder - b.row.sortOrder
    || a.row.organisation.localeCompare(b.row.organisation, 'de') || a.row.person.localeCompare(b.row.person, 'de') || a.row.id - b.row.id
}

/** The contacts for the facility the viewer sees, placed and in order. */
function visibleContacts(db: Db, viewer: ContactViewer, categories: readonly CategoryRow[]) {
  const all = db.select().from(contacts).where(ofFacility(viewer.facilityId)).all()
  const place = placer(categories, viewer.facilityId, loadTargets(db, 'contact', all), can(viewer.permissions, 'contacts.global'))
  return all
    .map(row => ({ row, placement: place(row) }))
    .filter((entry): entry is { row: ContactRow; placement: Placement } => entry.placement !== null && seesContact(viewer, entry.row, entry.placement))
    .map(({ row, placement }) => ({ row, category: placement.category, targets: placement.targets }))
    .sort(compareContacts)
}

/**
 * The address book of the viewer's facility: every category in its order with the contacts the viewer sees in it, and
 * those contacts (by category, „Vom Träger“ last, then by organisation). Whoever maintains the contacts gets their „Gilt
 * für“ (the hints „nur Kita A“ / „nur Bären“; the full choice for those they may change).
 */
export function listContacts(db: Db, viewer: ContactViewer): ContactsDto {
  const categories = facilityContactCategories(db, viewer.facilityId)
  const rows = visibleContacts(db, viewer, categories)
  const managing = manages(viewer)
  // Who changed a contact when is for those who maintain them: the login names never reach the staff or the tablet.
  const userIds = managing ? [...new Set(rows.map(({ row }) => row.updatedBy).filter((id): id is number => id !== null))] : []
  const usernames = new Map(userIds.length === 0 ? [] : db.select({ id: users.id, username: users.username }).from(users)
    .where(inArray(users.id, userIds)).all().map(user => [user.id, user.username]))
  const names = managing && rows.length > 0 ? targetNames(db) : null
  const counts = new Map<number, number>()
  const owns = new Map<number, number>()
  for (const { row, category } of rows) {
    if (!category) continue
    counts.set(category.id, (counts.get(category.id) ?? 0) + 1)
    if (row.facilityId !== null) owns.set(category.id, (owns.get(category.id) ?? 0) + 1)
  }
  return {
    // Only the categories the viewer sees: the names of the others never reach them.
    categories: categories.filter(category => seesCategory(viewer, category)).map((category): ContactCategoryDto => ({
      id: category.id, name: category.name, visibility: category.visibility, contactCount: counts.get(category.id) ?? 0,
      ownCount: managing ? owns.get(category.id) ?? 0 : 0,
    })),
    contacts: rows.map(({ row, category, targets }): ContactDto => {
      const canEdit = mayEdit(viewer, row)
      return {
        id: row.id,
        categoryId: category?.id ?? null,
        global: row.facilityId === null,
        allFacilities: row.allFacilities,
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
        canEdit,
        targets: names && targets ? targetsDto(row, targets, viewer.facilityId, names, canEdit) : null,
      }
    }),
    canManage: managing,
    canManageGlobal: can(viewer.permissions, 'contacts.global'),
  }
}

/**
 * How many contacts the viewer sees (Mitarbeiter accounts get the menu entry only when there are any): for the staff
 * those for the staff whose groups allow them.
 */
export function staffContactCount(db: Db, viewer: ContactViewer): number {
  return visibleContacts(db, viewer, facilityContactCategories(db, viewer.facilityId)).length
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

/** The category of a facility's contact: one of the facility's the actor sees (else 400 contact_category_invalid). */
function chosenCategory(db: Db, actor: ContactActor, id: number | null | undefined): number {
  const row = id == null
    ? undefined
    : db.select({ id: contactCategories.id, visibility: contactCategories.visibility }).from(contactCategories)
      .where(and(eq(contactCategories.id, id), eq(contactCategories.facilityId, actor.facilityId))).get()
  if (!row || !seesCategory(actor, row)) throw new ServiceError(400, 'contact_category_invalid')
  return row.id
}

/** Where the contact is filed: a facility's category (its own contact), or for one of the Träger a category name. */
function filing(db: Db, actor: ContactActor, own: boolean, input: ContactInput) {
  return own
    ? { categoryId: chosenCategory(db, actor, input.categoryId), categoryName: null }
    : { categoryId: null, categoryName: checkedCategoryName(input.categoryName ?? '') }
}

/** Asked for when saving a contact of the Träger: its category where it is missing in the facilities of its „Gilt für“. */
function adoptCategory(db: Db, actor: ContactActor, contact: { id: number; facilityId: null; allFacilities: boolean }, categoryName: string | null): void {
  createMissingCategories(db, 'contact', actor.facilityId, facilitiesInScope(db, contact, targetsOf(db, 'contact', contact)), categoryName ?? '', null)
}

/** A scope beyond the own facility is the Träger's (contacts.global, else 403). */
function assertScopeAllowed(actor: ContactActor, scope: DocumentScope): void {
  if (scope !== 'facility' && !can(actor.permissions, 'contacts.global')) throw new ServiceError(403, 'forbidden')
}

/**
 * A new contact: of the actor's facility, or of the Träger for all or the chosen facilities (contacts.global); with
 * „Gilt für“ (groups; for the Träger also facilities). Returns its id.
 */
export function createContact(db: Db, actor: ContactActor, input: ContactInput, now: Date = new Date()): number {
  assertManager(actor)
  const scope = input.scope ?? 'facility'
  assertScopeAllowed(actor, scope)
  if (input.createCategories) assertMayCreateCategories('contact', actor)
  const own = scope === 'facility'
  const values = { ...checkedFields(input), ...filing(db, actor, own, input) }
  const targets = checkedTargets(db, scope, own ? actor.facilityId : null, input)
  return db.transaction((tx) => {
    const id = tx.insert(contacts).values({
      ...values, facilityId: own ? actor.facilityId : null, allFacilities: targets.allFacilities, updatedAt: now.toISOString(), updatedBy: actor.id,
    }).returning({ id: contacts.id }).get().id
    writeTargets(tx, 'contact', id, targets)
    if (input.createCategories && !own) adoptCategory(tx, actor, { id, facilityId: null, allFacilities: targets.allFacilities }, values.categoryName)
    return id
  })
}

/**
 * A contact for the actor's facility (for the Träger also one without facilities; else 404 address_contact_not_found)
 * that the actor may change (else 403: a contact of the Träger is the Träger's).
 */
function loadEditable(db: Db, actor: ContactActor, id: number): ContactRow {
  assertManager(actor)
  const row = db.select().from(contacts).where(and(eq(contacts.id, id), ofFacility(actor.facilityId))).get()
  const placed = row && placer(facilityContactCategories(db, actor.facilityId), actor.facilityId, loadTargets(db, 'contact', [row]),
    can(actor.permissions, 'contacts.global'))(row)
  // One the actor does not see (in a category for the Träger alone) is not there for them.
  if (!row || !placed || !seesContact(actor, row, placed)) throw new ServiceError(404, 'address_contact_not_found')
  if (!mayEdit(actor, row)) throw new ServiceError(403, 'forbidden')
  return row
}

/**
 * Changes the contact and „Gilt für“: a facility's contact keeps its facility (its groups may change, Leitung too); the
 * Träger may turn it into one for all or the chosen facilities (filed by name) and back into the active facility's own;
 * without `scope` „Gilt für“ stays as it is.
 */
export function updateContact(db: Db, actor: ContactActor, id: number, input: ContactInput, now: Date = new Date()): void {
  const row = loadEditable(db, actor, id)
  const current = targetsInput(row, targetsOf(db, 'contact', row))
  const scope = input.scope ?? current.scope
  assertScopeAllowed(actor, scope)
  if (input.createCategories) assertMayCreateCategories('contact', actor)
  const own = scope === 'facility'
  // An own contact stays with its facility; the Träger's becomes the active facility's.
  const facilityId = own ? row.facilityId ?? actor.facilityId : null
  if (own && facilityId !== actor.facilityId) throw new ServiceError(403, 'forbidden')
  const values = { ...checkedFields(input), ...filing(db, actor, own, input) }
  const targets = checkedTargets(db, scope, facilityId, input.scope === undefined ? { ...current, scope } : input)
  db.transaction((tx) => {
    tx.update(contacts).set({ ...values, facilityId, allFacilities: targets.allFacilities, updatedAt: now.toISOString(), updatedBy: actor.id })
      .where(eq(contacts.id, id)).run()
    writeTargets(tx, 'contact', id, targets)
    if (input.createCategories && !own) adoptCategory(tx, actor, { id, facilityId: null, allFacilities: targets.allFacilities }, values.categoryName)
  })
}

/** Deletes the contact; a child that had it as „künftige Schule“ keeps none (the reference is set null). */
export function deleteContact(db: Db, actor: ContactActor, id: number): void {
  loadEditable(db, actor, id)
  db.delete(contacts).where(eq(contacts.id, id)).run()
}

/** What „Gilt für“ offers whoever maintains the contacts: the Träger every facility with its groups, else the own one. */
export function contactTargetOptions(db: Db, actor: ContactActor) {
  assertManager(actor)
  return targetOptions(db, actor.facilityId, can(actor.permissions, 'contacts.global'))
}

// ---- the future school of a child ------------------------------------------

/** The shown name of a school: the organisation with the city („Grundschule Süd, Heidelberg“). */
const schoolName = (row: Pick<ContactRow, 'organisation' | 'city'>) => (row.city ? `${row.organisation}, ${row.city}` : row.organisation)

/**
 * The schools to choose as a child's „künftige Schule“ in the facility: its contacts and those of the Träger whose
 * „Gilt für“ includes the facility (the groups do not matter for this link), that show in a category whose name
 * contains „Schule“ (a contact of the Träger without such a category: when its own category name does), alphabetical.
 * Only their names, also for whoever does not see every contact: the child's record is the place this is chosen.
 */
export function schoolOptions(db: Db, facilityId: number): SchoolOptionDto[] {
  const all = db.select().from(contacts).where(ofFacility(facilityId)).all()
  const place = placer(facilityContactCategories(db, facilityId), facilityId, loadTargets(db, 'contact', all))
  return all
    .filter((row) => {
      const placement = place(row)
      return placement !== null && isSchoolCategory(placement.category?.name ?? (row.facilityId === null ? row.categoryName ?? '' : ''))
    })
    .map(row => ({ id: row.id, name: schoolName(row) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de') || a.id - b.id)
}

/**
 * Whether the contact is for the facility (its own, or a contact of the Träger whose „Gilt für“ includes it): a linked
 * school that is not („gilt nicht mehr für diese Einrichtung“) stays linked, with a hint.
 */
export function contactForFacility(db: Db, facilityId: number, contactId: number): boolean {
  const row = db.select({ id: contacts.id, facilityId: contacts.facilityId, allFacilities: contacts.allFacilities }).from(contacts)
    .where(eq(contacts.id, contactId)).get()
  if (!row) return false
  if (row.facilityId !== null) return row.facilityId === facilityId
  return inFacilityScope(targetsOf(db, 'contact', row), facilityId)
}

/**
 * Whether a linked school still is for the district list's scope by its „Gilt für“ (its category does not matter): for a
 * facility's list `contactForFacility`; for the Träger's list a contact of the Träger for at least one facility.
 */
export function contactForScope(db: Db, scope: number | null, contactId: number): boolean {
  if (scope !== null) return contactForFacility(db, scope, contactId)
  const row = db.select({ id: contacts.id, facilityId: contacts.facilityId, allFacilities: contacts.allFacilities }).from(contacts)
    .where(eq(contacts.id, contactId)).get()
  return !!row && row.facilityId === null && !isOrphan(targetsOf(db, 'contact', row))
}

/**
 * The checked „künftige Schule“ of a child of the facility: none, one of `schoolOptions`, or the stored one even when it
 * no longer is (its category was renamed, or its „Gilt für“ changed); else 400 future_school_invalid.
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
 * Whether a child moving to another facility keeps its „künftige Schule“: only a contact of the Träger whose „Gilt für“
 * includes the new facility (a facility's own contact stays behind).
 */
export function schoolStaysOnMove(db: Db, childId: number, toFacilityId: number): boolean {
  const row = db.select({ id: contacts.id, facilityId: contacts.facilityId, allFacilities: contacts.allFacilities }).from(children)
    .innerJoin(contacts, eq(contacts.id, children.futureSchoolContactId)).where(eq(children.id, childId)).get()
  return row !== undefined && row.facilityId === null && inFacilityScope(targetsOf(db, 'contact', row), toFacilityId)
}
