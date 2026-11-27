import { createHash } from 'node:crypto'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { isValidIsoDate, todayIso } from '../../shared/domain/dates'
import { can } from '../../shared/domain/permissions'
import { FOLDER_PERMISSION, type EmployeeDocumentFolder } from '../../shared/domain/personnel'
import { seesTemplateCategory, type TemplateVisibility } from '../../shared/domain/templateCategories'
import {
  DECLINE_REASON_MAX, SIGN_REQUEST_MAX_RECIPIENTS, SIGN_REQUEST_NOTE_MAX, SIGN_REQUEST_TITLE_MAX, isOverdue, signedDocumentTitle,
} from '../../shared/domain/signRequests'
import type { IsoDate } from '../../shared/domain/types'
import type { MySignRequestsDto, SignRequestDto, SignRequestRecipientDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employeeDocuments, employees, requiredDocumentTypes, signRequestRecipients, signRequests, users } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { safeFileNamePart } from '../lib/fileName'
import { checkedDocumentFile } from '../lib/fileSignature'
import { fillableFile } from '../lib/pdfForm'
import { listTemplates, readTemplateFile, templateVisibility, type TemplateViewer } from './printTemplates'
import { inspectionFileIds } from './employeeDocuments'
import { checkedSignRequestType } from './requiredDocuments'
import { removeSignRequest } from './signRequestRecords'

/**
 * „Zum Unterschreiben senden“ (docs/BETRIEB.md): whoever holds signRequests.manage (Leitung and Träger by default) sends
 * a PDF – a template of „Zum Ausdrucken“ or a document of a personnel file, possibly filled in before – to employees of the
 * facility. The PDF is kept as it was sent (every recipient signs exactly that version; its SHA-256 stays as the record).
 * An employee signs it in the app, with the own account or at the facility's tablet with their PIN (server/services/
 * signUnlock.ts), with a drawn signature (a simple electronic signature): the signed copy – the sent PDF with pdf.js's
 * incremental update appended, nothing else is accepted – becomes a document of their personnel file in the request's
 * folder, its SHA-256 is kept with the recipient. Or they decline with a reason. The sender reminds, withdraws and
 * removes requests (removeSignRequest keeps the records of signatures and declines). An employee sees only their own
 * requests; a sender sees the facility's requests whose folders they may use (the folder of the signed copies and, for
 * a personnel document, the folder it came from) and, for a template, that they see the template.
 */

/** Whoever sends and follows requests: the session user of the active facility. */
export type SignSender = TemplateViewer & { id: number }

/** Who signs: the employee (with the own account, or at the tablet with their PIN) and the account to name as uploader. */
export interface Signer {
  employeeId: number
  /** The account that signs, or null at the tablet (then the employee's own account, if any, is named as uploader). */
  userId: number | null
  /** At the tablet: only requests of the tablet's facility. */
  facilityId?: number
}

export interface SignRequestInput {
  title: string
  sourceKind: 'template' | 'document'
  sourceId: number
  recipientIds: number[]
  folder: EmployeeDocumentFolder
  dueDate: IsoDate | null
  note: string
  /** „Als Pflichtdokument … ablegen“: the signed copies are linked to this type (of the facility, in `folder`). */
  requiredTypeId?: number | null
}

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')
/** pdf.js saves by appending an incremental update: the saved file starts with exactly the bytes it opened. */
const extends_ = (file: Buffer, original: Buffer, strictlyLonger: boolean) =>
  (strictlyLonger ? file.length > original.length : file.length >= original.length) && file.subarray(0, original.length).equals(original)

function assertSender(sender: SignSender): void {
  if (!can(sender.permissions, 'signRequests.manage')) throw new ServiceError(403, 'forbidden')
}

type Source = { data: Buffer; employeeId: number | null; folder: EmployeeDocumentFolder | null; visibility: TemplateVisibility | null }

