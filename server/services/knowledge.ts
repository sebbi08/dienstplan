import { and, asc, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm'
import { todayIso } from '../../shared/domain/dates'
import { FORM_LIMITS } from '../../shared/domain/forms'
import {
  KNOWLEDGE_LIMITS, KNOWLEDGE_STARTER_CATEGORIES, KNOWLEDGE_STARTER_LINKS, KNOWLEDGE_STARTER_SUBCATEGORIES, checkedAsOf, checkedKnowledgeUrl,
  comparableKnowledgeName, confirmState, type KnowledgeConfirmState,
} from '../../shared/domain/knowledge'
import { can } from '../../shared/domain/permissions'
import { isRichText, plainTextToRichText, richTextLength, sanitizeRichText } from '../../shared/domain/richText'
import { isEmployedOn } from '../../shared/domain/targets'
import {
  categoriesInTreeOrder, categoryNameList, categoryPath, categoryPlacer, compareSpots, seesAll, seesCategoryNode, spotVisibilities,
  swappedSiblings, visibleTemplateLevels, type CategorySpot, type TemplateVisibility,
} from '../../shared/domain/templateCategories'
import type { IsoDate } from '../../shared/domain/types'
import type {
  CategoryNameDto, KnowledgeCategoryDto, KnowledgeCategoryInput, KnowledgeConfirmationRowDto, KnowledgeConfirmationsDto,
  KnowledgeConfirmResultDto, KnowledgeDto, KnowledgeEntryDto, KnowledgeEntryInput, Role, SessionUser,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, facilities, knowledgeCategories, knowledgeConfirmations, knowledgeEntries, knowledgeStarterSeeds, users } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { safeFileNamePart } from '../lib/fileName'
import { checkedDocumentFile } from '../lib/fileSignature'
import { loadEmployees } from './queries'
import { terminalStatus, verifyEmployeePin } from './terminal'

/**
 * „Wissen“ (Dokumente → Wissen): PDFs, links and short formatted texts in categories of the facility's own, each with a
 * visibility like the print template categories (all / Leitung and Träger / Träger only; the tablet and Mitarbeiter
 * accounts see only „alle“). Every account reads (knowledge.view, a baseline key) and so does the facility's tablet;
 * knowledge.manage (Leitung and Träger by default) maintains the facility's entries and categories and sees who
 * confirmed; knowledge.global (Träger) also entries for all facilities (`facilityId` null, filed by category name, shown
 * in each facility's category of that name or under „Vom Träger“). Another facility's entry or category is 404.
 *
 * „Gelesen und verstanden“ is the person's: at the tablet the employee who enters the PIN, with an own account the
 * linked employee. A change of an entry's content (file, link, text) counts its version up and asks again.
 */
export type KnowledgeViewer = Pick<SessionUser, 'role' | 'permissions' | 'employeeId'> & { facilityId: number }
export type KnowledgeActor = Pick<SessionUser, 'id' | 'role' | 'permissions' | 'employeeId'> & { facilityId: number }

type CategoryRow = typeof knowledgeCategories.$inferSelect
type EntryRow = Omit<typeof knowledgeEntries.$inferSelect, 'fileData'>

/** Maintains the facility's entries and categories (and sees the confirmations). */
const manages = (viewer: Pick<SessionUser, 'permissions'>) => can(viewer.permissions, 'knowledge.manage')

function assertManager(actor: Pick<SessionUser, 'permissions'>): void {
  if (!manages(actor)) throw new ServiceError(403, 'forbidden')
}

// ---- categories ------------------------------------------------------------

/** The facility's categories, each category followed by its subcategories, in their order (ties by id). */
export const facilityKnowledgeCategories = (db: Db, facilityId: number): CategoryRow[] =>
  categoriesInTreeOrder(db.select().from(knowledgeCategories).where(eq(knowledgeCategories.facilityId, facilityId))
    .orderBy(asc(knowledgeCategories.sortOrder), asc(knowledgeCategories.id)).all())

/** The trimmed category name (at most 60 characters); an empty one is 400 knowledge_category_name_required. */
function checkedCategoryName(name: string): string {
  const trimmed = name.trim()
  if (trimmed === '') throw new ServiceError(400, 'knowledge_category_name_required')
  return trimmed.slice(0, KNOWLEDGE_LIMITS.categoryName)
}

/**
 * The checked name (unique regardless of case among its siblings – the facility's categories, or the subcategories of
 * the same category –, 409 knowledge_category_name_taken) and a visibility the actor sees (403 otherwise: a Leitung
 * cannot make a category the Träger's alone).
 */
function checkedCategoryInput(
  actor: KnowledgeActor, all: readonly CategoryRow[], input: KnowledgeCategoryInput, parentId: number | null, current: CategoryRow | null,
): { name: string; visibility: TemplateVisibility } {
  const name = checkedCategoryName(input.name)
  if (!visibleTemplateLevels(actor.role).includes(input.visibility)) throw new ServiceError(403, 'forbidden')
  const clash = all.some(row => row.id !== current?.id && row.parentId === parentId
    && comparableKnowledgeName(row.name) === comparableKnowledgeName(name))
  if (clash) throw new ServiceError(409, 'knowledge_category_name_taken')
  return { name, visibility: input.visibility }
}

/**
 * A category or subcategory of the actor's facility they see (a subcategory with its category; else 404
 * knowledge_category_not_found), for knowledge.manage (else 403); with all the facility's categories.
 */
function loadCategory(db: Db, actor: KnowledgeActor, id: number): { row: CategoryRow; all: CategoryRow[] } {
  assertManager(actor)
  const all = facilityKnowledgeCategories(db, actor.facilityId)
  const row = all.find(category => category.id === id)
  if (!row || !seesCategoryNode(actor.role, row, all)) throw new ServiceError(404, 'knowledge_category_not_found')
  return { row, all }
}

/**
 * A new category at the end of the facility's list, or with `parentId` a new subcategory at the end of that category's
 * (a category of the facility the actor sees, not itself a subcategory: else 400 knowledge_category_parent_invalid);
 * returns its id.
 */
export function createKnowledgeCategory(db: Db, actor: KnowledgeActor, input: KnowledgeCategoryInput): number {
  assertManager(actor)
  const all = facilityKnowledgeCategories(db, actor.facilityId)
  const parentId = input.parentId ?? null
  if (parentId !== null) {
    const parent = all.find(row => row.id === parentId)
    if (!parent || parent.parentId !== null || !seesCategoryNode(actor.role, parent, all)) {
      throw new ServiceError(400, 'knowledge_category_parent_invalid')
    }
  }
  const values = checkedCategoryInput(actor, all, input, parentId, null)
  const last = all.filter(row => row.parentId === parentId).at(-1)
  return db.insert(knowledgeCategories).values({ ...values, facilityId: actor.facilityId, parentId, sortOrder: last ? last.sortOrder + 1 : 0 })
    .returning({ id: knowledgeCategories.id }).get().id
}

/** Renames the category and changes who sees it (and its entries); where it sits (category or subcategory) stays. */
export function updateKnowledgeCategory(db: Db, actor: KnowledgeActor, id: number, input: KnowledgeCategoryInput): void {
  const { row, all } = loadCategory(db, actor, id)
  db.update(knowledgeCategories).set(checkedCategoryInput(actor, all, input, row.parentId, row)).where(eq(knowledgeCategories.id, id)).run()
}

/**
 * Swaps the category with its neighbour among its siblings the actor sees (the facility's categories, or the
 * subcategories of the same category; the Leitung's list skips the Träger's hidden ones); at an end nothing changes.
 * The siblings are numbered afresh.
 */
export function moveKnowledgeCategory(db: Db, actor: KnowledgeActor, id: number, direction: 'up' | 'down'): void {
  const { row, all } = loadCategory(db, actor, id)
  const siblings = all.filter(other => other.parentId === row.parentId)
  const swapped = swappedSiblings(siblings, siblings.filter(other => seesCategoryNode(actor.role, other, all)), id, direction)
  if (!swapped) return
  db.transaction((tx) => {
    swapped.forEach((sibling, index) => {
      if (sibling.sortOrder !== index) tx.update(knowledgeCategories).set({ sortOrder: index }).where(eq(knowledgeCategories.id, sibling.id)).run()
    })
  })
}

/**
 * Deletes an empty category: one with subcategories is 409 knowledge_category_has_subcategories, one holding entries of
 * the facility 409 knowledge_category_not_empty. Entries for all facilities filed under its name do not count: they move
 * to „Vom Träger“ (from a subcategory: directly into its category).
 */
export function deleteKnowledgeCategory(db: Db, actor: KnowledgeActor, id: number): void {
  const { all } = loadCategory(db, actor, id)
  if (all.some(row => row.parentId === id)) throw new ServiceError(409, 'knowledge_category_has_subcategories')
  const used = db.select({ id: knowledgeEntries.id }).from(knowledgeEntries).where(eq(knowledgeEntries.categoryId, id)).limit(1).get()
  if (used) throw new ServiceError(409, 'knowledge_category_not_empty')
  db.delete(knowledgeCategories).where(eq(knowledgeCategories.id, id)).run()
}

/**
 * The category names to offer the Träger for an entry for all facilities (knowledge.global, else 403): every name a
 * facility uses or such an entry carries, once regardless of case, alphabetical, each with the subcategory names under it.
 */
export function globalKnowledgeCategoryNames(db: Db, actor: Pick<SessionUser, 'permissions'>): CategoryNameDto[] {
  if (!can(actor.permissions, 'knowledge.global')) throw new ServiceError(403, 'forbidden')
  const rows = db.select({ id: knowledgeCategories.id, parentId: knowledgeCategories.parentId, name: knowledgeCategories.name })
    .from(knowledgeCategories)
    .orderBy(asc(knowledgeCategories.facilityId), asc(knowledgeCategories.sortOrder), asc(knowledgeCategories.id)).all()
  const names = new Map(rows.map(row => [row.id, row.name]))
  const filed = db.select({ name: knowledgeEntries.categoryName, subcategoryName: knowledgeEntries.subcategoryName }).from(knowledgeEntries)
    .where(and(isNull(knowledgeEntries.facilityId), isNotNull(knowledgeEntries.categoryName))).all()
  return categoryNameList(rows.map(row => ({ name: row.name, parentName: row.parentId === null ? null : names.get(row.parentId) ?? null })), filed)
}

// ---- placing ---------------------------------------------------------------

/** Every column but the file itself (lists never read the PDFs). */
const ENTRY_COLUMNS = {
  id: knowledgeEntries.id, facilityId: knowledgeEntries.facilityId, categoryId: knowledgeEntries.categoryId,
  categoryName: knowledgeEntries.categoryName, subcategoryName: knowledgeEntries.subcategoryName, visibility: knowledgeEntries.visibility,
  kind: knowledgeEntries.kind, title: knowledgeEntries.title, description: knowledgeEntries.description, asOf: knowledgeEntries.asOf,
  fileMime: knowledgeEntries.fileMime, fileSize: knowledgeEntries.fileSize, url: knowledgeEntries.url, body: knowledgeEntries.body,
  needsConfirmation: knowledgeEntries.needsConfirmation, version: knowledgeEntries.version, versionAt: knowledgeEntries.versionAt, sortOrder: knowledgeEntries.sortOrder,
  starterKey: knowledgeEntries.starterKey, createdAt: knowledgeEntries.createdAt, createdBy: knowledgeEntries.createdBy,
  updatedAt: knowledgeEntries.updatedAt, updatedBy: knowledgeEntries.updatedBy,
}

/** The facility's own entries and those for all facilities. */
const ofFacility = (facilityId: number) => or(eq(knowledgeEntries.facilityId, facilityId), isNull(knowledgeEntries.facilityId))

/**
 * Where an entry shows in the facility: its category and subcategory there (category null = „Vom Träger“), the name to
 * show („Kategorie › Unterkategorie“; for „Vom Träger“ the names the Träger chose) and the visibilities that apply.
 */
interface Placement { spot: CategorySpot<CategoryRow>; name: string; subName: string; visibility: TemplateVisibility[] }

/**
 * Places the entries in the facility's categories: a facility's own entry in its category or subcategory; an entry for
 * all facilities in the facility's category of the same name (regardless of case) – there in its subcategory of the
 * subcategory name, else directly in the category –, otherwise under „Vom Träger“. The visibilities that apply: the
 * category's and the subcategory's, for an entry for all facilities its own as well (the strictest one wins).
 */
function placer(categories: readonly CategoryRow[]):
(row: Pick<EntryRow, 'facilityId' | 'categoryId' | 'categoryName' | 'subcategoryName' | 'visibility'>) => Placement | null {
  const place = categoryPlacer(categories)
  return (row) => {
    const own = row.facilityId !== null
    const spot = own ? place.byId(row.categoryId) : place.byName(row.categoryName, row.subcategoryName)
    if (!spot) return null
    const name = spot.category?.name ?? row.categoryName ?? ''
    const subName = spot.subcategory?.name ?? (spot.category ? '' : row.subcategoryName ?? '')
    return { spot, name, subName, visibility: [...spotVisibilities(spot), ...(own ? [] : [row.visibility])] }
  }
}

/** Whether someone of the role sees an entry placed so. */
const seesPlacement = (role: Role, placement: Placement | null) => placement !== null && seesAll(role, placement.visibility)

/** An entry for all facilities is the Träger's (knowledge.global); a facility's own needs knowledge.manage. */
const mayEdit = (viewer: Pick<SessionUser, 'permissions'>, row: Pick<EntryRow, 'facilityId'>) =>
  row.facilityId === null ? can(viewer.permissions, 'knowledge.global') : manages(viewer)

type Placed = { row: EntryRow; placement: Placement }

/**
 * By category (in the facility's order, „Vom Träger“ last; within a category the entries directly in it first, then by
 * subcategory), the facility's own entries first (▲/▼), then by title.
 */
function compareEntries(a: Placed, b: Placed): number {
  const own = (entry: Placed) => (entry.row.facilityId === null ? 1 : 0)
  return compareSpots(a.placement.spot, b.placement.spot)
    || (a.placement.spot.category === null
      ? a.placement.name.localeCompare(b.placement.name, 'de') || a.placement.subName.localeCompare(b.placement.subName, 'de')
      : 0)
    || own(a) - own(b) || (own(a) === 0 ? a.row.sortOrder - b.row.sortOrder : 0)
    || a.row.title.localeCompare(b.row.title, 'de') || a.row.id - b.row.id
}

/** The entries of the facility the viewer sees, placed and in order. */
function visibleEntries(db: Db, viewer: Pick<KnowledgeViewer, 'role' | 'facilityId'>, categories: readonly CategoryRow[]): Placed[] {
  const place = placer(categories)
  return db.select(ENTRY_COLUMNS).from(knowledgeEntries).where(ofFacility(viewer.facilityId)).all()
    .map(row => ({ row, placement: place(row) }))
    .filter((entry): entry is Placed => seesPlacement(viewer.role, entry.placement))
    .sort(compareEntries)
}

/** The person who confirms with this account: its linked employee (null without one, and at the tablet). */
const accountPerson = (viewer: Pick<KnowledgeViewer, 'role' | 'employeeId'>) => (viewer.role === 'terminal' ? null : viewer.employeeId)

/**
 * „Wissen“ of the viewer's facility: the categories the viewer sees in their order (with the entries they see in them)
 * and those entries, by category, „Vom Träger“ last. With an own account linked to an employee each entry carries that
 * person's confirmation, and `openCount` how many still ask for it.
 */
export function listKnowledge(db: Db, viewer: KnowledgeViewer): KnowledgeDto {
  const all = facilityKnowledgeCategories(db, viewer.facilityId)
  const categories = all.filter(row => seesCategoryNode(viewer.role, row, all))
  const entries = visibleEntries(db, viewer, all)
  const person = accountPerson(viewer)
  const confirmations = new Map(person === null || entries.length === 0 ? [] : db.select().from(knowledgeConfirmations)
    .where(and(eq(knowledgeConfirmations.employeeId, person), inArray(knowledgeConfirmations.entryId, entries.map(entry => entry.row.id))))
    .all().map(row => [row.entryId, row]))
  // Counted where each entry shows directly: in its subcategory, else in its category.
  const counts = new Map<number, number>()
  const owns = new Map<number, number>()
  for (const { row, placement } of entries) {
    const shownIn = placement.spot.subcategory ?? placement.spot.category
    if (!shownIn) continue
    counts.set(shownIn.id, (counts.get(shownIn.id) ?? 0) + 1)
    if (row.facilityId !== null) owns.set(shownIn.id, (owns.get(shownIn.id) ?? 0) + 1)
  }
  const dtos = entries.map(({ row, placement }): KnowledgeEntryDto => {
    const confirmation = confirmations.get(row.id)
    return {
      id: row.id,
      categoryId: placement.spot.category?.id ?? null,
      subcategoryId: placement.spot.subcategory?.id ?? null,
      global: row.facilityId === null,
      globalCategoryName: row.facilityId === null ? row.categoryName ?? '' : null,
      globalSubcategoryName: row.facilityId === null ? row.subcategoryName ?? '' : null,
      globalVisibility: row.facilityId === null ? row.visibility : null,
      kind: row.kind,
      title: row.title,
      description: row.description,
      asOf: row.asOf,
      url: row.kind === 'link' ? row.url : '',
      body: row.kind === 'text' ? row.body : '',
      fileSize: row.kind === 'file' ? row.fileSize : null,
      needsConfirmation: row.needsConfirmation,
      version: row.version,
      versionAt: row.versionAt,
      updatedAt: row.updatedAt,
      myConfirmation: person === null ? null : {
        state: confirmState(row.needsConfirmation, row.version, confirmation),
        confirmedAt: confirmation?.confirmedAt ?? null,
      },
      canEdit: mayEdit(viewer, row),
    }
  })
  return {
    categories: categories.map((category): KnowledgeCategoryDto => ({
      id: category.id, parentId: category.parentId, name: category.name, visibility: category.visibility,
      entryCount: counts.get(category.id) ?? 0, ownCount: owns.get(category.id) ?? 0,
      hiddenSubcategories: all.filter(child => child.parentId === category.id && !seesCategoryNode(viewer.role, child, all)).length,
    })),
    entries: dtos,
    canManage: manages(viewer),
    canManageGlobal: can(viewer.permissions, 'knowledge.global'),
    confirmVia: viewer.role === 'terminal' ? 'tablet' : person === null ? null : 'account',
    openCount: dtos.filter(entry => entry.myConfirmation?.state === 'open' || entry.myConfirmation?.state === 'outdated').length,
  }
}

/** How many entries the viewer's linked employee still has to confirm (never, or only an earlier version); 0 without one. */
export function openKnowledgeCount(db: Db, viewer: KnowledgeViewer): number {
  return accountPerson(viewer) === null ? 0 : listKnowledge(db, viewer).openCount
}

/** An entry of the viewer's facility or for all facilities that the viewer sees (else 404 knowledge_entry_not_found). */
function loadVisible(db: Db, viewer: Pick<KnowledgeViewer, 'role' | 'facilityId'>, id: number): { row: EntryRow; placement: Placement } {
  const row = db.select(ENTRY_COLUMNS).from(knowledgeEntries).where(and(eq(knowledgeEntries.id, id), ofFacility(viewer.facilityId))).get()
  const placement = row ? placer(facilityKnowledgeCategories(db, viewer.facilityId))(row) : null
  if (!row || !seesPlacement(viewer.role, placement)) throw new ServiceError(404, 'knowledge_entry_not_found')
  return { row, placement: placement! }
}

/** The PDF of a file entry the viewer sees, named after its title (404 knowledge_entry_not_found otherwise). */
export function readKnowledgeFile(db: Db, viewer: KnowledgeViewer, id: number): { data: Buffer; mimeType: string; fileName: string } {
  const { row } = loadVisible(db, viewer, id)
  const file = row.kind === 'file' ? db.select({ data: knowledgeEntries.fileData }).from(knowledgeEntries).where(eq(knowledgeEntries.id, id)).get() : undefined
  if (!file?.data) throw new ServiceError(404, 'knowledge_entry_not_found')
  return { data: file.data, mimeType: row.fileMime ?? 'application/pdf', fileName: `${safeFileNamePart(row.title) || 'Wissen'}.pdf` }
}

// ---- entries ---------------------------------------------------------------

/** The PDF of a file entry: at most 10 MB (413 document_too_large) and a PDF by its first bytes (400 knowledge_file_type_invalid). */
const checkedPdf = (data: Buffer) => checkedDocumentFile(data, ['application/pdf'], 'knowledge_file_type_invalid')

/**
 * The formatted text of a text entry, sanitized like the free-text answers of the Bögen: huge input is refused before
 * parsing, then the text and the HTML are limited (400 knowledge_body_too_long); plain text becomes paragraphs. Empty is
 * 400 knowledge_body_required.
 */
function checkedBody(body: string): string {
  if (body.length > FORM_LIMITS.textAnswerHtml) throw new ServiceError(400, 'knowledge_body_too_long')
  const html = isRichText(body) ? sanitizeRichText(body) : plainTextToRichText(body.trim())
  if (html === '' || richTextLength(html) === 0) throw new ServiceError(400, 'knowledge_body_required')
  if (html.length > FORM_LIMITS.textAnswerHtml || richTextLength(html) > FORM_LIMITS.textAnswer) {
    throw new ServiceError(400, 'knowledge_body_too_long')
  }
  return html
}

/** The checked fields of an entry, without the file (title 1–120, description ≤ 500, „Stand vom“, link or text). */
function checkedFields(input: KnowledgeEntryInput) {
  const title = input.title.trim()
  if (title === '') throw new ServiceError(400, 'knowledge_title_required')
  if (title.length > KNOWLEDGE_LIMITS.title) throw new ServiceError(400, 'knowledge_title_too_long')
  const description = input.description.trim()
  if (description.length > KNOWLEDGE_LIMITS.description) throw new ServiceError(400, 'knowledge_description_too_long')
  const asOf = checkedAsOf(input.asOf)
  if (asOf === undefined) throw new ServiceError(400, 'knowledge_as_of_invalid')
  let url = ''
  if (input.kind === 'link') {
    const checked = checkedKnowledgeUrl(input.url)
    if (checked === null) throw new ServiceError(400, 'knowledge_url_invalid')
    url = checked
  }
  const body = input.kind === 'text' ? checkedBody(input.body) : ''
  return { kind: input.kind, title, description, asOf, url, body, needsConfirmation: input.needsConfirmation }
}

/**
 * The category or subcategory of a facility's entry as the actor chooses it: one of the facility they see (a
 * subcategory with its category), else 400 knowledge_category_invalid.
 */
function chosenCategory(db: Db, actor: KnowledgeActor, id: number | undefined): number {
  const all = id === undefined ? [] : facilityKnowledgeCategories(db, actor.facilityId)
  const row = all.find(category => category.id === id)
  if (!row || !seesCategoryNode(actor.role, row, all)) throw new ServiceError(400, 'knowledge_category_invalid')
  return row.id
}

/**
 * Where the entry is filed: a category or subcategory of the facility, or for all facilities a category name, a
 * subcategory name (none: directly in the category) and its visibility.
 */
function filing(db: Db, actor: KnowledgeActor, global: boolean, input: KnowledgeEntryInput, current?: TemplateVisibility) {
  if (!global) {
    return { categoryId: chosenCategory(db, actor, input.categoryId), categoryName: null, subcategoryName: null, visibility: 'all' as const }
  }
  const visibility = input.visibility ?? current ?? 'all'
  if (!visibleTemplateLevels(actor.role).includes(visibility)) throw new ServiceError(403, 'forbidden')
  const subcategoryName = (input.subcategoryName ?? '').trim() === '' ? null : checkedCategoryName(input.subcategoryName!)
  return { categoryId: null, categoryName: checkedCategoryName(input.categoryName ?? ''), subcategoryName, visibility }
}

/** The file columns of a file entry (a new PDF), or none for a link or text. */
function fileColumns(kind: KnowledgeEntryInput['kind'], file: { data: Buffer } | null) {
  if (kind !== 'file') return { fileData: null, fileMime: null, fileSize: null }
  if (!file) throw new ServiceError(400, 'file_required')
  return { fileData: file.data, fileMime: checkedPdf(file.data), fileSize: file.data.length }
}

/** The next place at the end of the facility's own entries in the category or subcategory (not counting its subcategories). */
function nextSortOrder(db: Db, categoryId: number | null): number {
  if (categoryId === null) return 0
  const rows = db.select({ sortOrder: knowledgeEntries.sortOrder }).from(knowledgeEntries).where(eq(knowledgeEntries.categoryId, categoryId)).all()
  return rows.reduce((max, row) => Math.max(max, row.sortOrder + 1), 0)
}

/**
 * A new entry of the actor's facility (knowledge.manage), or for all facilities (scope 'all', knowledge.global); a file
 * entry needs its PDF. Returns its id.
 */
export function createKnowledgeEntry(
  db: Db, actor: KnowledgeActor, input: KnowledgeEntryInput, file: { data: Buffer } | null, now: Date = new Date(),
): number {
  assertManager(actor)
  const global = input.scope === 'all'
  if (global && !can(actor.permissions, 'knowledge.global')) throw new ServiceError(403, 'forbidden')
  const fields = checkedFields(input)
  const filed = filing(db, actor, global, input)
  const files = fileColumns(input.kind, file)
  const at = now.toISOString()
  return db.insert(knowledgeEntries).values({
    ...fields, ...filed, ...files, facilityId: global ? null : actor.facilityId, sortOrder: nextSortOrder(db, filed.categoryId),
    version: 1, versionAt: at, createdAt: at, createdBy: actor.id, updatedAt: at, updatedBy: actor.id,
  }).returning({ id: knowledgeEntries.id }).get().id
}

/** An entry the actor sees (else 404 knowledge_entry_not_found) and may change (else 403). */
function loadEditable(db: Db, actor: KnowledgeActor, id: number): EntryRow {
  assertManager(actor)
  const { row } = loadVisible(db, actor, id)
  if (!mayEdit(actor, row)) throw new ServiceError(403, 'forbidden')
  return row
}

/**
 * Changes the entry; where it is kept (the facility or all facilities) stays. A new PDF replaces the file (a file entry
 * keeps its PDF without one). A change of the content – another kind, a new file, another link or text – counts the
 * version up, so whoever confirmed an earlier version is asked again; title, description, „Stand vom“ and the category
 * do not. Filed in another category or subcategory, the facility's entry goes to the end there.
 */
export function updateKnowledgeEntry(
  db: Db, actor: KnowledgeActor, id: number, input: KnowledgeEntryInput, file: { data: Buffer } | null, now: Date = new Date(),
): void {
  const row = loadEditable(db, actor, id)
  const fields = checkedFields(input)
  const filed = filing(db, actor, row.facilityId === null, input, row.visibility)
  const keepsFile = input.kind === 'file' && row.kind === 'file' && file === null
  const files = keepsFile ? {} : fileColumns(input.kind, file)
  const changed = fields.kind !== row.kind || file !== null || fields.url !== row.url || fields.body !== row.body
  const moved = filed.categoryId !== row.categoryId
  db.update(knowledgeEntries).set({
    ...fields, ...filed, ...files,
    ...(moved ? { sortOrder: nextSortOrder(db, filed.categoryId) } : {}),
    ...(changed ? { version: row.version + 1, versionAt: now.toISOString() } : {}),
    updatedAt: now.toISOString(), updatedBy: actor.id,
  }).where(eq(knowledgeEntries.id, id)).run()
}

/** Deletes the entry with its confirmations. */
export function deleteKnowledgeEntry(db: Db, actor: KnowledgeActor, id: number): void {
  loadEditable(db, actor, id)
  db.delete(knowledgeEntries).where(eq(knowledgeEntries.id, id)).run()
}

/**
 * ▲/▼: swaps a facility's own entry with its neighbour among the facility's own entries of the same category or
 * subcategory (the Träger's entries for all facilities follow them, by title); at an end nothing changes. Its own entries
 * are numbered afresh.
 */
export function moveKnowledgeEntry(db: Db, actor: KnowledgeActor, id: number, direction: 'up' | 'down'): void {
  const row = loadEditable(db, actor, id)
  if (row.facilityId === null || row.categoryId === null) throw new ServiceError(400, 'knowledge_entry_not_movable')
  const own = db.select({ id: knowledgeEntries.id, sortOrder: knowledgeEntries.sortOrder, title: knowledgeEntries.title })
    .from(knowledgeEntries).where(eq(knowledgeEntries.categoryId, row.categoryId)).all()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'de') || a.id - b.id)
  const at = own.findIndex(entry => entry.id === id)
  const other = direction === 'up' ? at - 1 : at + 1
  if (other < 0 || other >= own.length) return
  const swapped = [...own]
  swapped[at] = own[other]!
  swapped[other] = own[at]!
  db.transaction((tx) => {
    swapped.forEach((entry, index) => {
      if (entry.sortOrder !== index) tx.update(knowledgeEntries).set({ sortOrder: index }).where(eq(knowledgeEntries.id, entry.id)).run()
    })
  })
}

