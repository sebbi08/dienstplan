import { and, desc, eq, inArray } from 'drizzle-orm'
import { isValidIsoDate } from '../../shared/domain/dates'
import { can, type PermissionKey } from '../../shared/domain/permissions'
import { EMPLOYEE_DOCUMENT_FOLDERS, FOLDER_PERMISSION, type EmployeeDocumentFolder } from '../../shared/domain/personnel'
import type { IsoDate } from '../../shared/domain/types'
import type { EmployeeDocumentDto, EmployeeDocumentMeta, EmployeeDocumentsDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employeeDocuments, employees, users } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { safeFileNamePart } from '../lib/fileName'
import { DOCUMENT_EXTENSIONS, checkedDocumentFile, type DocumentMime } from '../lib/fileSignature'
import { assertEmployee } from './employees'

/**
 * The „Dokumente“ tab of the personnel file (spec Personalakte §5): PDF, JPEG and PNG files in folders, stored like the
 * child documents (in the database, the type judged by the first bytes, the same size limit). Each folder has its own
 * key (FOLDER_PERMISSION) to see, upload, change and delete its documents: without it the folder is absent from the
 * list and its documents are 403 forbidden. The routes ask for employees.view; an employee or document of another
 * facility is 404. Nothing of it reaches the my/* pages or the tablet.
 */

/** Whoever works with the documents: the session user (id for „hochgeladen von“, the permissions for the folders). */
export interface DocumentActor {
  id: number
  permissions: ReadonlySet<PermissionKey>
}

/** Every column except the file itself: lists must never pull the bytes out of the database. */
const META_COLUMNS = {
  id: employeeDocuments.id,
  employeeId: employeeDocuments.employeeId,
  folder: employeeDocuments.folder,
  title: employeeDocuments.title,
  documentDate: employeeDocuments.documentDate,
  note: employeeDocuments.note,
  mimeType: employeeDocuments.mimeType,
  size: employeeDocuments.size,
  uploadedBy: employeeDocuments.uploadedBy,
  uploadedAt: employeeDocuments.uploadedAt,
}

type MetaRow = {
  id: number; employeeId: number; folder: EmployeeDocumentFolder; title: string; documentDate: string | null; note: string
  mimeType: string; size: number; uploadedBy: number | null; uploadedAt: string
}

const mayUse = (actor: DocumentActor, folder: EmployeeDocumentFolder) => can(actor.permissions, FOLDER_PERMISSION[folder])

function assertFolder(actor: DocumentActor, folder: EmployeeDocumentFolder): void {
  if (!mayUse(actor, folder)) throw new ServiceError(403, 'forbidden')
}

/** The document day; every write sets one, the column is only nullable like the child documents'. */
const dayOf = (row: { documentDate: string | null; uploadedAt: string }): IsoDate => row.documentDate ?? row.uploadedAt.slice(0, 10)

/** Folder kept, title and note trimmed, a real date (400 invalid_date). */
function checkedMeta(meta: EmployeeDocumentMeta): EmployeeDocumentMeta {
  if (!isValidIsoDate(meta.documentDate)) throw new ServiceError(400, 'invalid_date')
  return { folder: meta.folder, title: meta.title.trim(), documentDate: meta.documentDate, note: meta.note.trim() }
}

/**
 * A new document in a folder the actor may use (403 forbidden) of an employee of the facility (404
 * employee_not_found); returns its id. The stored type is the detected one (400 document_type_invalid, 413
 * document_too_large).
 */
export function uploadEmployeeDocument(
  db: Db, actor: DocumentActor, facilityId: number, employeeId: number, meta: EmployeeDocumentMeta,
  file: { data: Buffer; filename: string }, now: Date = new Date(),
): number {
  assertEmployee(db, facilityId, employeeId)
  assertFolder(actor, meta.folder)
  const mimeType = checkedDocumentFile(file.data)
  const checked = checkedMeta(meta)
  return db.insert(employeeDocuments).values({
    employeeId, ...checked, mimeType, size: file.data.length, data: file.data, uploadedBy: actor.id, uploadedAt: now.toISOString(),
  }).returning({ id: employeeDocuments.id }).get().id
}