/** The source PDF: a template the sender sees, or a PDF of a personnel file in a folder they may use (with its employee). */
function sourceFile(db: Db, sender: SignSender, kind: 'template' | 'document', id: number): Source {
  if (kind === 'template') {
    return { data: readTemplateFile(db, sender, id).data, employeeId: null, folder: null, visibility: templateVisibility(db, sender, id) }
  }
  const row = db.select({ employeeId: employeeDocuments.employeeId, folder: employeeDocuments.folder, mimeType: employeeDocuments.mimeType, facilityId: employees.facilityId })
    .from(employeeDocuments).innerJoin(employees, eq(employees.id, employeeDocuments.employeeId))
    .where(eq(employeeDocuments.id, id)).get()
  if (!row || row.facilityId !== sender.facilityId) throw new ServiceError(404, 'document_not_found')
  if (!can(sender.permissions, FOLDER_PERMISSION[row.folder])) throw new ServiceError(403, 'forbidden')
  if (row.mimeType !== 'application/pdf') throw new ServiceError(400, 'document_type_invalid')
  // A file that must not be kept is not sent around either (only deleted).
  if (inspectionFileIds(db, [id]).size > 0) throw new ServiceError(400, 'document_inspection_file')
  const { data } = db.select({ data: employeeDocuments.data }).from(employeeDocuments).where(eq(employeeDocuments.id, id)).get()!
  return { data, employeeId: row.employeeId, folder: row.folder, visibility: null }
}

/**
 * Sends a request (returns its id). `file`: the PDF as filled in before sending (else the source as it is); it must be a
 * PDF (400 document_type_invalid, 413 document_too_large) that extends the source (pdf.js's incremental save; else 400
 * signed_file_mismatch). The recipients are employees of the facility who have not left (400 invalid_recipients); a
 * personnel document goes only to its own employee. The folder of the signed copies must be one the sender may use
 * (403 forbidden).
 */
export function createSignRequest(
  db: Db, sender: SignSender, input: SignRequestInput, file: Buffer | null, now: Date = new Date(),
): number {
  assertSender(sender)
  const title = input.title.trim()
  const note = input.note.trim()
  if (title === '' || title.length > SIGN_REQUEST_TITLE_MAX || note.length > SIGN_REQUEST_NOTE_MAX) throw new ServiceError(400, 'invalid_input')
  if (input.dueDate !== null && !isValidIsoDate(input.dueDate)) throw new ServiceError(400, 'invalid_date')
  if (!can(sender.permissions, FOLDER_PERMISSION[input.folder])) throw new ServiceError(403, 'forbidden')
  const requiredTypeId = checkedSignRequestType(db, sender, sender.facilityId, input.requiredTypeId ?? null, input.folder)
  const recipientIds = [...new Set(input.recipientIds)]
  if (recipientIds.length === 0 || recipientIds.length > SIGN_REQUEST_MAX_RECIPIENTS) throw new ServiceError(400, 'invalid_recipients')
  const source = sourceFile(db, sender, input.sourceKind, input.sourceId)
  if (source.employeeId !== null && (recipientIds.length !== 1 || recipientIds[0] !== source.employeeId)) {
    throw new ServiceError(400, 'invalid_recipients')
  }
  const today = todayIso(now)
  const staff = db.select({ id: employees.id, leftOn: employees.leftOn }).from(employees)
    .where(and(eq(employees.facilityId, sender.facilityId), inArray(employees.id, recipientIds))).all()
  if (staff.length !== recipientIds.length || staff.some(person => person.leftOn !== null && person.leftOn < today)) {
    throw new ServiceError(400, 'invalid_recipients')
  }
  const data = file ?? source.data
  checkedDocumentFile(data, ['application/pdf'])
  if (file && !extends_(file, source.data, false)) throw new ServiceError(400, 'signed_file_mismatch')
  return db.transaction((tx) => {
    const id = tx.insert(signRequests).values({
      facilityId: sender.facilityId, createdBy: sender.id, createdAt: now.toISOString(), title, sourceKind: input.sourceKind,
      sourceTemplateId: input.sourceKind === 'template' ? input.sourceId : null,
      sourceDocumentId: input.sourceKind === 'document' ? input.sourceId : null,
      sourceFolder: source.folder, sourceVisibility: source.visibility, sourceEmployeeId: source.employeeId,
      fileData: data, fileSize: data.length, fileSha256: sha256(data), targetFolder: input.folder, dueDate: input.dueDate, note, requiredTypeId,
    }).returning({ id: signRequests.id }).get().id
    tx.insert(signRequestRecipients).values(recipientIds.map(employeeId => ({ requestId: id, employeeId }))).run()
    return id
  })
}

type RequestAccess = {
  facilityId: number; targetFolder: EmployeeDocumentFolder; sourceFolder: EmployeeDocumentFolder | null
  sourceKind: 'template' | 'document'; sourceTemplateId: number | null; sourceVisibility: TemplateVisibility | null; deletedAt: string | null
}

