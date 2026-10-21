import { and, desc, eq, inArray } from 'drizzle-orm'
import { childStatus, hiddenFromViewer } from '../../shared/domain/children'
import { isValidIsoDate, todayIso } from '../../shared/domain/dates'
import { isManager, mayEditChildren } from '../../shared/domain/roles'
import type { IsoDate } from '../../shared/domain/types'
import type { ChildDocumentDto, ChildDocumentMeta, DocumentOverviewDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { childDocuments, children, documentTypes, users } from '../db/schema'
import { assertGroupRight, loadChild, loadEditableChild, seesGroup } from '../lib/childRecord'
import type { ChildActor, ChildViewer } from '../lib/childViewer'
import { ServiceError } from '../lib/errors'
import { safeFileNamePart } from '../lib/fileName'
import { DOCUMENT_EXTENSIONS, checkedDocumentFile, type DocumentMime } from '../lib/fileSignature'
import { settleDue } from './childGroupChanges'
import { settleDocumentReview, staleContractTypes, staleRequiredTypes } from './documentReview'
import { assertDocumentType, listDocumentTypes } from './documentTypes'
import { listGroups } from './groups'

/** Every column except the file itself: lists and overviews must never pull the bytes out of the database. */
const META_COLUMNS = {
  id: childDocuments.id,
  childId: childDocuments.childId,
  documentTypeId: childDocuments.documentTypeId,
  title: childDocuments.title,
  documentDate: childDocuments.documentDate,
  confidential: childDocuments.confidential,
  mimeType: childDocuments.mimeType,
  size: childDocuments.size,
  uploadedBy: childDocuments.uploadedBy,
  uploadedAt: childDocuments.uploadedAt,
}

type MetaRow = {
  id: number; childId: number; documentTypeId: number; title: string; documentDate: string | null
  confidential: boolean; mimeType: string; size: number; uploadedBy: number | null; uploadedAt: string
}

/** Confidential documents may only be opened by those who maintain child records. */
const mayOpen = (viewer: ChildViewer, row: { confidential: boolean }) => !row.confidential || mayEditChildren(viewer)

/** The document day; every write requires one, the column is only nullable for historic rows. */
const dayOf = (row: MetaRow): IsoDate => row.documentDate ?? row.uploadedAt.slice(0, 10)

/** Trimmed title, a real date and a document type of the facility. */
function checkedMeta(db: Db, facilityId: number, meta: ChildDocumentMeta): ChildDocumentMeta {
  if (!isValidIsoDate(meta.documentDate)) throw new ServiceError(400, 'invalid_date')
  assertDocumentType(db, facilityId, meta.typeId)
  return { ...meta, title: meta.title.trim() }
}

/** A new document in the child's record; returns its id. The stored type is the detected one, never the claimed one. */
export function uploadDocument(
  db: Db, actor: ChildActor, facilityId: number, childId: number, meta: ChildDocumentMeta,
  file: { data: Buffer; filename: string }, today: IsoDate, now: Date = new Date(),
): number {
  loadEditableChild(db, actor, facilityId, childId, today, now)
  const mimeType = checkedDocumentFile(file.data)
  const checked = checkedMeta(db, facilityId, meta)
  return db.transaction((tx) => {
    // A change whose day has come is applied first: its documents marker is set (or not) before this upload counts.
    settleDue(tx, childId, today, now)
    const id = tx.insert(childDocuments).values({
      childId,
      documentTypeId: checked.typeId,
      title: checked.title,
      documentDate: checked.documentDate,
      confidential: checked.confidential,
      mimeType,
      size: file.data.length,
      data: file.data,
      uploadedBy: actor.id,
      uploadedAt: now.toISOString(),
    }).returning({ id: childDocuments.id }).get().id
    settleDocumentReview(tx, childId)
    return id
  })
}

/**
 * The child's documents, newest document date first. An archived child is only visible to Träger and Leitung, a child
 * the tablet hides or whose group the viewer does not see not at all (404 child_not_found).
 */
export function listDocuments(
  db: Db, viewer: ChildViewer, facilityId: number, childId: number, today: IsoDate = todayIso(),
): ChildDocumentDto[] {
  const child = loadChild(db, facilityId, childId)
  if (childStatus(child, today) === 'archived' && !isManager(viewer.role)) throw new ServiceError(404, 'child_not_found')
  if (hiddenFromViewer(child, viewer.visibility, today)) throw new ServiceError(404, 'child_not_found')
  assertGroupRight(viewer, child.groupId, 'read')
  const rows: MetaRow[] = db.select(META_COLUMNS).from(childDocuments).where(eq(childDocuments.childId, childId))
    .orderBy(desc(childDocuments.documentDate), desc(childDocuments.id)).all()
  if (rows.length === 0) return []
  const typeNames = new Map(db.select({ id: documentTypes.id, name: documentTypes.name }).from(documentTypes)
    .where(eq(documentTypes.facilityId, facilityId)).all().map(type => [type.id, type.name]))
  const uploaderIds = [...new Set(rows.map(row => row.uploadedBy).filter((id): id is number => id !== null))]
  const usernames = new Map(uploaderIds.length === 0 ? [] : db.select({ id: users.id, username: users.username }).from(users)
    .where(inArray(users.id, uploaderIds)).all().map(user => [user.id, user.username]))
  return rows.map(row => ({
    id: row.id,
    typeId: row.documentTypeId,
    typeName: typeNames.get(row.documentTypeId) ?? '',
    // The title of a confidential document can be as revealing as the file itself.
    title: mayOpen(viewer, row) ? row.title : '',
    documentDate: dayOf(row),
    confidential: row.confidential,
    mimeType: row.mimeType,
    size: row.size,
    uploadedBy: row.uploadedBy === null ? null : usernames.get(row.uploadedBy) ?? null,
    uploadedAt: row.uploadedAt,
    canOpen: mayOpen(viewer, row),
  }))
}

/**
 * The file with its stored type and a download name `<type>-<lastName>-<date>.<ext>`. Anything the viewer may not see
 * (another facility, an archived child for non-managers, a child the tablet hides or of a group the viewer does not see,
 * a confidential document without the right) is 404 document_not_found, so nothing reveals that the document exists.
 */
export function readDocumentFile(
  db: Db, viewer: ChildViewer, facilityId: number, id: number, today: IsoDate = todayIso(),
): { data: Buffer; mimeType: string; fileName: string } {
  const row = db.select({
    ...META_COLUMNS, data: childDocuments.data, lastName: children.lastName, entryDate: children.entryDate,
    admissionStatus: children.admissionStatus, leftOn: children.leftOn, facilityId: children.facilityId,
    groupId: children.groupId, typeName: documentTypes.name,
  }).from(childDocuments)
    .innerJoin(children, eq(children.id, childDocuments.childId))
    .innerJoin(documentTypes, eq(documentTypes.id, childDocuments.documentTypeId))
    .where(eq(childDocuments.id, id)).get()
  if (!row || row.facilityId !== facilityId) throw new ServiceError(404, 'document_not_found')
  if (childStatus(row, today) === 'archived' && !isManager(viewer.role)) throw new ServiceError(404, 'document_not_found')
  if (hiddenFromViewer(row, viewer.visibility, today)) throw new ServiceError(404, 'document_not_found')
  assertGroupRight(viewer, row.groupId, 'read', 'document_not_found')
  if (!mayOpen(viewer, row)) throw new ServiceError(404, 'document_not_found')
  const extension = DOCUMENT_EXTENSIONS[row.mimeType as DocumentMime] ?? 'bin'
  const base = [row.typeName, row.lastName, dayOf(row)].map(safeFileNamePart).filter(part => part !== '').join('-')
  return { data: row.data, mimeType: row.mimeType, fileName: `${base || 'Dokument'}.${extension}` }
}

/**
 * The document, which must belong to a child of the facility (404 document_not_found), and its child must not be
 * archived: managers get 409 child_archived, everybody else 404 document_not_found.
 */
function loadEditableDocument(
  db: Db, actor: ChildActor, facilityId: number, id: number, today: IsoDate, now: Date,
): MetaRow {
  const row = db.select({ ...META_COLUMNS, facilityId: children.facilityId }).from(childDocuments)
    .innerJoin(children, eq(children.id, childDocuments.childId))
    .where(eq(childDocuments.id, id)).get()
  if (!row || row.facilityId !== facilityId) throw new ServiceError(404, 'document_not_found')
  try {
    loadEditableChild(db, actor, facilityId, row.childId, today, now)
  }
  catch (error) {
    if (error instanceof ServiceError && error.code === 'child_not_found') throw new ServiceError(404, 'document_not_found')
    throw error
  }
  return row
}

/** Changes type, title, date and confidentiality; the file stays as uploaded. A new type can complete the required ones. */
export function updateDocument(
  db: Db, actor: ChildActor, facilityId: number, id: number, meta: ChildDocumentMeta, today: IsoDate,
  now: Date = new Date(),
): void {
  const { childId } = loadEditableDocument(db, actor, facilityId, id, today, now)
  const checked = checkedMeta(db, facilityId, meta)
  db.transaction((tx) => {
    tx.update(childDocuments).set({
      documentTypeId: checked.typeId, title: checked.title, documentDate: checked.documentDate,
      confidential: checked.confidential,
    }).where(eq(childDocuments.id, id)).run()
    settleDocumentReview(tx, childId)
  })
}

export function deleteDocument(
  db: Db, actor: ChildActor, facilityId: number, id: number, today: IsoDate, now: Date = new Date(),
): void {
  loadEditableDocument(db, actor, facilityId, id, today, now)
  db.delete(childDocuments).where(eq(childDocuments.id, id)).run()
}

/**
 * Active children whose group the viewer sees against the important document types: the newest document per type, and
 * who lacks a required one.
 */
export function documentOverview(db: Db, viewer: ChildViewer, facilityId: number, today: IsoDate): DocumentOverviewDto {
  const types = listDocumentTypes(db, facilityId).filter(type => type.important)
  const kids = db.select().from(children).where(eq(children.facilityId, facilityId)).all()
    .filter(row => childStatus(row, today) === 'active' && seesGroup(viewer.groups, row.groupId))
  const ids = kids.map(row => row.id)
  const documents: MetaRow[] = ids.length === 0 || types.length === 0 ? [] : db.select(META_COLUMNS).from(childDocuments)
    .where(and(inArray(childDocuments.childId, ids), inArray(childDocuments.documentTypeId, types.map(type => type.id))))
    .all()
  const newest = new Map<string, MetaRow>()
  for (const document of documents) {
    const key = `${document.childId}:${document.documentTypeId}`
    const current = newest.get(key)
    if (!current || dayOf(document) > dayOf(current) || (dayOf(document) === dayOf(current) && document.id > current.id)) {
      newest.set(key, document)
    }
  }
  // Per child with a documents marker: the required types without a document uploaded since (also those without any);
  // per child with a contract marker: the care contract type, likewise.
  const staleRequired = staleRequiredTypes(db, facilityId, kids)
  const staleContract = staleContractTypes(db, facilityId, kids)
  const isStale = (childId: number, typeId: number) =>
    (staleRequired.get(childId)?.includes(typeId) ?? false) || (staleContract.get(childId)?.includes(typeId) ?? false)
  const groupRank = new Map(listGroups(db, facilityId).map((group, index) => [group.id, index]))
  const rank = (groupId: number | null) => (groupId === null ? Infinity : groupRank.get(groupId) ?? Infinity)
  kids.sort((a, b) => rank(a.groupId) - rank(b.groupId)
    || a.lastName.localeCompare(b.lastName, 'de') || a.firstName.localeCompare(b.firstName, 'de'))
  return {
    types,
    rows: kids.map((kid) => {
      const cells: DocumentOverviewDto['rows'][number]['cells'] = {}
      for (const type of types) {
        const document = newest.get(`${kid.id}:${type.id}`)
        cells[type.id] = document
          ? { documentId: document.id, documentDate: dayOf(document), canOpen: mayOpen(viewer, document), stale: isStale(kid.id, type.id) }
          : null
      }
      return {
        childId: kid.id,
        name: `${kid.firstName} ${kid.lastName}`,
        groupId: kid.groupId,
        cells,
        missingRequired: types.some(type => type.required && (cells[type.id] === null || cells[type.id]!.stale)),
      }
    }),
  }
}
