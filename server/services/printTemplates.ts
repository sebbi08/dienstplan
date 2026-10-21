import { and, asc, eq, isNull, or } from 'drizzle-orm'
import { isManager } from '../../shared/domain/roles'
import type { PrintTemplateDto, PrintTemplateMeta, PrintTemplateScope, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { printTemplates } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { safeFileNamePart } from '../lib/fileName'
import { checkedDocumentFile } from '../lib/fileSignature'

/** Who uploads and maintains templates: Träger or Leitung, in the facility they work in. */
export type TemplateActor = Pick<SessionUser, 'id' | 'role'> & { facilityId: number }

/** Category of a template without one. */
export const OTHER_CATEGORY = 'Sonstiges'

/** Templates are blank forms, no child data: whoever runs a facility and its tablet (no unlock) see them, staff accounts never. */
export function templateReaderFacility(user: SessionUser): number {
  if (!isManager(user.role) && user.role !== 'terminal') throw new ServiceError(403, 'forbidden')
  if (user.facilityId === null) throw new ServiceError(403, 'no_facility')
  return user.facilityId
}

/** Only PDF files, with the size limit of the child documents; returns the detected type. */
const checkedPdf = (data: Buffer) => checkedDocumentFile(data, ['application/pdf'], 'print_template_type_invalid')

const categoryOf = (category: string) => category.trim() || OTHER_CATEGORY

/** The facility's own templates and those for all facilities. */
const visibleIn = (facilityId: number) => or(eq(printTemplates.facilityId, facilityId), isNull(printTemplates.facilityId))

/** Global templates belong to the Träger; the Leitung may only change those of its facility. */
const mayEdit = (role: SessionUser['role'], row: { facilityId: number | null }) =>
  role === 'provider' || (isManager(role) && row.facilityId !== null)

/** A new template of the uploader's facility, or for all facilities (Träger only); returns its id. */
export function uploadTemplate(
  db: Db, actor: TemplateActor, input: PrintTemplateMeta & { scope: PrintTemplateScope },
  file: { data: Buffer; filename: string }, now: Date = new Date(),
): number {
  if (input.scope === 'all' && actor.role !== 'provider') throw new ServiceError(403, 'forbidden')
  const mimeType = checkedPdf(file.data)
  // Prefilled from the file name in the form; an empty title falls back to it here as well.
  const title = input.title.trim() || file.filename.replace(/\.[^.]*$/, '').trim()
  if (title === '') throw new ServiceError(400, 'print_template_title_required')
  const at = now.toISOString()
  return db.insert(printTemplates).values({
    facilityId: input.scope === 'all' ? null : actor.facilityId,
    title: title.slice(0, 200),
    category: categoryOf(input.category),
    mimeType,
    size: file.data.length,
    data: file.data,
    uploadedBy: actor.id,
    uploadedAt: at,
    updatedAt: at,
  }).returning({ id: printTemplates.id }).get().id
}

/** The templates the facility sees, by category and title (alphabetical). */
export function listTemplates(db: Db, viewer: { role: SessionUser['role']; facilityId: number }): PrintTemplateDto[] {
  const rows = db.select({
    id: printTemplates.id, facilityId: printTemplates.facilityId, title: printTemplates.title, category: printTemplates.category,
    size: printTemplates.size, uploadedAt: printTemplates.uploadedAt, updatedAt: printTemplates.updatedAt,
  }).from(printTemplates).where(visibleIn(viewer.facilityId)).orderBy(asc(printTemplates.id)).all()
  return rows
    .sort((a, b) => a.category.localeCompare(b.category, 'de') || a.title.localeCompare(b.title, 'de') || a.id - b.id)
    .map(row => ({
      id: row.id,
      title: row.title,
      category: row.category,
      global: row.facilityId === null,
      size: row.size,
      uploadedAt: row.uploadedAt,
      updatedAt: row.updatedAt,
      canEdit: mayEdit(viewer.role, row),
    }))
}

/** The PDF, named after its title; another facility's template is 404 print_template_not_found. */
export function readTemplateFile(db: Db, facilityId: number, id: number): { data: Buffer; mimeType: string; fileName: string } {
  const row = db.select({ data: printTemplates.data, mimeType: printTemplates.mimeType, title: printTemplates.title })
    .from(printTemplates).where(and(eq(printTemplates.id, id), visibleIn(facilityId))).get()
  if (!row) throw new ServiceError(404, 'print_template_not_found')
  return { data: row.data, mimeType: row.mimeType, fileName: `${safeFileNamePart(row.title) || 'Vorlage'}.pdf` }
}

/** A template the actor sees (else 404 print_template_not_found) and may change (else 403 forbidden). */
function loadEditable(db: Db, actor: TemplateActor, id: number): void {
  const row = db.select({ facilityId: printTemplates.facilityId }).from(printTemplates).where(eq(printTemplates.id, id)).get()
  if (!row || (row.facilityId !== null && row.facilityId !== actor.facilityId)) throw new ServiceError(404, 'print_template_not_found')
  if (!mayEdit(actor.role, row)) throw new ServiceError(403, 'forbidden')
}

/** Renames the template and moves it to another category; the file stays. */
export function updateTemplate(db: Db, actor: TemplateActor, id: number, meta: PrintTemplateMeta, now: Date = new Date()): void {
  loadEditable(db, actor, id)
  const title = meta.title.trim()
  if (title === '') throw new ServiceError(400, 'print_template_title_required')
  db.update(printTemplates).set({ title, category: categoryOf(meta.category), updatedAt: now.toISOString() })
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