/**
 * Whether the sender may see the request: the facility's, not removed, the folder of the signed copies and (for a
 * personnel document) the folder it came from usable, and for a template the template visible to them – once it is
 * deleted, the visibility it had when the request was sent.
 */
function mayView(sender: SignSender, row: RequestAccess, visibleTemplates: () => ReadonlySet<number>): boolean {
  if (row.facilityId !== sender.facilityId || row.deletedAt !== null) return false
  if (!can(sender.permissions, FOLDER_PERMISSION[row.targetFolder])) return false
  if (row.sourceFolder !== null && !can(sender.permissions, FOLDER_PERMISSION[row.sourceFolder])) return false
  if (row.sourceKind !== 'template') return true
  if (row.sourceTemplateId !== null) return visibleTemplates().has(row.sourceTemplateId)
  return row.sourceVisibility === null || seesTemplateCategory(sender.role, row.sourceVisibility)
}

const ACCESS_COLUMNS = {
  facilityId: signRequests.facilityId, targetFolder: signRequests.targetFolder, sourceFolder: signRequests.sourceFolder,
  sourceKind: signRequests.sourceKind, sourceTemplateId: signRequests.sourceTemplateId, sourceVisibility: signRequests.sourceVisibility,
  deletedAt: signRequests.deletedAt,
}

/** The templates the sender sees (once per call). */
const templatesSeenBy = (db: Db, sender: SignSender) => {
  let ids: Set<number> | null = null
  return () => (ids ??= new Set(listTemplates(db, sender).map(template => template.id)))
}

/** A request the sender may see (404 sign_request_not_found otherwise, also for one of another facility). */
function loadRequest(db: Db, sender: SignSender, id: number) {
  assertSender(sender)
  const row = db.select({ id: signRequests.id, title: signRequests.title, ...ACCESS_COLUMNS }).from(signRequests).where(eq(signRequests.id, id)).get()
  if (!row || !mayView(sender, row, templatesSeenBy(db, sender))) throw new ServiceError(404, 'sign_request_not_found')
  return row
}

/** The requests the sender may see, newest first. */
function visibleRequests(db: Db, sender: SignSender) {
  assertSender(sender)
  const seen = templatesSeenBy(db, sender)
  return db.select({
    id: signRequests.id, title: signRequests.title, createdAt: signRequests.createdAt, createdBy: users.username,
    dueDate: signRequests.dueDate, note: signRequests.note, fileSize: signRequests.fileSize, ...ACCESS_COLUMNS,
  }).from(signRequests).leftJoin(users, eq(users.id, signRequests.createdBy))
    .where(and(eq(signRequests.facilityId, sender.facilityId), isNull(signRequests.deletedAt)))
    .orderBy(desc(signRequests.createdAt), desc(signRequests.id)).all()
    .filter(row => mayView(sender, row, seen))
}

/**
 * The requests the sender may see, newest first, each with its recipients (name, status, when, reason). For a signed
 * one: the copy is linked when the viewer may use the folder it is in now; „copyModified“ when its file no longer has the
 * SHA-256 kept at signing (replaced via „Bearbeiten“, which sets a new upload time), „copyDeleted“ when it is gone,
 * „copyInspectionOnly“ while it is a file that must not be kept (its type is „nur Einsicht vermerken“: filed unlinked,
 * on the cleanup list).
 */