// ---- „Gelesen und verstanden“ ----------------------------------------------

/**
 * The entry asks for a confirmation (409 knowledge_confirmation_not_needed otherwise) of the very version the reader was
 * shown: one changed since (a new file, link or text) is 409 knowledge_entry_changed, so nobody confirms a version they
 * never saw.
 */
function assertConfirmable(row: EntryRow, shownVersion: number): void {
  if (!row.needsConfirmation) throw new ServiceError(409, 'knowledge_confirmation_not_needed')
  if (shownVersion !== row.version) throw new ServiceError(409, 'knowledge_entry_changed')
}

/** Records the person's confirmation of the entry's current version (an earlier one is replaced). */
function recordConfirmation(db: Db, row: EntryRow, employeeId: number, via: 'tablet' | 'account', now: Date): KnowledgeConfirmResultDto {
  const confirmedAt = now.toISOString()
  const values = { entryVersion: row.version, confirmedAt, via }
  db.insert(knowledgeConfirmations).values({ entryId: row.id, employeeId, ...values })
    .onConflictDoUpdate({ target: [knowledgeConfirmations.entryId, knowledgeConfirmations.employeeId], set: values }).run()
  const name = db.select({ name: employees.name }).from(employees).where(eq(employees.id, employeeId)).get()?.name ?? ''
  return { name, confirmedAt, version: row.version }
}

