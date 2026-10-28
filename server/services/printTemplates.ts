import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { can, type PermissionKey } from '../../shared/domain/permissions'
import { visibleTemplateLevels } from '../../shared/domain/templateCategories'
import type { PrintTemplateDto, PrintTemplateMeta, PrintTemplateScope, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { printTemplates, templateCategories } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { safeFileNamePart } from '../lib/fileName'
import { checkedDocumentFile } from '../lib/fileSignature'
import { chosenCategory } from './templateCategories'

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

/** The facility's own templates and those for all facilities, in the categories the role sees. */
const visibleTo = (viewer: TemplateViewer) => and(
  or(eq(printTemplates.facilityId, viewer.facilityId), isNull(printTemplates.facilityId)),
  inArray(templateCategories.visibility, visibleTemplateLevels(viewer.role)),
)

/** Global templates belong to the Träger (printTemplates.global); the Leitung may only change those of its facility. */
const mayEdit = (permissions: ReadonlySet<PermissionKey>, row: { facilityId: number | null }) =>
  can(permissions, 'printTemplates.global') || (can(permissions, 'printTemplates.edit') && row.facilityId !== null)

/** A new template of the uploader's facility, or for all facilities (Träger only), in a category they see; returns its id. */
export function uploadTemplate(
  db: Db, actor: TemplateActor, input: PrintTemplateMeta & { scope: PrintTemplateScope },
  file: { data: Buffer; filename: string }, now: Date = new Date(),
): number {
  const permissions = actor.permissions
  if (!can(permissions, 'printTemplates.edit')) throw new ServiceError(403, 'forbidden')
  if (input.scope === 'all' && !can(permissions, 'printTemplates.global')) throw new ServiceError(403, 'forbidden')
  const category = chosenCategory(db, actor.role, input.categoryId)
  const mimeType = checkedPdf(file.data)
  // Prefilled from the file name in the form; an empty title falls back to it here as well.
  const title = input.title.trim() || file.filename.replace(/\.[^.]*$/, '').trim()
  if (title === '') throw new ServiceError(400, 'print_template_title_required')
  const at = now.toISOString()
  return db.insert(printTemplates).values({
    facilityId: input.scope === 'all' ? null : actor.facilityId,
    title: title.slice(0, 200),
    categoryId: category.id,
    mimeType,
    size: file.data.length,
    data: file.data,
    uploadedBy: actor.id,
    uploadedAt: at,
    updatedAt: at,
  }).returning({ id: printTemplates.id }).get().id
}

/**
 * The templates the viewer sees in the facility, in the order of their categories and by title; `canEdit` by the
 * viewer's permissions.
 */
export function listTemplates(db: Db, viewer: TemplateViewer): PrintTemplateDto[] {
  const permissions = viewer.permissions
  const rows = db.select({
    id: printTemplates.id, facilityId: printTemplates.facilityId, title: printTemplates.title, categoryId: printTemplates.categoryId,
    category: templateCategories.name, sortOrder: templateCategories.sortOrder, size: printTemplates.size,
    uploadedAt: printTemplates.uploadedAt, updatedAt: printTemplates.updatedAt,
  }).from(printTemplates).innerJoin(templateCategories, eq(templateCategories.id, printTemplates.categoryId))
    .where(visibleTo(viewer)).all()
  return rows
    .sort((a, b) => a.sortOrder - b.sortOrder || a.categoryId - b.categoryId || a.title.localeCompare(b.title, 'de') || a.id - b.id)
    .map(row => ({
      id: row.id,
      title: row.title,
      categoryId: row.categoryId,
      category: row.category,
      global: row.facilityId === null,
      size: row.size,
      uploadedAt: row.uploadedAt,
      updatedAt: row.updatedAt,
      canEdit: mayEdit(permissions, row),
    }))
}

/**
 * The PDF, named after its title; another facility's template, or one in a category the viewer does not see, is 404
 * print_template_not_found.
 */
export function readTemplateFile(db: Db, viewer: TemplateViewer, id: number): { data: Buffer; mimeType: string; fileName: string } {
  const row = db.select({ data: printTemplates.data, mimeType: printTemplates.mimeType, title: printTemplates.title })
    .from(printTemplates).innerJoin(templateCategories, eq(templateCategories.id, printTemplates.categoryId))
    .where(and(eq(printTemplates.id, id), visibleTo(viewer))).get()
  if (!row) throw new ServiceError(404, 'print_template_not_found')
  return { data: row.data, mimeType: row.mimeType, fileName: `${safeFileNamePart(row.title) || 'Vorlage'}.pdf` }
}

/**
 * A template the actor sees (else 404 print_template_not_found: another facility's, or in a category they do not see)
 * and may change (else 403 forbidden).
 */
function loadEditable(db: Db, actor: TemplateActor, id: number): void {
  const row = db.select({ facilityId: printTemplates.facilityId }).from(printTemplates)
    .innerJoin(templateCategories, eq(templateCategories.id, printTemplates.categoryId))
    .where(and(eq(printTemplates.id, id), visibleTo(actor))).get()
  if (!row) throw new ServiceError(404, 'print_template_not_found')
  if (!mayEdit(actor.permissions, row)) throw new ServiceError(403, 'forbidden')
}

/** Renames the template and moves it to another category the actor sees; the file stays. */
export function updateTemplate(db: Db, actor: TemplateActor, id: number, meta: PrintTemplateMeta, now: Date = new Date()): void {
  loadEditable(db, actor, id)
  const title = meta.title.trim()
  if (title === '') throw new ServiceError(400, 'print_template_title_required')
  const category = chosenCategory(db, actor.role, meta.categoryId)
  db.update(printTemplates).set({ title, categoryId: category.id, updatedAt: now.toISOString() })
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