export function listSignRequests(db: Db, sender: SignSender, today: IsoDate): SignRequestDto[] {
  const requests = visibleRequests(db, sender)
  if (requests.length === 0) return []
  const recipients = db.select({
    id: signRequestRecipients.id, requestId: signRequestRecipients.requestId, employeeId: signRequestRecipients.employeeId,
    name: employees.name, status: signRequestRecipients.status, signedAt: signRequestRecipients.signedAt,
    declinedAt: signRequestRecipients.declinedAt, declineReason: signRequestRecipients.declineReason,
    withdrawnAt: signRequestRecipients.withdrawnAt, remindedAt: signRequestRecipients.remindedAt,
    signedDocumentId: signRequestRecipients.signedDocumentId, signedHash: signRequestRecipients.signedHash,
  }).from(signRequestRecipients).innerJoin(employees, eq(employees.id, signRequestRecipients.employeeId))
    .where(inArray(signRequestRecipients.requestId, requests.map(request => request.id))).all()
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
  const documentIds = recipients.flatMap(recipient => (recipient.signedDocumentId === null ? [] : [recipient.signedDocumentId]))
  const copies = new Map(documentIds.length === 0 ? [] : db.select({
    id: employeeDocuments.id, folder: employeeDocuments.folder, uploadedAt: employeeDocuments.uploadedAt,
  }).from(employeeDocuments).where(inArray(employeeDocuments.id, documentIds)).all().map(row => [row.id, row]))
  const notKept = inspectionFileIds(db, [...copies.keys()])
  /** Only a copy uploaded again since the signature can differ; its file is read and hashed then. */
  const modified = (documentId: number, signedAt: string | null, hash: string | null) => {
    const copy = copies.get(documentId)
    if (!copy || copy.uploadedAt === signedAt || hash === null) return false
    const { data } = db.select({ data: employeeDocuments.data }).from(employeeDocuments).where(eq(employeeDocuments.id, documentId)).get()!
    return sha256(data) !== hash
  }
  return requests.map((request) => {
    const own = recipients.filter(recipient => recipient.requestId === request.id)
    const list: SignRequestRecipientDto[] = own.map(({ requestId: _request, signedDocumentId, ...recipient }) => {
      const copy = signedDocumentId === null ? undefined : copies.get(signedDocumentId)
      return {
        ...recipient,
        signedDocumentId: copy && can(sender.permissions, FOLDER_PERMISSION[copy.folder]) ? copy.id : null,
        copyModified: signedDocumentId !== null && modified(signedDocumentId, recipient.signedAt, recipient.signedHash),
        copyDeleted: recipient.status === 'signed' && (signedDocumentId === null || !copy),
        ...(copy && notKept.has(copy.id) ? { copyInspectionOnly: true as const } : {}),
      }
    })
    const { facilityId: _f, sourceFolder: _s, sourceTemplateId: _t, sourceVisibility: _v, deletedAt: _d, ...rest } = request
    return { ...rest, recipients: list, overdue: own.some(recipient => isOverdue(request.dueDate, today, recipient.status)) }
  })
}

/** How many of the requests the sender may see are overdue (the count at „Mitarbeitende“ and its tab „Unterschriften“). */
export function overdueSignRequestCount(db: Db, sender: SignSender, today: IsoDate): number {
  const requests = visibleRequests(db, sender).filter(request => request.dueDate !== null && request.dueDate < today)
  if (requests.length === 0) return 0
  const open = new Set(db.select({ requestId: signRequestRecipients.requestId }).from(signRequestRecipients)
    .where(and(inArray(signRequestRecipients.requestId, requests.map(request => request.id)), eq(signRequestRecipients.status, 'open'))).all()
    .map(row => row.requestId))
  return requests.filter(request => open.has(request.id)).length
}

/** The PDF as it was sent (the senders' preview), named after the title. */
export function readSignRequestFile(db: Db, sender: SignSender, id: number): { data: Buffer; fileName: string } {
  const request = loadRequest(db, sender, id)
  const { data } = db.select({ data: signRequests.fileData }).from(signRequests).where(eq(signRequests.id, id)).get()!
  if (!data) throw new ServiceError(404, 'sign_request_not_found')
  return { data, fileName: `${safeFileNamePart(request.title) || 'Dokument'}.pdf` }
}

/** The open recipients of the request, or the one asked for when it is open (none: 409 sign_request_closed). */
function openRecipients(db: Db, requestId: number, recipientId: number | null): number[] {
  const rows = db.select({ id: signRequestRecipients.id }).from(signRequestRecipients)
    .where(and(eq(signRequestRecipients.requestId, requestId), eq(signRequestRecipients.status, 'open'),
      recipientId === null ? undefined : eq(signRequestRecipients.id, recipientId))).all()
  if (rows.length === 0) throw new ServiceError(409, 'sign_request_closed')
  return rows.map(row => row.id)
}

/** „Erinnern“: marks the open recipients (or one) as reminded now; the employee's list shows it. Returns how many. */
export function remindSignRequest(db: Db, sender: SignSender, id: number, recipientId: number | null, now: Date = new Date()): number {
  loadRequest(db, sender, id)
  const ids = openRecipients(db, id, recipientId)
  return db.update(signRequestRecipients).set({ remindedAt: now.toISOString() }).where(inArray(signRequestRecipients.id, ids)).run().changes
}