/**
 * „Gelesen und verstanden“ with the own account: for its linked employee (403 knowledge_no_employee without one), of an
 * entry the viewer sees that asks for it, in the version the viewer was shown (see assertConfirmable).
 */
export function confirmWithAccount(
  db: Db, viewer: KnowledgeViewer, id: number, shownVersion: number, now: Date = new Date(),
): KnowledgeConfirmResultDto {
  const person = accountPerson(viewer)
  if (person === null) throw new ServiceError(403, 'knowledge_no_employee')
  const { row } = loadVisible(db, viewer, id)
  assertConfirmable(row, shownVersion)
  return recordConfirmation(db, row, person, 'account', now)
}

/**
 * „Gelesen und verstanden“ at the facility's tablet: a person of its list (404 employee_not_found otherwise, without
 * counting a PIN attempt) confirms for themselves with their PIN (the same attempts and lock as stamping), an entry the
 * tablet shows (visible to all), in the version the tablet showed. Everything but the PIN is checked first, so a stale
 * page or another person never costs a PIN attempt.
 */
export function confirmAtTablet(
  db: Db, terminal: { facilityId: number }, id: number, shownVersion: number, employeeId: number, pin: string, now: Date = new Date(),
): KnowledgeConfirmResultDto {
  const { row } = loadVisible(db, { role: 'terminal', facilityId: terminal.facilityId }, id)
  assertConfirmable(row, shownVersion)
  if (!terminalStatus(db, terminal.facilityId, now).some(person => person.employeeId === employeeId)) {
    throw new ServiceError(404, 'employee_not_found')
  }
  verifyEmployeePin(db, employeeId, pin, now)
  return recordConfirmation(db, row, employeeId, 'tablet', now)
}

