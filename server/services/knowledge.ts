import { and, asc, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm'
import { todayIso } from '../../shared/domain/dates'
import { FORM_LIMITS } from '../../shared/domain/forms'
import {
  KNOWLEDGE_LIMITS, KNOWLEDGE_STARTER_CATEGORIES, KNOWLEDGE_STARTER_LINKS, checkedAsOf, checkedKnowledgeUrl, comparableKnowledgeName,
  confirmState, type KnowledgeConfirmState,
} from '../../shared/domain/knowledge'
import { can } from '../../shared/domain/permissions'
import { isRichText, plainTextToRichText, richTextLength, sanitizeRichText } from '../../shared/domain/richText'
import { isEmployedOn } from '../../shared/domain/targets'
import { seesTemplateCategory, visibleTemplateLevels, type TemplateVisibility } from '../../shared/domain/templateCategories'
import type { IsoDate } from '../../shared/domain/types'
import type {
  KnowledgeCategoryDto, KnowledgeCategoryInput, KnowledgeConfirmationRowDto, KnowledgeConfirmationsDto, KnowledgeConfirmResultDto,
  KnowledgeDto, KnowledgeEntryDto, KnowledgeEntryInput, Role, SessionUser,
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

/** The facility's categories in their order (ties by id). */
export const facilityKnowledgeCategories = (db: Db, facilityId: number): CategoryRow[] =>
  db.select().from(knowledgeCategories).where(eq(knowledgeCategories.facilityId, facilityId))
    .orderBy(asc(knowledgeCategories.sortOrder), asc(knowledgeCategories.id)).all()

/** The trimmed category name (at most 60 characters); an empty one is 400 knowledge_category_name_required. */
function checkedCategoryName(name: string): string {
  const trimmed = name.trim()
  if (trimmed === '') throw new ServiceError(400, 'knowledge_category_name_required')
  return trimmed.slice(0, KNOWLEDGE_LIMITS.categoryName)
}

/**
 * The checked name (unique regardless of case among all the facility's categories, 409 knowledge_category_name_taken)
 * and a visibility the actor sees (403 otherwise: a Leitung cannot make a category the Träger's alone).
 */
function checkedCategoryInput(
  db: Db, actor: KnowledgeActor, input: KnowledgeCategoryInput, current: CategoryRow | null,
): { name: string; visibility: TemplateVisibility } {
  const name = checkedCategoryName(input.name)
  if (!visibleTemplateLevels(actor.role).includes(input.visibility)) throw new ServiceError(403, 'forbidden')
  const clash = facilityKnowledgeCategories(db, actor.facilityId)
    .some(row => row.id !== current?.id && comparableKnowledgeName(row.name) === comparableKnowledgeName(name))
  if (clash) throw new ServiceError(409, 'knowledge_category_name_taken')
  return { name, visibility: input.visibility }
}

/** A category of the actor's facility they see (else 404 knowledge_category_not_found), for knowledge.manage (else 403). */
function loadCategory(db: Db, actor: KnowledgeActor, id: number): CategoryRow {
  assertManager(actor)
  const row = db.select().from(knowledgeCategories)
    .where(and(eq(knowledgeCategories.id, id), eq(knowledgeCategories.facilityId, actor.facilityId))).get()
  if (!row || !seesTemplateCategory(actor.role, row.visibility)) throw new ServiceError(404, 'knowledge_category_not_found')
  return row
}

/** A new category at the end of the facility's list; returns its id. */
export function createKnowledgeCategory(db: Db, actor: KnowledgeActor, input: KnowledgeCategoryInput): number {
  assertManager(actor)
  const values = checkedCategoryInput(db, actor, input, null)
  const last = facilityKnowledgeCategories(db, actor.facilityId).at(-1)
  return db.insert(knowledgeCategories).values({ ...values, facilityId: actor.facilityId, sortOrder: last ? last.sortOrder + 1 : 0 })
    .returning({ id: knowledgeCategories.id }).get().id
}

/** Renames the category and changes who sees it (and its entries). */
export function updateKnowledgeCategory(db: Db, actor: KnowledgeActor, id: number, input: KnowledgeCategoryInput): void {
  const current = loadCategory(db, actor, id)
  db.update(knowledgeCategories).set(checkedCategoryInput(db, actor, input, current)).where(eq(knowledgeCategories.id, id)).run()
}

/**
 * Swaps the category with its neighbour among those the actor sees (the Leitung's list skips the Träger's hidden ones);
 * at an end nothing changes. The facility's whole list is numbered afresh.
 */
export function moveKnowledgeCategory(db: Db, actor: KnowledgeActor, id: number, direction: 'up' | 'down'): void {
  loadCategory(db, actor, id)
  const all = facilityKnowledgeCategories(db, actor.facilityId)
  const visible = all.filter(row => seesTemplateCategory(actor.role, row.visibility))
  const at = visible.findIndex(row => row.id === id)
  const self = visible[at]!
  const neighbour = visible[direction === 'up' ? at - 1 : at + 1]
  if (!neighbour) return
  const swapped = all.map(row => (row.id === self.id ? neighbour : row.id === neighbour.id ? self : row))
  db.transaction((tx) => {
    swapped.forEach((row, index) => {
      if (row.sortOrder !== index) tx.update(knowledgeCategories).set({ sortOrder: index }).where(eq(knowledgeCategories.id, row.id)).run()
    })
  })
}

/**
 * Deletes an empty category; one holding entries of the facility is 409 knowledge_category_not_empty. Entries for all
 * facilities filed under its name do not count: they move to „Vom Träger“.
 */
export function deleteKnowledgeCategory(db: Db, actor: KnowledgeActor, id: number): void {
  loadCategory(db, actor, id)
  const used = db.select({ id: knowledgeEntries.id }).from(knowledgeEntries).where(eq(knowledgeEntries.categoryId, id)).limit(1).get()
  if (used) throw new ServiceError(409, 'knowledge_category_not_empty')
  db.delete(knowledgeCategories).where(eq(knowledgeCategories.id, id)).run()
}

/**
 * The category names to offer the Träger for an entry for all facilities (knowledge.global, else 403): every name a
 * facility uses or such an entry carries, once regardless of case, alphabetical.
 */
export function globalKnowledgeCategoryNames(db: Db, actor: Pick<SessionUser, 'permissions'>): string[] {
  if (!can(actor.permissions, 'knowledge.global')) throw new ServiceError(403, 'forbidden')
  const names = [
    ...db.select({ name: knowledgeCategories.name }).from(knowledgeCategories)
      .orderBy(asc(knowledgeCategories.facilityId), asc(knowledgeCategories.sortOrder), asc(knowledgeCategories.id)).all().map(row => row.name),
    ...db.select({ name: knowledgeEntries.categoryName }).from(knowledgeEntries).where(isNotNull(knowledgeEntries.categoryName)).all()
      .map(row => row.name ?? ''),
  ]
  const byName = new Map<string, string>()
  for (const name of names) {
    const key = comparableKnowledgeName(name)
    if (key !== '' && !byName.has(key)) byName.set(key, name.trim())
  }
  return [...byName.values()].sort((a, b) => a.localeCompare(b, 'de'))
}

// ---- placing ---------------------------------------------------------------

/** Every column but the file itself (lists never read the PDFs). */
const ENTRY_COLUMNS = {
  id: knowledgeEntries.id, facilityId: knowledgeEntries.facilityId, categoryId: knowledgeEntries.categoryId,
  categoryName: knowledgeEntries.categoryName, visibility: knowledgeEntries.visibility, kind: knowledgeEntries.kind,
  title: knowledgeEntries.title, description: knowledgeEntries.description, asOf: knowledgeEntries.asOf,
  fileMime: knowledgeEntries.fileMime, fileSize: knowledgeEntries.fileSize, url: knowledgeEntries.url, body: knowledgeEntries.body,
  needsConfirmation: knowledgeEntries.needsConfirmation, version: knowledgeEntries.version, sortOrder: knowledgeEntries.sortOrder,
  starterKey: knowledgeEntries.starterKey, createdAt: knowledgeEntries.createdAt, createdBy: knowledgeEntries.createdBy,
  updatedAt: knowledgeEntries.updatedAt, updatedBy: knowledgeEntries.updatedBy,
}

/** The facility's own entries and those for all facilities. */
const ofFacility = (facilityId: number) => or(eq(knowledgeEntries.facilityId, facilityId), isNull(knowledgeEntries.facilityId))

/** Where an entry shows in the facility: its category there (null = „Vom Träger“) and the visibility that applies. */
interface Placement { category: CategoryRow | null; name: string; visibility: TemplateVisibility[] }

/**
 * Places the entries in the facility's categories: a facility's own entry in its category; an entry for all facilities
 * in the facility's category of the same name (regardless of case), otherwise under „Vom Träger“. The visibilities that
 * apply: the category's, for an entry for all facilities its own as well (the stricter one wins).
 */
function placer(categories: readonly CategoryRow[]): (row: Pick<EntryRow, 'facilityId' | 'categoryId' | 'categoryName' | 'visibility'>) => Placement | null {
  const byId = new Map(categories.map(category => [category.id, category]))
  const byName = new Map<string, CategoryRow>()
  for (const category of categories) {
    const key = comparableKnowledgeName(category.name)
    if (!byName.has(key)) byName.set(key, category)
  }
  return (row) => {
    if (row.facilityId !== null) {
      const category = row.categoryId === null ? undefined : byId.get(row.categoryId)
      return category ? { category, name: category.name, visibility: [category.visibility] } : null
    }
    const category = byName.get(comparableKnowledgeName(row.categoryName ?? '')) ?? null
    return { category, name: category?.name ?? row.categoryName ?? '', visibility: category ? [row.visibility, category.visibility] : [row.visibility] }
  }
}

/** Whether someone of the role sees an entry placed so. */
const seesPlacement = (role: Role, placement: Placement | null) =>
  placement !== null && placement.visibility.every(visibility => seesTemplateCategory(role, visibility))

/** An entry for all facilities is the Träger's (knowledge.global); a facility's own needs knowledge.manage. */
const mayEdit = (viewer: Pick<SessionUser, 'permissions'>, row: Pick<EntryRow, 'facilityId'>) =>
  row.facilityId === null ? can(viewer.permissions, 'knowledge.global') : manages(viewer)

type Placed = { row: EntryRow; placement: Placement }

/** By category (in the facility's order, „Vom Träger“ last), the facility's own entries first (▲/▼), then by title. */
function compareEntries(a: Placed, b: Placed): number {
  const order = (entry: Placed) => entry.placement.category?.sortOrder ?? Infinity
  const own = (entry: Placed) => (entry.row.facilityId === null ? 1 : 0)
  return order(a) - order(b) || (a.placement.category?.id ?? 0) - (b.placement.category?.id ?? 0)
    || (a.placement.category === null ? a.placement.name.localeCompare(b.placement.name, 'de') : 0)
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
  const categories = all.filter(row => seesTemplateCategory(viewer.role, row.visibility))
  const entries = visibleEntries(db, viewer, all)
  const person = accountPerson(viewer)
  const confirmations = new Map(person === null || entries.length === 0 ? [] : db.select().from(knowledgeConfirmations)
    .where(and(eq(knowledgeConfirmations.employeeId, person), inArray(knowledgeConfirmations.entryId, entries.map(entry => entry.row.id))))
    .all().map(row => [row.entryId, row]))
  const counts = new Map<number, number>()
  const owns = new Map<number, number>()
  for (const { row, placement } of entries) {
    if (!placement.category) continue
    counts.set(placement.category.id, (counts.get(placement.category.id) ?? 0) + 1)
    if (row.facilityId !== null) owns.set(placement.category.id, (owns.get(placement.category.id) ?? 0) + 1)
  }
  const dtos = entries.map(({ row, placement }): KnowledgeEntryDto => {
    const confirmation = confirmations.get(row.id)
    return {
      id: row.id,
      categoryId: placement.category?.id ?? null,
      global: row.facilityId === null,
      globalCategoryName: row.facilityId === null ? row.categoryName ?? '' : null,
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
      id: category.id, name: category.name, visibility: category.visibility, entryCount: counts.get(category.id) ?? 0,
      ownCount: owns.get(category.id) ?? 0,
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

/** The category of a facility's entry as the actor chooses it: one of the facility they see, else 400 knowledge_category_invalid. */
function chosenCategory(db: Db, actor: KnowledgeActor, id: number | undefined): number {
  const row = id === undefined
    ? undefined
    : db.select().from(knowledgeCategories).where(and(eq(knowledgeCategories.id, id), eq(knowledgeCategories.facilityId, actor.facilityId))).get()
  if (!row || !seesTemplateCategory(actor.role, row.visibility)) throw new ServiceError(400, 'knowledge_category_invalid')
  return row.id
}

/** Where the entry is filed: a category of the facility, or for all facilities a category name and its visibility. */
function filing(db: Db, actor: KnowledgeActor, global: boolean, input: KnowledgeEntryInput, current?: TemplateVisibility) {
  if (!global) return { categoryId: chosenCategory(db, actor, input.categoryId), categoryName: null, visibility: 'all' as const }
  const visibility = input.visibility ?? current ?? 'all'
  if (!visibleTemplateLevels(actor.role).includes(visibility)) throw new ServiceError(403, 'forbidden')
  return { categoryId: null, categoryName: checkedCategoryName(input.categoryName ?? ''), visibility }
}

/** The file columns of a file entry (a new PDF), or none for a link or text. */
function fileColumns(kind: KnowledgeEntryInput['kind'], file: { data: Buffer } | null) {
  if (kind !== 'file') return { fileData: null, fileMime: null, fileSize: null }
  if (!file) throw new ServiceError(400, 'file_required')
  return { fileData: file.data, fileMime: checkedPdf(file.data), fileSize: file.data.length }
}

/** The next place at the end of the facility's own entries in the category. */
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
    version: 1, createdAt: at, createdBy: actor.id, updatedAt: at, updatedBy: actor.id,
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
 * do not.
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
    version: changed ? row.version + 1 : row.version,
    updatedAt: now.toISOString(), updatedBy: actor.id,
  }).where(eq(knowledgeEntries.id, id)).run()
}

/** Deletes the entry with its confirmations. */
export function deleteKnowledgeEntry(db: Db, actor: KnowledgeActor, id: number): void {
  loadEditable(db, actor, id)
  db.delete(knowledgeEntries).where(eq(knowledgeEntries.id, id)).run()
}

/**
 * ▲/▼: swaps a facility's own entry with its neighbour among the facility's own entries of the same category (the
 * Träger's entries for all facilities follow them, by title); at an end nothing changes. The category's own entries
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

/** Records the person's confirmation of the entry's current version (an earlier one is replaced). */
function recordConfirmation(db: Db, row: EntryRow, employeeId: number, via: 'tablet' | 'account', now: Date): KnowledgeConfirmResultDto {
  if (!row.needsConfirmation) throw new ServiceError(409, 'knowledge_confirmation_not_needed')
  const confirmedAt = now.toISOString()
  const values = { entryVersion: row.version, confirmedAt, via }
  db.insert(knowledgeConfirmations).values({ entryId: row.id, employeeId, ...values })
    .onConflictDoUpdate({ target: [knowledgeConfirmations.entryId, knowledgeConfirmations.employeeId], set: values }).run()
  const name = db.select({ name: employees.name }).from(employees).where(eq(employees.id, employeeId)).get()?.name ?? ''
  return { name, confirmedAt, version: row.version }
}

/**
 * „Gelesen und verstanden“ with the own account: for its linked employee (403 knowledge_no_employee without one), of an
 * entry the viewer sees that asks for it (409 knowledge_confirmation_not_needed otherwise).
 */
export function confirmWithAccount(db: Db, viewer: KnowledgeViewer, id: number, now: Date = new Date()): KnowledgeConfirmResultDto {
  const person = accountPerson(viewer)
  if (person === null) throw new ServiceError(403, 'knowledge_no_employee')
  const { row } = loadVisible(db, viewer, id)
  return recordConfirmation(db, row, person, 'account', now)
}

/**
 * „Gelesen und verstanden“ at the facility's tablet: a person of its list (404 employee_not_found otherwise, without
 * counting a PIN attempt) confirms for themselves with their PIN (the same attempts and lock as stamping), an entry the
 * tablet shows (visible to all).
 */
export function confirmAtTablet(
  db: Db, terminal: { facilityId: number }, id: number, employeeId: number, pin: string, now: Date = new Date(),
): KnowledgeConfirmResultDto {
  const { row } = loadVisible(db, { role: 'terminal', facilityId: terminal.facilityId }, id)
  if (!row.needsConfirmation) throw new ServiceError(409, 'knowledge_confirmation_not_needed')
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
  db: Db, reader: KnowledgeViewer, id: number, input: { employeeId?: number; pin?: string }, now: Date = new Date(),
): KnowledgeConfirmResultDto {
  if (reader.role !== 'terminal') return confirmWithAccount(db, reader, id, now)
  if (input.employeeId === undefined || input.pin === undefined) throw new ServiceError(400, 'invalid_input')
  return confirmAtTablet(db, reader, id, input.employeeId, input.pin, now)
}

const STATE_ORDER: Record<KnowledgeConfirmState, number> = { open: 0, outdated: 1, confirmed: 2, none: 3 }

/**
 * Who of the facility confirmed the entry and who not yet (knowledge.manage; an entry the actor sees in the facility,
 * else 404): every employee of the facility employed today who sees it (by the role of their active account, the
 * Mitarbeiter's without one: a category for Leitung and Träger counts only them), plus anyone of the facility who
 * confirmed but left or no longer sees it. Helpers of other facilities and other facilities' staff are not shown.
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
    .where(and(eq(knowledgeConfirmations.entryId, id), eq(employees.facilityId, actor.facilityId))).all()
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
      updatedAt: row.updatedAt, asOf: row.asOf, category: placement.name,
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

const STARTER_KEYS = [...KNOWLEDGE_STARTER_CATEGORIES, ...KNOWLEDGE_STARTER_LINKS].map(starter => starter.key)

/**
 * Gives the facility every starter category and link (shared/domain/knowledge.ts) it has not been given yet and records
 * each as given, so a deleted or renamed one never comes back while a starter new in a later version still arrives. A
 * category of that name already there is only recorded; a link whose category the facility no longer has, or for
 * another state (Orientierungsplan, KiTaG: Baden-Württemberg), is recorded without being created. Call it inside the
 * caller's transaction.
 */
export function seedKnowledgeStarters(db: Db, facilityId: number, now: Date = new Date()): void {
  const facility = db.select({ state: facilities.state }).from(facilities).where(eq(facilities.id, facilityId)).get()
  if (!facility) return
  const seeded = seededKeys(db, facilityId)
  const at = now.toISOString()
  const record = (starterKey: string) => db.insert(knowledgeStarterSeeds).values({ facilityId, starterKey, seededAt: at }).run()
  for (const starter of KNOWLEDGE_STARTER_CATEGORIES) {
    if (seeded.has(starter.key)) continue
    const categories = facilityKnowledgeCategories(db, facilityId)
    if (!categories.some(category => comparableKnowledgeName(category.name) === comparableKnowledgeName(starter.name))) {
      const last = categories.at(-1)
      db.insert(knowledgeCategories).values({ facilityId, name: starter.name, sortOrder: last ? last.sortOrder + 1 : 0, visibility: 'all' }).run()
    }
    record(starter.key)
  }
  for (const link of KNOWLEDGE_STARTER_LINKS) {
    if (seeded.has(link.key)) continue
    const category = facilityKnowledgeCategories(db, facilityId)
      .find(row => comparableKnowledgeName(row.name) === comparableKnowledgeName(link.category))
    if (category && (!link.states || link.states.includes(facility.state))) {
      db.insert(knowledgeEntries).values({
        facilityId, categoryId: category.id, kind: 'link', title: link.title, description: link.description, url: link.url,
        starterKey: link.key, sortOrder: nextSortOrder(db, category.id), createdAt: at, updatedAt: at,
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
