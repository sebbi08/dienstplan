import { and, eq, isNull, or } from 'drizzle-orm'
import { can, type PermissionKey } from '../../shared/domain/permissions'
import { seesTemplateCategory, visibleTemplateLevels, type TemplateVisibility } from '../../shared/domain/templateCategories'
import type { PrintTemplateDto, PrintTemplateMeta, PrintTemplateScope, Role, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { printTemplates } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { safeFileNamePart } from '../lib/fileName'
import { checkedDocumentFile } from '../lib/fileSignature'
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
  return db.insert(printTemplates).values({
    facilityId: input.scope === 'all' ? null : actor.facilityId,
    title: title.slice(0, 200),
    ...filing,
    mimeType,
    size: file.data.length,
    data: file.data,
    uploadedBy: actor.id,
    uploadedAt: at,
    updatedAt: at,
  }).returning({ id: printTemplates.id }).get().id
}

/**
 * The templates the viewer sees in the facility, in the order of the facility's categories („Vom Träger“ last) and by
 * title; `canEdit` by the viewer's permissions.
 */
export function listTemplates(db: Db, viewer: TemplateViewer): PrintTemplateDto[] {
  const permissions = viewer.permissions
  const place = placer(db, viewer.facilityId, viewer.role)
  const rows = db.select({
    id: printTemplates.id, facilityId: printTemplates.facilityId, title: printTemplates.title, categoryId: printTemplates.categoryId,
    categoryName: printTemplates.categoryName, visibility: printTemplates.visibility, size: printTemplates.size,
    uploadedAt: printTemplates.uploadedAt, updatedAt: printTemplates.updatedAt,
  }).from(printTemplates).where(ofFacility(viewer.facilityId)).all()
  return rows
    .map(row => ({ row, placement: place(row) }))
    .filter(({ placement }) => placement.visible)
    .sort((a, b) => a.placement.sortOrder - b.placement.sortOrder || (a.placement.categoryId ?? 0) - (b.placement.categoryId ?? 0)
      || a.row.title.localeCompare(b.row.title, 'de') || a.row.id - b.row.id)
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
 * categories the actor sees, a template for all facilities under another category name and visibility.
 */
export function updateTemplate(db: Db, actor: TemplateActor, id: number, meta: PrintTemplateMeta, now: Date = new Date()): void {
  const row = loadEditable(db, actor, id)
  const title = meta.title.trim()
  if (title === '') throw new ServiceError(400, 'print_template_title_required')
  const filing = row.facilityId === null
    ? globalFiling(actor.role, meta, row.visibility)
    : { categoryId: chosenCategory(db, actor.role, actor.facilityId, meta.categoryId).id }
  db.update(printTemplates).set({ title, ...filing, updatedAt: now.toISOString() })
    .where(eq(printTemplates.id, id)).run()
}

/** A new file for the template (same id, title and category). */
export function replaceTemplateFile(
  db: Db, actor: TemplateActor, id: number, file: { data: Buffer; filename: string }, now: Date = new Date(),
): void {
  loadEditable(db, actor, id)
  const mimeType = checkedPdf(file.data)
  db.update(printTemplates).set({ mimeType, size: file.data.length, data: file.data, updatedAt: now.toISOString() })
    .where(eq(printTemplates.id, id)).run()
}

export function deleteTemplate(db: Db, actor: TemplateActor, id: number): void {
  loadEditable(db, actor, id)
  db.delete(printTemplates).where(eq(printTemplates.id, id)).run()
}