/**
 * „Gelesen und verstanden“ as the route receives it: the facility's tablet names the person and their PIN
 * (confirmAtTablet; 400 invalid_input without them), an own account confirms for its linked employee (confirmWithAccount).
 */
export function confirmKnowledge(
  db: Db, reader: KnowledgeViewer, id: number, input: { version: number; employeeId?: number; pin?: string }, now: Date = new Date(),
): KnowledgeConfirmResultDto {
  // An account always confirms for its own linked employee: a person or PIN it sends is ignored.
  if (reader.role !== 'terminal') return confirmWithAccount(db, reader, id, input.version, now)
  if (input.employeeId === undefined || input.pin === undefined) throw new ServiceError(400, 'invalid_input')
  return confirmAtTablet(db, reader, id, input.version, input.employeeId, input.pin, now)
}

const STATE_ORDER: Record<KnowledgeConfirmState, number> = { open: 0, outdated: 1, confirmed: 2, none: 3 }

/**
 * Who of the facility confirmed the entry and who not yet (knowledge.manage; an entry the actor sees in the facility,
 * else 404): every employee of the facility employed today who sees it (by the role of their active account, the
 * Mitarbeiter's without one: a category for Leitung and Träger counts only them), plus anyone who confirmed but left,
 * no longer sees it or is not on the staff: for the facility's own entry also helpers of other facilities who confirmed
 * it at this tablet (the facility plans them); for an entry for all facilities only the facility's own employees, so no
 * other facility's names show.
 */