/** „Zurückziehen“: the open recipients (or one) no longer have to sign. Returns how many. */
export function withdrawSignRequest(db: Db, sender: SignSender, id: number, recipientId: number | null, now: Date = new Date()): number {
  loadRequest(db, sender, id)
  const ids = openRecipients(db, id, recipientId)
  return db.update(signRequestRecipients).set({ status: 'withdrawn', withdrawnAt: now.toISOString() })
    .where(inArray(signRequestRecipients.id, ids)).run().changes
}

/**
 * „Anfrage löschen“: the PDF goes, open recipients no longer have to sign; the records of signatures and declines stay
 * (removeSignRequest). The signed copies stay in the personnel files.
 */
export function deleteSignRequest(db: Db, sender: SignSender, id: number, now: Date = new Date()): void {
  loadRequest(db, sender, id)
  db.transaction(tx => removeSignRequest(tx, id, now))
}

// ---- the employee's side ----------------------------------------------------

/** The own account's employee signs (403 no_employee without a linked employee). */
export function accountSigner(user: { id: number; employeeId: number | null }): Signer {
  if (user.employeeId === null) throw new ServiceError(403, 'no_employee')
  return { employeeId: user.employeeId, userId: user.id }
}

/** The employee's open requests (at the tablet only those of its facility), the overdue and reminded first. */
export function listMySignRequests(db: Db, signer: Pick<Signer, 'employeeId' | 'facilityId'>, today: IsoDate): MySignRequestsDto {
  const person = db.select({ name: employees.name }).from(employees).where(eq(employees.id, signer.employeeId)).get()
  if (!person) throw new ServiceError(404, 'employee_not_found')
  const rows = db.select({
    recipientId: signRequestRecipients.id, title: signRequests.title, sentAt: signRequests.createdAt, sentBy: users.username,
    dueDate: signRequests.dueDate, note: signRequests.note, remindedAt: signRequestRecipients.remindedAt, fileSize: signRequests.fileSize,
  }).from(signRequestRecipients).innerJoin(signRequests, eq(signRequests.id, signRequestRecipients.requestId))
    .leftJoin(users, eq(users.id, signRequests.createdBy))
    .where(and(eq(signRequestRecipients.employeeId, signer.employeeId), eq(signRequestRecipients.status, 'open'),
      signer.facilityId === undefined ? undefined : eq(signRequests.facilityId, signer.facilityId)))
    .orderBy(desc(signRequests.createdAt)).all()
  const requests = rows.map(row => ({ ...row, overdue: isOverdue(row.dueDate, today) }))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || Number(b.remindedAt !== null) - Number(a.remindedAt !== null))
  return { employeeName: person.name, requests }
}

/** How many requests the employee still has to sign or decline, and how many of them are overdue (the menu's counts). */
export function mySignRequestCount(db: Db, employeeId: number, today: IsoDate = todayIso()): { count: number; overdue: number } {
  const rows = db.select({ dueDate: signRequests.dueDate }).from(signRequestRecipients)
    .innerJoin(signRequests, eq(signRequests.id, signRequestRecipients.requestId))
    .where(and(eq(signRequestRecipients.employeeId, employeeId), eq(signRequestRecipients.status, 'open'))).all()
  return { count: rows.length, overdue: rows.filter(row => isOverdue(row.dueDate, today)).length }
}

/** The employee's open request (404 sign_request_not_found for another person's, another facility's at the tablet; 409 once closed). */
function loadMine(db: Db, signer: Pick<Signer, 'employeeId' | 'facilityId'>, recipientId: number) {
  const row = db.select({
    requestId: signRequests.id, title: signRequests.title, folder: signRequests.targetFolder, status: signRequestRecipients.status,
    facilityId: signRequests.facilityId, requiredTypeId: signRequests.requiredTypeId,
  }).from(signRequestRecipients).innerJoin(signRequests, eq(signRequests.id, signRequestRecipients.requestId))
    .where(and(eq(signRequestRecipients.id, recipientId), eq(signRequestRecipients.employeeId, signer.employeeId))).get()
  if (!row || (signer.facilityId !== undefined && row.facilityId !== signer.facilityId)) throw new ServiceError(404, 'sign_request_not_found')
  if (row.status !== 'open') throw new ServiceError(409, 'sign_request_closed')
  return row
}

