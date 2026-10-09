import { and, asc, eq, max } from 'drizzle-orm'
import type { DocumentTypeDto, DocumentTypeInput } from '../../shared/types/api'
import type { Db } from '../db/client'
import { childDocuments, documentTypes } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { uniqueName } from '../lib/uniqueName'

function toDto(row: typeof documentTypes.$inferSelect): DocumentTypeDto {
  return {
    id: row.id, name: row.name, important: row.important, required: row.required,
    confidentialDefault: row.confidentialDefault, sortOrder: row.sortOrder,
  }
}

/** The facility's document types in their order. */
export function listDocumentTypes(db: Db, facilityId: number): DocumentTypeDto[] {
  return db.select().from(documentTypes).where(eq(documentTypes.facilityId, facilityId))
    .orderBy(asc(documentTypes.sortOrder), asc(documentTypes.id)).all().map(toDto)
}

/** The facility's document type; 404 document_type_not_found if it belongs to another facility or does not exist. */
export function assertDocumentType(db: Db, facilityId: number, id: number): DocumentTypeDto {
  const row = db.select().from(documentTypes)
    .where(and(eq(documentTypes.id, id), eq(documentTypes.facilityId, facilityId))).get()
  if (!row) throw new ServiceError(404, 'document_type_not_found')
  return toDto(row)
}

/** Trimmed, non-empty name no other document type of the facility uses (compared case-insensitively, umlauts included). */
function checkedName(db: Db, facilityId: number, name: string, exceptId: number | null = null): string {
  const existing = db.select({ id: documentTypes.id, name: documentTypes.name }).from(documentTypes)
    .where(eq(documentTypes.facilityId, facilityId)).all()
  return uniqueName(existing, name, exceptId, { required: 'document_type_name_required', taken: 'document_type_name_taken' })
}

/** "Required" only makes sense for important types (400 required_needs_important otherwise). */
function checkedFlags(input: DocumentTypeInput): void {
  if (input.required && !input.important) throw new ServiceError(400, 'required_needs_important')
}

/** A new document type at the end of the facility's order (the input's sortOrder is ignored). */
export function createDocumentType(db: Db, facilityId: number, input: DocumentTypeInput): DocumentTypeDto {
  const name = checkedName(db, facilityId, input.name)
  checkedFlags(input)
  const sortOrder = (db.select({ value: max(documentTypes.sortOrder) }).from(documentTypes)
    .where(eq(documentTypes.facilityId, facilityId)).get()?.value ?? -1) + 1
  return toDto(db.insert(documentTypes).values({
    facilityId, name, important: input.important, required: input.required,
    confidentialDefault: input.confidentialDefault, sortOrder,
  }).returning().get())
}

export function updateDocumentType(db: Db, facilityId: number, id: number, input: DocumentTypeInput): DocumentTypeDto {
  assertDocumentType(db, facilityId, id)
  const name = checkedName(db, facilityId, input.name, id)
  checkedFlags(input)
  return toDto(db.update(documentTypes).set({
    name, important: input.important, required: input.required,
    confidentialDefault: input.confidentialDefault, sortOrder: input.sortOrder,
  }).where(eq(documentTypes.id, id)).returning().get())
}

/** Deletes a document type no document uses (409 document_type_in_use otherwise). */
export function deleteDocumentType(db: Db, facilityId: number, id: number): void {
  assertDocumentType(db, facilityId, id)
  if (db.select({ id: childDocuments.id }).from(childDocuments).where(eq(childDocuments.documentTypeId, id)).get()) {
    throw new ServiceError(409, 'document_type_in_use')
  }
  db.delete(documentTypes).where(eq(documentTypes.id, id)).run()
}