export function confirmationOverview(db: Db, actor: KnowledgeActor, id: number, today: IsoDate = todayIso()): KnowledgeConfirmationsDto {
  assertManager(actor)
  const { row, placement } = loadVisible(db, actor, id)
  const staff = loadEmployees(db, actor.facilityId).filter(employee => isEmployedOn(employee.info, today))
  const ids = staff.map(employee => employee.id)
  const roles = new Map(ids.length === 0 ? [] : db.select({ employeeId: users.employeeId, role: users.role }).from(users)
    .where(and(inArray(users.employeeId, ids), eq(users.active, true))).all().map(user => [user.employeeId!, user.role]))
  const confirmations = db.select({
    employeeId: knowledgeConfirmations.employeeId, entryVersion: knowledgeConfirmations.entryVersion,
    confirmedAt: knowledgeConfirmations.confirmedAt, via: knowledgeConfirmations.via, name: employees.name,
  }).from(knowledgeConfirmations).innerJoin(employees, eq(employees.id, knowledgeConfirmations.employeeId))
    .where(row.facilityId === null
      ? and(eq(knowledgeConfirmations.entryId, id), eq(employees.facilityId, actor.facilityId))
      : eq(knowledgeConfirmations.entryId, id)).all()
  const byEmployee = new Map(confirmations.map(confirmation => [confirmation.employeeId, confirmation]))
  const expected = staff.filter(employee => seesPlacement(roles.get(employee.id) ?? 'observer', placement))
  const expectedIds = new Set(expected.map(employee => employee.id))
  const people: KnowledgeConfirmationRowDto[] = [
    ...expected.map(employee => ({ employeeId: employee.id, name: employee.name })),
    ...confirmations.filter(confirmation => !expectedIds.has(confirmation.employeeId))
      .map(confirmation => ({ employeeId: confirmation.employeeId, name: confirmation.name })),
  ].map(({ employeeId, name }) => {
    const confirmation = byEmployee.get(employeeId)
    return {
      employeeId,
      name,
      state: confirmState(true, row.version, confirmation),
      confirmedAt: confirmation?.confirmedAt ?? null,
      via: confirmation?.via ?? null,
      expected: expectedIds.has(employeeId),
    }
  }).sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.name.localeCompare(b.name, 'de') || a.employeeId - b.employeeId)
  const facility = db.select({ name: facilities.name }).from(facilities).where(eq(facilities.id, actor.facilityId)).get()
  return {
    entry: {
      id: row.id, title: row.title, kind: row.kind, needsConfirmation: row.needsConfirmation, version: row.version,
      updatedAt: row.updatedAt, versionAt: row.versionAt, asOf: row.asOf, category: categoryPath(placement.name, placement.subName),
    },
    facilityName: facility?.name ?? '',
    people,
  }
}