/** The sent PDF of a request (a removed one has none: 409 sign_request_closed). */
function snapshotOf(db: Db, requestId: number): Buffer {
  const { data } = db.select({ data: signRequests.fileData }).from(signRequests).where(eq(signRequests.id, requestId)).get()!
  if (!data) throw new ServiceError(409, 'sign_request_closed')
  return data
}

/** The PDF to sign, as it was sent. */
export function readMySignRequestFile(db: Db, signer: Pick<Signer, 'employeeId' | 'facilityId'>, recipientId: number): { data: Buffer; fileName: string } {
  const row = loadMine(db, signer, recipientId)
  return { data: snapshotOf(db, row.requestId), fileName: `${safeFileNamePart(row.title) || 'Dokument'}.pdf` }
}

/**
 * „Unterschreiben“: the signed PDF (saved in the browser, with the signature and the line „Elektronisch unterschrieben
 * von …“) becomes a document of the employee's personnel file in the request's folder, titled „‹Titel› – unterschrieben
 * am ‹Datum›“, uploaded by the employee's account; its SHA-256 is kept with the recipient. Only a PDF (400
 * document_type_invalid, 413 document_too_large) that is the sent PDF with an update appended (pdf.js's incremental save;
 * any other file 400 signed_file_mismatch). Whether a signature was placed is checked in the browser only (the fill
 * view counts the signature editors still there); the server keeps the original revision inside the file.
 */
export function signMyRequest(
  db: Db, signer: Signer, recipientId: number, file: Buffer, now: Date = new Date(),
): { documentId: number; sha256: string } {
  const row = loadMine(db, signer, recipientId)
  const mimeType = checkedDocumentFile(file, ['application/pdf'])
  if (!extends_(file, snapshotOf(db, row.requestId), true)) throw new ServiceError(400, 'signed_file_mismatch')
  const uploadedBy = signer.userId ?? db.select({ id: users.id }).from(users)
    .where(eq(users.employeeId, signer.employeeId)).get()?.id ?? null
  const hash = sha256(file)
  // Sent „als Pflichtdokument“: the copy is that type's, as long as the type still files into the request's folder. A
  // type switched to „nur Einsicht vermerken“ since (the Führungszeugnis, § 72a Abs. 5 SGB VIII) takes no file: the copy
  // goes into the folder unlinked, marked for deletion (the cleanup list; the sender's list says so).
  const type = row.requiredTypeId === null ? undefined : db.select({
    folder: requiredDocumentTypes.folder, mode: requiredDocumentTypes.mode, certificate: requiredDocumentTypes.certificate,
  }).from(requiredDocumentTypes).where(eq(requiredDocumentTypes.id, row.requiredTypeId)).get()
  const inspectionOnly = type?.mode === 'inspection'
  const requiredTypeId = type && !inspectionOnly && type.folder === row.folder ? row.requiredTypeId : null
  return db.transaction((tx) => {
    const documentId = tx.insert(employeeDocuments).values({
      employeeId: signer.employeeId, folder: row.folder, title: signedDocumentTitle(row.title, now), documentDate: todayIso(now), note: '',
      mimeType, fillable: fillableFile(file, mimeType), size: file.length, data: file, uploadedBy, uploadedAt: now.toISOString(), requiredTypeId,
      ...(inspectionOnly ? { inspectionCleanup: true, inspectionTypeId: row.requiredTypeId, inspectionCertificate: type.certificate } : {}),
    }).returning({ id: employeeDocuments.id }).get().id
    tx.update(signRequestRecipients).set({ status: 'signed', signedAt: now.toISOString(), signedDocumentId: documentId, signedHash: hash })
      .where(and(eq(signRequestRecipients.id, recipientId), eq(signRequestRecipients.status, 'open'))).run()
    return { documentId, sha256: hash }
  })
}

/** „Nicht unterschreiben“ with a reason (1 to 300 characters, else 400 decline_reason_required). */
export function declineMyRequest(db: Db, signer: Signer, recipientId: number, reason: string, now: Date = new Date()): void {
  loadMine(db, signer, recipientId)
  const text = reason.trim()
  if (text === '' || text.length > DECLINE_REASON_MAX) throw new ServiceError(400, 'decline_reason_required')
  db.update(signRequestRecipients).set({ status: 'declined', declinedAt: now.toISOString(), declineReason: text })
    .where(and(eq(signRequestRecipients.id, recipientId), eq(signRequestRecipients.status, 'open'))).run()
}