/** The employee's documents in the folders the actor may use, newest document date first (404 employee_not_found). */
export function listEmployeeDocuments(db: Db, actor: DocumentActor, facilityId: number, employeeId: number): EmployeeDocumentsDto {
  assertEmployee(db, facilityId, employeeId)
  const folders = EMPLOYEE_DOCUMENT_FOLDERS.filter(folder => mayUse(actor, folder))
  if (folders.length === 0) return {}
  const rows: MetaRow[] = db.select(META_COLUMNS).from(employeeDocuments)
    .where(and(eq(employeeDocuments.employeeId, employeeId), inArray(employeeDocuments.folder, folders)))
    .orderBy(desc(employeeDocuments.documentDate), desc(employeeDocuments.id)).all()
  const uploaderIds = [...new Set(rows.map(row => row.uploadedBy).filter((id): id is number => id !== null))]
  const usernames = new Map(uploaderIds.length === 0 ? [] : db.select({ id: users.id, username: users.username }).from(users)
    .where(inArray(users.id, uploaderIds)).all().map(user => [user.id, user.username]))
  const toDto = (row: MetaRow): EmployeeDocumentDto => ({
    id: row.id, folder: row.folder, title: row.title, documentDate: dayOf(row), note: row.note, mimeType: row.mimeType,
    size: row.size, uploadedBy: row.uploadedBy === null ? null : usernames.get(row.uploadedBy) ?? null, uploadedAt: row.uploadedAt,
  })
  return Object.fromEntries(folders.map(folder => [folder, rows.filter(row => row.folder === folder).map(toDto)]))
}

/**
 * The document of an employee of the facility (else 404 document_not_found, so another facility's ids stay
 * unconfirmed) in a folder the actor may use (else 403 forbidden).
 */
function loadDocument(db: Db, actor: DocumentActor, facilityId: number, id: number): MetaRow & { employeeName: string } {
  const row = db.select({ ...META_COLUMNS, facilityId: employees.facilityId, employeeName: employees.name })
    .from(employeeDocuments).innerJoin(employees, eq(employees.id, employeeDocuments.employeeId))
    .where(eq(employeeDocuments.id, id)).get()
  if (!row || row.facilityId !== facilityId) throw new ServiceError(404, 'document_not_found')
  assertFolder(actor, row.folder)
  return row
}

/** The file with its stored type, its size and a download name `<employee>-<title>-<date>.<ext>`. */
export function readEmployeeDocumentFile(
  db: Db, actor: DocumentActor, facilityId: number, id: number,
): { data: Buffer; mimeType: string; size: number; fileName: string } {
  const row = loadDocument(db, actor, facilityId, id)
  const { data } = db.select({ data: employeeDocuments.data }).from(employeeDocuments).where(eq(employeeDocuments.id, id)).get()!
  const extension = DOCUMENT_EXTENSIONS[row.mimeType as DocumentMime] ?? 'bin'
  const base = [row.employeeName, row.title, dayOf(row)].map(safeFileNamePart).filter(part => part !== '').join('-')
  return { data, mimeType: row.mimeType, size: data.length, fileName: `${base || 'Dokument'}.${extension}` }
}

/**
 * Changes folder, title, date and note; the file stays as uploaded. Moving to another folder needs the right for both
 * folders (403 forbidden).
 */
export function updateEmployeeDocument(
  db: Db, actor: DocumentActor, facilityId: number, id: number, meta: EmployeeDocumentMeta,
): void {
  loadDocument(db, actor, facilityId, id)
  assertFolder(actor, meta.folder)
  const checked = checkedMeta(meta)
  db.update(employeeDocuments).set(checked).where(eq(employeeDocuments.id, id)).run()
}

/** Deletes the document; the route runs the WAL checkpoint afterwards, so the bytes leave the files at once. */
export function deleteEmployeeDocument(db: Db, actor: DocumentActor, facilityId: number, id: number): void {
  loadDocument(db, actor, facilityId, id)
  db.delete(employeeDocuments).where(eq(employeeDocuments.id, id)).run()
}