// ---- starters --------------------------------------------------------------

/** The starter keys the facility has been given (knowledge_starter_seeds). */
function seededKeys(db: Db, facilityId: number): Set<string> {
  return new Set(db.select({ key: knowledgeStarterSeeds.starterKey }).from(knowledgeStarterSeeds)
    .where(eq(knowledgeStarterSeeds.facilityId, facilityId)).all().map(row => row.key))
}

const STARTER_KEYS = [...KNOWLEDGE_STARTER_CATEGORIES, ...KNOWLEDGE_STARTER_SUBCATEGORIES, ...KNOWLEDGE_STARTER_LINKS].map(starter => starter.key)

/** The facility's category of that name (regardless of case), and with `subName` its subcategory of that name. */
function starterSpot(db: Db, facilityId: number, name: string, subName?: string): { category?: CategoryRow; subcategory?: CategoryRow } {
  const all = facilityKnowledgeCategories(db, facilityId)
  const category = all.find(row => row.parentId === null && comparableKnowledgeName(row.name) === comparableKnowledgeName(name))
  const subcategory = category && subName !== undefined
    ? all.find(row => row.parentId === category.id && comparableKnowledgeName(row.name) === comparableKnowledgeName(subName))
    : undefined
  return { category, subcategory }
}

/**
 * Gives the facility every starter category, subcategory and link (shared/domain/knowledge.ts) it has not been given yet
 * and records each as given, so a deleted or renamed one never comes back while a starter new in a later version still
 * arrives. A category (subcategory) of that name already there is only recorded; a subcategory whose category the
 * facility no longer has, or a link whose category it no longer has, or one for another state (Orientierungsplan,
 * KiTaG and the subcategory „Baden-Württemberg“: Baden-Württemberg), is recorded without being created. A link goes into
 * its starter subcategory when the facility has it, else directly into the category. Call it inside the caller's
 * transaction.
 */
