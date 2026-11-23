import { and, eq, isNull, or } from 'drizzle-orm'
import { can, type PermissionKey } from '../../shared/domain/permissions'
import { seesTemplateCategory, visibleTemplateLevels, type TemplateVisibility } from '../../shared/domain/templateCategories'
import type { PrintTemplateDto, PrintTemplateMeta, PrintTemplateScope, Role, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { facilities, printTemplateOrder, printTemplates } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { safeFileNamePart } from '../lib/fileName'
import { checkedDocumentFile } from '../lib/fileSignature'
import { fillableFile } from '../lib/pdfForm'
import { checkedCategoryName, chosenCategory, comparableCategoryName, facilityCategories } from './templateCategories'

/**
 * Who uploads and maintains templates, in the facility they work in. What they may change follows from their own
 * permissions (printTemplates.edit, printTemplates.global); which categories they see from the role.
 */
export type TemplateActor = Pick<SessionUser, 'id' | 'role' | 'permissions'> & { facilityId: number }

/**
 * Who looks at templates: the role decides which categories they see (shared/domain/templateCategories.ts), the
 * permissions whether they may change a template.
 */
export type TemplateViewer = Pick<SessionUser, 'role' | 'permissions'> & { facilityId: number }

/**
 * Templates are blank forms, no child data: whoever may see them (printTemplates.view: Leitung, Träger and, read only,
 * Mitarbeiter accounts) and the facility's tablet (no unlock). The rule requirePermission applies on the print template
 * routes; which templates they see depends on the categories' visibility.
 */
export function templateReaderFacility(user: SessionUser): number {
  if (user.role !== 'terminal' && !can(user.permissions, 'printTemplates.view')) throw new ServiceError(403, 'forbidden')
  if (user.facilityId === null) throw new ServiceError(403, 'no_facility')
  return user.facilityId
}

/** Only PDF files, with the size limit of the child documents; returns the detected type. */
const checkedPdf = (data: Buffer) => checkedDocumentFile(data, ['application/pdf'], 'print_template_type_invalid')

/** Global templates belong to the Träger (printTemplates.global); the Leitung may only change those of its facility. */
const mayEdit = (permissions: ReadonlySet<PermissionKey>, row: { facilityId: number | null }) =>
  can(permissions, 'printTemplates.global') || (can(permissions, 'printTemplates.edit') && row.facilityId !== null)

type TemplateRow = Pick<typeof printTemplates.$inferSelect, 'facilityId' | 'categoryId' | 'categoryName' | 'visibility'>

/** Where a template shows in the facility: its category there (null = „Vom Träger“), and whether the role sees it. */
interface Placement { categoryId: number | null; category: string; sortOrder: number; visible: boolean }

/**
 * Places the templates in the facility's categories: a facility's own template in its category; a template for all
 * facilities in the facility's category of the same name (regardless of case), otherwise under „Vom Träger“ (after all
 * categories). The viewer sees a template when they see its category and, for one for all facilities, its own visibility
 * as well (the stricter one wins).
 */
function placer(db: Db, facilityId: number, role: Role): (row: TemplateRow) => Placement {
  const categories = facilityCategories(db, facilityId)
  const byId = new Map(categories.map(category => [category.id, category]))
  const byName = new Map<string, typeof categories[number]>()
  for (const category of categories) {
    const key = comparableCategoryName(category.name)
    if (!byName.has(key)) byName.set(key, category)
  }
  return (row) => {
    if (row.facilityId !== null) {
      const category = row.categoryId === null ? undefined : byId.get(row.categoryId)
      if (!category) return { categoryId: null, category: '', sortOrder: Infinity, visible: false }
      return { categoryId: category.id, category: category.name, sortOrder: category.sortOrder, visible: seesTemplateCategory(role, category.visibility) }
    }
    const name = row.categoryName ?? ''
    const category = byName.get(comparableCategoryName(name))
    const visible = seesTemplateCategory(role, row.visibility) && (!category || seesTemplateCategory(role, category.visibility))
    return category
      ? { categoryId: category.id, category: category.name, sortOrder: category.sortOrder, visible }
      : { categoryId: null, category: name, sortOrder: Infinity, visible }
  }
}

/** The facility's own templates and those for all facilities. */
const ofFacility = (facilityId: number) => or(eq(printTemplates.facilityId, facilityId), isNull(printTemplates.facilityId))

/** What the list shows of a template (never the file). */
const LISTED = {
  id: printTemplates.id, facilityId: printTemplates.facilityId, title: printTemplates.title, categoryId: printTemplates.categoryId,
  categoryName: printTemplates.categoryName, visibility: printTemplates.visibility, size: printTemplates.size,
  uploadedAt: printTemplates.uploadedAt, updatedAt: printTemplates.updatedAt, fillable: printTemplates.fillable,
}
type ListedRow = { [K in keyof typeof LISTED]: (typeof printTemplates.$inferSelect)[K] }

/** A template placed in one of the facility's sub-tabs, with its place there (print_template_order; none = not ordered yet). */
interface Placed { row: ListedRow; placement: Placement; order: number | undefined }

/** Category order first (infinite for „Vom Träger“, last), then the category itself. */
const byCategory = (a: Placement, b: Placement) =>
  (a.sortOrder === b.sortOrder ? 0 : a.sortOrder < b.sortOrder ? -1 : 1) || (a.categoryId ?? 0) - (b.categoryId ?? 0)

/**
 * The order within a sub-tab: the templates ordered with ▲/▼ (or uploaded since) by their place, then those of before
 * without a place, alphabetical („Vom Träger“ by the category name the Träger chose first), as they were listed before.
 */
const bySubTabOrder = (a: Placed, b: Placed) =>
  Number(a.order === undefined) - Number(b.order === undefined) || (a.order ?? 0) - (b.order ?? 0)
  || (a.placement.categoryId === null ? a.placement.category.localeCompare(b.placement.category, 'de') : 0)
  || a.row.title.localeCompare(b.row.title, 'de') || a.row.id - b.row.id

/**
 * Every template of the facility in its sub-tab (`placement.categoryId`, null = „Vom Träger“) and order, also those the
 * role does not see (`placement.visible`). A facility template without a category of the facility shows nowhere.
 */
function placedTemplates(db: Db, facilityId: number, role: Role): Placed[] {
  const place = placer(db, facilityId, role)
  const orders = new Map(db.select({ templateId: printTemplateOrder.templateId, sortOrder: printTemplateOrder.sortOrder })
    .from(printTemplateOrder).where(eq(printTemplateOrder.facilityId, facilityId)).all()
    .map(row => [row.templateId, row.sortOrder]))
  return db.select(LISTED).from(printTemplates).where(ofFacility(facilityId)).all()
    .map(row => ({ row, placement: place(row), order: orders.get(row.id) }))
    .filter(({ row, placement }) => row.facilityId === null || placement.categoryId !== null)
    .sort((a, b) => byCategory(a.placement, b.placement) || bySubTabOrder(a, b))
}

/** Numbers the facility's sub-tab afresh in the given order (0, 1, …). */
function writeOrder(db: Db, facilityId: number, ids: readonly number[]): void {
  ids.forEach((templateId, sortOrder) => {
    db.insert(printTemplateOrder).values({ facilityId, templateId, sortOrder })
      .onConflictDoUpdate({ target: [printTemplateOrder.facilityId, printTemplateOrder.templateId], set: { sortOrder } }).run()
  })
}

/**
 * Puts the template at the end of its sub-tab in the facility (a new upload, or filed elsewhere). The others keep the
 * order they show in, so those of before without a place get one (else they would sort after the new one).
 */
function appendToSubTab(db: Db, facilityId: number, templateId: number): void {
  const placed = placedTemplates(db, facilityId, 'provider')
  const self = placed.find(entry => entry.row.id === templateId)
  if (!self) return
  const others = placed.filter(entry => entry.row.id !== templateId && entry.placement.categoryId === self.placement.categoryId)
  writeOrder(db, facilityId, [...others.map(entry => entry.row.id), templateId])
}

/** The facilities a template shows in: its own, or every facility for one for all facilities. */
const facilitiesOf = (db: Db, row: { facilityId: number | null }): number[] => (row.facilityId !== null
  ? [row.facilityId]
  : db.select({ id: facilities.id }).from(facilities).all().map(facility => facility.id))

/** The sub-tab the template shows in, in the facility (null = „Vom Träger“). */
const subTabOf = (db: Db, facilityId: number, row: TemplateRow): number | null => placer(db, facilityId, 'provider')(row).categoryId

/** The category name and visibility of a template for all facilities, as the Träger chose them. */
function globalFiling(role: Role, input: PrintTemplateMeta, current?: TemplateVisibility): { categoryName: string; visibility: TemplateVisibility } {
  const categoryName = checkedCategoryName(input.categoryName ?? '')
  const visibility = input.visibility ?? current ?? 'all'
  if (!visibleTemplateLevels(role).includes(visibility)) throw new ServiceError(403, 'forbidden')
  return { categoryName, visibility }
}

/**
 * A new template of the uploader's facility, in one of the facility's categories they see, or for all facilities
 * (Träger only) under a category name; returns its id.
 */
export function uploadTemplate(
  db: Db, actor: TemplateActor, input: PrintTemplateMeta & { scope: PrintTemplateScope },
  file: { data: Buffer; filename: string }, now: Date = new Date(),
): number {
  const permissions = actor.permissions
  if (!can(permissions, 'printTemplates.edit')) throw new ServiceError(403, 'forbidden')
  if (input.scope === 'all' && !can(permissions, 'printTemplates.global')) throw new ServiceError(403, 'forbidden')
  const filing = input.scope === 'all'
    ? { categoryId: null, ...globalFiling(actor.role, input) }
    : { categoryId: chosenCategory(db, actor.role, actor.facilityId, input.categoryId).id, categoryName: null, visibility: 'all' as const }
  const mimeType = checkedPdf(file.data)
  // Prefilled from the file name in the form; an empty title falls back to it here as well.
  const title = input.title.trim() || file.filename.replace(/\.[^.]*$/, '').trim()
  if (title === '') throw new ServiceError(400, 'print_template_title_required')
  const at = now.toISOString()
  const facilityId = input.scope === 'all' ? null : actor.facilityId
  return db.transaction((tx) => {
    const id = tx.insert(printTemplates).values({
      facilityId,
      title: title.slice(0, 200),
      ...filing,
      mimeType,
      fillable: fillableFile(file.data, mimeType),
      size: file.data.length,
      data: file.data,
      uploadedBy: actor.id,
      uploadedAt: at,
      updatedAt: at,
    }).returning({ id: printTemplates.id }).get().id
    // At the end of its category, in every facility it shows in.
    for (const shownIn of facilitiesOf(tx, { facilityId })) appendToSubTab(tx, shownIn, id)
    return id
  })
}

/**
 * The templates the viewer sees in the facility, in the order of the facility's categories („Vom Träger“ last) and
 * within each in the facility's order (▲/▼; those of before without a place after them, by title); `canEdit` by the
 * viewer's permissions.
 */
export function listTemplates(db: Db, viewer: TemplateViewer): PrintTemplateDto[] {
  const permissions = viewer.permissions
  return placedTemplates(db, viewer.facilityId, viewer.role)
    .filter(({ placement }) => placement.visible)
    .map(({ row, placement }) => ({
      id: row.id,
      title: row.title,
      categoryId: placement.categoryId,
      category: placement.category,
      global: row.facilityId === null,
      globalCategoryName: row.facilityId === null ? row.categoryName ?? '' : null,
      globalVisibility: row.facilityId === null ? row.visibility : null,
      size: row.size,
      uploadedAt: row.uploadedAt,
      updatedAt: row.updatedAt,
      canEdit: mayEdit(permissions, row),
      // Judged when the file was stored; a template of before not judged yet (null) offers no „Ausfüllen“ yet.
      fillable: row.fillable === true,
    }))
}

/** A template of the viewer's facility or for all facilities that the viewer sees, else 404 print_template_not_found. */
function loadVisible(db: Db, viewer: TemplateViewer, id: number) {
  const row = db.select().from(printTemplates).where(and(eq(printTemplates.id, id), ofFacility(viewer.facilityId))).get()
  if (!row || !placer(db, viewer.facilityId, viewer.role)(row).visible) throw new ServiceError(404, 'print_template_not_found')
  return row
}

/**
 * The PDF, named after its title; another facility's template, or one in a category the viewer does not see, is 404
 * print_template_not_found.
 */
export function readTemplateFile(db: Db, viewer: TemplateViewer, id: number): { data: Buffer; mimeType: string; fileName: string } {
  const row = loadVisible(db, viewer, id)
  return { data: row.data, mimeType: row.mimeType, fileName: `${safeFileNamePart(row.title) || 'Vorlage'}.pdf` }
}

/**
 * A template the actor sees (else 404 print_template_not_found: another facility's, or in a category they do not see)
 * and may change (else 403 forbidden).
 */
function loadEditable(db: Db, actor: TemplateActor, id: number) {
  const row = loadVisible(db, actor, id)
  if (!mayEdit(actor.permissions, row)) throw new ServiceError(403, 'forbidden')
  return row
}

/**
 * Renames the template and files it elsewhere, the file stays: a facility's template in another of the facility's
 * categories the actor sees, a template for all facilities under another category name and visibility. Where it lands in
 * another sub-tab, it goes to the end there; otherwise it keeps its place.
 */
export function updateTemplate(db: Db, actor: TemplateActor, id: number, meta: PrintTemplateMeta, now: Date = new Date()): void {
  const row = loadEditable(db, actor, id)
  const title = meta.title.trim()
  if (title === '') throw new ServiceError(400, 'print_template_title_required')
  const filing = row.facilityId === null
    ? globalFiling(actor.role, meta, row.visibility)
    : { categoryId: chosenCategory(db, actor.role, actor.facilityId, meta.categoryId).id }
  const shownIn = facilitiesOf(db, row).map(facilityId => ({ facilityId, before: subTabOf(db, facilityId, row) }))
  db.transaction((tx) => {
    tx.update(printTemplates).set({ title, ...filing, updatedAt: now.toISOString() })
      .where(eq(printTemplates.id, id)).run()
    const after = { ...row, ...filing }
    for (const { facilityId, before } of shownIn) {
      if (subTabOf(tx, facilityId, after) !== before) appendToSubTab(tx, facilityId, id)
    }
  })
}

/**
 * The new order of a sub-tab of the actor's facility (a category of the facility they see, or null for „Vom Träger“),
 * as the editor sees it: exactly the templates of the sub-tab the actor sees, each once (else 400 invalid_order).
 * Templates the actor does not see keep their places in between. For a template for all facilities this is the order
 * of this facility alone; the Leitung may order them too (printTemplates.edit, else 403).
 */
export function orderTemplates(db: Db, actor: TemplateActor, categoryId: number | null, ids: readonly number[]): void {
  if (!can(actor.permissions, 'printTemplates.edit')) throw new ServiceError(403, 'forbidden')
  if (categoryId !== null) {
    const category = facilityCategories(db, actor.facilityId).find(row => row.id === categoryId)
    if (!category || !seesTemplateCategory(actor.role, category.visibility)) throw new ServiceError(404, 'template_category_not_found')
  }
  const subTab = placedTemplates(db, actor.facilityId, actor.role).filter(entry => entry.placement.categoryId === categoryId)
  const visible = new Set(subTab.filter(entry => entry.placement.visible).map(entry => entry.row.id))
  if (ids.length !== visible.size || new Set(ids).size !== ids.length || !ids.every(id => visible.has(id))) {
    throw new ServiceError(400, 'invalid_order')
  }
  // The visible ones take the visible places in the new order, the hidden ones stay put.
  let next = 0
  const order = subTab.map(entry => (entry.placement.visible ? ids[next++]! : entry.row.id))
  db.transaction(tx => writeOrder(tx, actor.facilityId, order))
}

/** A new file for the template (same id, title and category). */
export function replaceTemplateFile(
  db: Db, actor: TemplateActor, id: number, file: { data: Buffer; filename: string }, now: Date = new Date(),
): void {
  loadEditable(db, actor, id)
  const mimeType = checkedPdf(file.data)
  db.update(printTemplates).set({
    mimeType, fillable: fillableFile(file.data, mimeType), size: file.data.length, data: file.data, updatedAt: now.toISOString(),
  }).where(eq(printTemplates.id, id)).run()
}

export function deleteTemplate(db: Db, actor: TemplateActor, id: number): void {
  loadEditable(db, actor, id)
  db.delete(printTemplates).where(eq(printTemplates.id, id)).run()
}