export function seedKnowledgeStarters(db: Db, facilityId: number, now: Date = new Date()): void {
  const facility = db.select({ state: facilities.state }).from(facilities).where(eq(facilities.id, facilityId)).get()
  if (!facility) return
  const seeded = seededKeys(db, facilityId)
  const at = now.toISOString()
  const record = (starterKey: string) => db.insert(knowledgeStarterSeeds).values({ facilityId, starterKey, seededAt: at }).run()
  const inState = (states: readonly string[] | undefined) => !states || states.includes(facility.state)
  for (const starter of KNOWLEDGE_STARTER_CATEGORIES) {
    if (seeded.has(starter.key)) continue
    if (!starterSpot(db, facilityId, starter.name).category) {
      const last = facilityKnowledgeCategories(db, facilityId).filter(row => row.parentId === null).at(-1)
      db.insert(knowledgeCategories).values({ facilityId, name: starter.name, sortOrder: last ? last.sortOrder + 1 : 0, visibility: 'all' }).run()
    }
    record(starter.key)
  }
  for (const starter of KNOWLEDGE_STARTER_SUBCATEGORIES) {
    if (seeded.has(starter.key)) continue
    const { category, subcategory } = starterSpot(db, facilityId, starter.category, starter.name)
    if (category && !subcategory && inState(starter.states)) {
      const last = facilityKnowledgeCategories(db, facilityId).filter(row => row.parentId === category.id).at(-1)
      db.insert(knowledgeCategories).values({
        facilityId, parentId: category.id, name: starter.name, sortOrder: last ? last.sortOrder + 1 : 0, visibility: 'all',
      }).run()
    }
    record(starter.key)
  }
  for (const link of KNOWLEDGE_STARTER_LINKS) {
    if (seeded.has(link.key)) continue
    const { category, subcategory } = starterSpot(db, facilityId, link.category, link.subcategory)
    const target = subcategory ?? category
    if (target && inState(link.states)) {
      db.insert(knowledgeEntries).values({
        facilityId, categoryId: target.id, kind: 'link', title: link.title, description: link.description, url: link.url,
        starterKey: link.key, sortOrder: nextSortOrder(db, target.id), versionAt: at, createdAt: at, updatedAt: at,
      }).run()
    }
    record(link.key)
  }
}

/** Startup step: seeds the missing starters of every facility that lacks one; returns how many facilities. */
export function seedPendingKnowledgeStarters(db: Db, now: Date = new Date()): number {
  const pending = db.select({ id: facilities.id }).from(facilities).all()
    .filter((facility) => {
      const seeded = seededKeys(db, facility.id)
      return STARTER_KEYS.some(key => !seeded.has(key))
    })
  for (const facility of pending) db.transaction(tx => seedKnowledgeStarters(tx, facility.id, now))
  return pending.length
}
