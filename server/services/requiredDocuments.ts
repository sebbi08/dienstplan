import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm'
import { can, type PermissionKey } from '../../shared/domain/permissions'
import { EMPLOYEE_DOCUMENT_FOLDERS, FOLDER_PERMISSION, type EmployeeDocumentFolder } from '../../shared/domain/personnel'
import {
  REQUIRED_DOCUMENT_EXAMPLES, REQUIRED_DOCUMENT_FOLDER, REQUIRED_DOCUMENT_LIMITS, REQUIRED_DOCUMENT_MODES, appliesToEmployee, inspectionDateError,
  inspectionStatus, needsDocument, parseAppliesTo, requiredDocumentStatus, serializeAppliesTo, type InspectionLogAction, type RequiredDocumentState,
} from '../../shared/domain/requiredDocuments'
import { QUALIFICATIONS } from '../../shared/domain/staffing/types'
import type { IsoDate } from '../../shared/domain/types'
import type {
  EmployeeMoveResultDto, EmployeeRequiredDocumentDto, InspectionHistoryDto, RequiredDocumentTypeDto, RequiredDocumentTypeInput, RequiredInspectionFileDto,
  RequiredInspectionInput, Role,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { employeeDocuments, employees, requiredDocumentTypes, requiredInspectionLog, requiredInspections, users } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { dayOf, inspectionFileIds, uploadEmployeeDocument } from './employeeDocuments'
import { assertEmployee } from './employees'
import { listTemplates } from './printTemplates'

/**
 * Pflichtdokumente (shared/domain/requiredDocuments.ts): per facility the documents its employees must have in the
 * personnel file, each filed in a folder. Everything follows the folder's key (FOLDER_PERMISSION): a type in a folder
 * the person may not use is left out everywhere (settings, the employee's box, the list, „Was noch fehlt“), so neither
 * its existence nor the status of a person's document leaks. The settings change with settings.facility; the routes
 * read with employees.view. Another facility's type, employee or document is 404. A type „nur Einsicht vermerken“
 * (mode 'inspection', § 72a Abs. 5 SGB VIII) takes no file at all – no upload, link, fill or sign request (400
 * required_type_inspection_only) – only the recorded inspection (recordInspection), with the same folder key. A file
 * kept for such a type (marked: employee_documents.inspection_cleanup, or still linked to it) is listed for deletion
 * until deleted – wherever it is moved – and can only be deleted (no „Bearbeiten“, no link, no request to sign: 400
 * document_inspection_file). A record stays (read only, „Vermerk löschen“ works) when its type is switched back to
 * „Datei“; recording, changing and deleting it is logged with who and when (requiredInspectionLog). Only a type flagged
 * „§ 72a SGB VIII (Führungszeugnis)“ (`certificate`; only the Träger sets or unsets it, renaming changes nothing) gets the
 * law's texts and deadline; its records follow the person to another facility only into such a type there
 * (moveInspectionRecords).
 */

/** Whoever works with the Pflichtdokumente: the session user's id, role (templates) and permissions (folders). */
export interface RequiredDocsActor {
  id: number
  role: Role
  permissions: ReadonlySet<PermissionKey>
}

type TypeRow = typeof requiredDocumentTypes.$inferSelect

const mayUse = (actor: Pick<RequiredDocsActor, 'permissions'>, folder: EmployeeDocumentFolder) => can(actor.permissions, FOLDER_PERMISSION[folder])

/** The facility's types in their order (ties by id). */
const typesOf = (db: Db, facilityId: number): TypeRow[] =>
  db.select().from(requiredDocumentTypes).where(eq(requiredDocumentTypes.facilityId, facilityId))
    .orderBy(asc(requiredDocumentTypes.sortOrder), asc(requiredDocumentTypes.id)).all()

/** Gives a facility the example types (a new facility; existing ones got them from the migration). */
export function seedRequiredDocumentTypes(db: Db, facilityId: number): void {
  db.insert(requiredDocumentTypes).values(REQUIRED_DOCUMENT_EXAMPLES.map((example, sortOrder) => ({
    facilityId, name: example.name, folder: example.folder, validityMonths: example.validityMonths, mode: example.mode,
    certificate: example.certificate, sortOrder,
  }))).run()
}

/** The types of the facility in folders the actor may use, in their order, with the title of a template they see. */
export function listRequiredTypes(db: Db, actor: RequiredDocsActor, facilityId: number): RequiredDocumentTypeDto[] {
  const rows = typesOf(db, facilityId).filter(row => mayUse(actor, row.folder))
  const titles = rows.some(row => row.templateId !== null)
    ? new Map(listTemplates(db, { ...actor, facilityId }).map(template => [template.id, template.title]))
    : new Map<number, string>()
  return rows.map(row => ({
    id: row.id, name: row.name, folder: row.folder, appliesTo: parseAppliesTo(row.appliesTo), validityMonths: row.validityMonths,
    templateId: row.templateId, templateTitle: row.templateId === null ? null : titles.get(row.templateId) ?? null, active: row.active,
    mode: row.mode, certificate: row.certificate,
  }))
}

function assertEditor(actor: Pick<RequiredDocsActor, 'permissions'>): void {
  if (!can(actor.permissions, 'settings.facility')) throw new ServiceError(403, 'forbidden')
}

// In JS, not SQLite's lower(), which only folds ASCII letters (Ä ≠ ä).
const folded = (value: string) => value.trim().toLocaleLowerCase('de')

/**
 * The checked input: a name (1–100 characters, unique regardless of case among the facility's types the actor sees: 409
 * required_type_name_taken – a type in a folder they may not use is not given away), a folder the actor may use (403), the qualifications of the catalog, a validity of 1–240
 * months or none, and a template the actor sees in the facility (400 required_type_template_invalid). Anything else
 * malformed is 400 required_type_invalid. „§ 72a SGB VIII“ (`certificate`; left out: as before) is the Träger's to change
 * (403 required_type_certificate_provider): it decides the retention of the records.
 */
function checkedInput(
  db: Db, actor: RequiredDocsActor, facilityId: number, input: RequiredDocumentTypeInput, exceptId: number | null, wasCertificate = false,
) {
  const certificate = input.certificate ?? wasCertificate
  if (certificate !== wasCertificate && actor.role !== 'provider') throw new ServiceError(403, 'required_type_certificate_provider')
  const name = input.name.trim()
  if (name === '' || name.length > REQUIRED_DOCUMENT_LIMITS.name) throw new ServiceError(400, 'required_type_name_required')
  if (typesOf(db, facilityId).some(row => row.id !== exceptId && mayUse(actor, row.folder) && folded(row.name) === folded(name))) {
    throw new ServiceError(409, 'required_type_name_taken')
  }
  if (!(EMPLOYEE_DOCUMENT_FOLDERS as readonly string[]).includes(input.folder)) throw new ServiceError(400, 'required_type_invalid')
  if (!mayUse(actor, input.folder)) throw new ServiceError(403, 'forbidden')
  const appliesTo = input.appliesTo === 'all' ? 'all' as const : input.appliesTo
  if (appliesTo !== 'all' && (!Array.isArray(appliesTo) || !appliesTo.every(key => (QUALIFICATIONS as readonly string[]).includes(key)))) {
    throw new ServiceError(400, 'required_type_invalid')
  }
  const validity = input.validityMonths
  if (validity !== null && (!Number.isInteger(validity) || validity < 1 || validity > REQUIRED_DOCUMENT_LIMITS.validityMonths)) {
    throw new ServiceError(400, 'required_type_invalid')
  }
  if (!(REQUIRED_DOCUMENT_MODES as readonly string[]).includes(input.mode)) throw new ServiceError(400, 'required_type_invalid')
  // Nothing is filled from a template for a type that keeps no file.
  const templateId = input.mode === 'inspection' ? null : input.templateId
  if (templateId !== null && !listTemplates(db, { ...actor, facilityId }).some(template => template.id === templateId)) {
    throw new ServiceError(400, 'required_type_template_invalid')
  }
  return {
    name, folder: input.folder, appliesTo: serializeAppliesTo(appliesTo), validityMonths: validity, templateId,
    active: input.active, mode: input.mode, certificate,
  }
}

/** A type of the facility (404 required_type_not_found) in a folder the actor may use (403). */
function loadType(db: Db, actor: Pick<RequiredDocsActor, 'permissions'>, facilityId: number, id: number): TypeRow {
  const row = db.select().from(requiredDocumentTypes)
    .where(and(eq(requiredDocumentTypes.id, id), eq(requiredDocumentTypes.facilityId, facilityId))).get()
  if (!row) throw new ServiceError(404, 'required_type_not_found')
  if (!mayUse(actor, row.folder)) throw new ServiceError(403, 'forbidden')
  return row
}

/** A new type at the end of the facility's list; returns its id. */
export function createRequiredType(db: Db, actor: RequiredDocsActor, facilityId: number, input: RequiredDocumentTypeInput): number {
  assertEditor(actor)
  const values = checkedInput(db, actor, facilityId, input, null)
  const last = typesOf(db, facilityId).at(-1)
  return db.insert(requiredDocumentTypes).values({ ...values, facilityId, sortOrder: last ? last.sortOrder + 1 : 0 })
    .returning({ id: requiredDocumentTypes.id }).get().id
}

/**
 * Changes a type. A type moved to another folder keeps only the links of documents in that folder (the others stay in
 * the personnel file, unlinked): a document counts only in its type's folder, so no status of another folder shows.
 * Switched to „nur Einsicht“, its linked files are marked for deletion (they must not be kept; first, so a folder move at
 * the same time cannot drop them); switched back to „Datei“, the files marked for it are regular again. Recorded
 * inspections stay either way (read only under „Datei“, until deleted). What the audit lines and the marked files keep of
 * the type (name, folder, „§ 72a“) follows the change, so it is right once the type is gone.
 */
export function updateRequiredType(db: Db, actor: RequiredDocsActor, facilityId: number, id: number, input: RequiredDocumentTypeInput): void {
  assertEditor(actor)
  const before = loadType(db, actor, facilityId, id)
  const values = checkedInput(db, actor, facilityId, input, id, before.certificate)
  db.transaction((tx) => {
    tx.update(requiredDocumentTypes).set(values).where(eq(requiredDocumentTypes.id, id)).run()
    if (before.mode === 'file' && values.mode === 'inspection') {
      tx.update(employeeDocuments).set({ inspectionCleanup: true, inspectionTypeId: id }).where(eq(employeeDocuments.requiredTypeId, id)).run()
    }
    if (before.mode === 'inspection' && values.mode === 'file') {
      tx.update(employeeDocuments).set({ inspectionCleanup: false, inspectionTypeId: null }).where(eq(employeeDocuments.inspectionTypeId, id)).run()
    }
    tx.update(employeeDocuments).set({ inspectionCertificate: values.certificate }).where(eq(employeeDocuments.inspectionTypeId, id)).run()
    tx.update(requiredInspectionLog).set({ typeName: values.name, folder: values.folder, certificate: values.certificate })
      .where(eq(requiredInspectionLog.typeId, id)).run()
    tx.update(employeeDocuments).set({ requiredTypeId: null })
      .where(and(eq(employeeDocuments.requiredTypeId, id), ne(employeeDocuments.folder, values.folder))).run()
  })
}

/**
 * Deletes a type; its documents stay in the personnel files, without the link (and sign requests lose it too). Its
 * recorded inspections go with it, each with an audit line („mit dem Pflichtdokument gelöscht“); the audit lines stay
 * without the type (listed under Datenschutz & Löschen until the person's retention), named by what they keep of it.
 */
export function deleteRequiredType(db: Db, actor: RequiredDocsActor, facilityId: number, id: number, now: Date = new Date()): void {
  assertEditor(actor)
  const type = loadType(db, actor, facilityId, id)
  db.transaction((tx) => {
    for (const record of tx.select({ employeeId: requiredInspections.employeeId }).from(requiredInspections).where(eq(requiredInspections.typeId, id)).all()) {
      logInspection(tx, actor, record.employeeId, type, 'typeDeleted', now)
    }
    tx.update(requiredInspectionLog).set({ typeName: type.name, folder: type.folder, certificate: type.certificate })
      .where(eq(requiredInspectionLog.typeId, id)).run()
    tx.update(employeeDocuments).set({ inspectionCertificate: type.certificate }).where(eq(employeeDocuments.inspectionTypeId, id)).run()
    tx.delete(requiredDocumentTypes).where(eq(requiredDocumentTypes.id, id)).run()
  })
}

/**
 * ▲/▼: swaps the type with its neighbour among the types the actor sees (those in other folders keep their places; at
 * an end nothing changes); the list is numbered afresh.
 */
export function moveRequiredType(db: Db, actor: RequiredDocsActor, facilityId: number, id: number, direction: 'up' | 'down'): void {
  assertEditor(actor)
  loadType(db, actor, facilityId, id)
  const all = typesOf(db, facilityId)
  const visible = all.filter(row => mayUse(actor, row.folder))
  const index = visible.findIndex(row => row.id === id)
  const neighbour = visible[direction === 'up' ? index - 1 : index + 1]
  if (!neighbour) return
  const at = all.findIndex(row => row.id === id)
  const other = all.indexOf(neighbour)
  const order = [...all]
  ;[order[at], order[other]] = [order[other]!, order[at]!]
  db.transaction((tx) => {
    order.forEach((row, sortOrder) => {
      if (row.sortOrder !== sortOrder) tx.update(requiredDocumentTypes).set({ sortOrder }).where(eq(requiredDocumentTypes.id, row.id)).run()
    })
  })
}

/**
 * The newest linked document per employee and type (by its date, then id), of the given types only, and only if it lies
 * in its type's folder (a link from before a move counts nowhere, so no other folder's status shows) and is not marked
 * for deletion.
 */
function newestLinked(db: Db, employeeIds: readonly number[], types: readonly TypeRow[]): Map<string, { id: number; date: IsoDate }> {
  const newest = new Map<string, { id: number; date: IsoDate }>()
  if (employeeIds.length === 0 || types.length === 0) return newest
  const folderOf = new Map(types.filter(type => type.mode === 'file').map(type => [type.id, type.folder]))
  const rows = db.select({
    id: employeeDocuments.id, employeeId: employeeDocuments.employeeId, typeId: employeeDocuments.requiredTypeId, folder: employeeDocuments.folder,
    documentDate: employeeDocuments.documentDate, uploadedAt: employeeDocuments.uploadedAt, cleanup: employeeDocuments.inspectionCleanup,
  }).from(employeeDocuments).where(and(inArray(employeeDocuments.employeeId, [...employeeIds]), isNotNull(employeeDocuments.requiredTypeId))).all()
  for (const row of rows) {
    // A file marked for deletion never counts.
    if (row.cleanup || folderOf.get(row.typeId!) !== row.folder) continue
    const key = `${row.employeeId}:${row.typeId}`
    const date = dayOf(row)
    const known = newest.get(key)
    if (!known || date > known.date || (date === known.date && row.id > known.id)) newest.set(key, { id: row.id, date })
  }
  return newest
}

/**
 * The recorded inspections per employee and type (`${employeeId}:${typeId}`), of the given types only – also of a type
 * switched back to „Datei“ (the record stays until it is deleted).
 */
function inspectionsOf(db: Db, employeeIds: readonly number[], types: readonly TypeRow[]) {
  const ids = types.map(type => type.id)
  const found = new Map<string, typeof requiredInspections.$inferSelect>()
  if (employeeIds.length === 0 || ids.length === 0) return found
  for (const row of db.select().from(requiredInspections)
    .where(and(inArray(requiredInspections.employeeId, [...employeeIds]), inArray(requiredInspections.typeId, ids))).all()) {
    found.set(`${row.employeeId}:${row.typeId}`, row)
  }
  return found
}

/**
 * The status of a type for an employee: from the newest linked document, or for 'inspection' from the record. A record
 * with a relevant entry stays 'entry' after its type was switched back to „Datei“, until it is deleted.
 */
function stateOf(
  type: TypeRow, employeeId: number, newest: ReturnType<typeof newestLinked>, inspections: ReturnType<typeof inspectionsOf>, today: IsoDate,
) {
  const key = `${employeeId}:${type.id}`
  const inspection = inspections.get(key) ?? null
  if (type.mode === 'inspection' || (inspection !== null && !inspection.noRelevantEntry)) return inspectionStatus(type.validityMonths, inspection, today)
  return requiredDocumentStatus(type.validityMonths, newest.get(key)?.date ?? null, today)
}

/** The active types of the facility that apply to the qualification and lie in folders the actor may use. */
const applicableTypes = (types: readonly TypeRow[], actor: Pick<RequiredDocsActor, 'permissions'>, qualification: Parameters<typeof appliesToEmployee>[1]) =>
  types.filter(row => row.active && mayUse(actor, row.folder) && appliesToEmployee(parseAppliesTo(row.appliesTo), qualification))

/**
 * „Pflichtdokumente“ of an employee of the facility (404 employee_not_found): every active type that applies to their
 * qualification, in folders the actor may use (others are left out, not even named), with the status from the newest
 * linked document in the type's folder; the template only if the actor sees it (else no „Ausfüllen“ / „Senden“). Also
 * the recorded inspection (whatever the type's mode now), the files kept for the type that are to be deleted (only in
 * folders the actor may use) and who recorded, changed or deleted the record when.
 */
export function employeeRequiredDocuments(
  db: Db, actor: RequiredDocsActor, facilityId: number, employeeId: number, today: IsoDate,
): EmployeeRequiredDocumentDto[] {
  assertEmployee(db, facilityId, employeeId)
  const { qualification } = db.select({ qualification: employees.qualification }).from(employees).where(eq(employees.id, employeeId)).get()!
  const types = applicableTypes(typesOf(db, facilityId), actor, qualification)
  const newest = newestLinked(db, [employeeId], types)
  const inspections = inspectionsOf(db, [employeeId], types)
  // Only files in folders the actor may use (their titles too).
  const files = storedInspectionFiles(db, [employeeId], types).filter(file => mayUse(actor, file.folder))
  const history = types.length === 0 ? [] : db.select().from(requiredInspectionLog)
    .where(and(eq(requiredInspectionLog.employeeId, employeeId), inArray(requiredInspectionLog.typeId, types.map(type => type.id))))
    .orderBy(desc(requiredInspectionLog.at), desc(requiredInspectionLog.id)).all()
  const recorders = new Map(db.select({ id: users.id, username: users.username, name: employees.name }).from(users)
    .leftJoin(employees, eq(employees.id, users.employeeId))
    .where(inArray(users.id, [...inspections.values()].flatMap(row => (row.recordedBy === null ? [] : [row.recordedBy])).concat(0))).all()
    .map(row => [row.id, row.name ?? row.username]))
  const templates = types.some(type => type.templateId !== null)
    ? new Set(listTemplates(db, { ...actor, facilityId }).map(template => template.id))
    : new Set<number>()
  return types.map((type) => {
    const linked = newest.get(`${employeeId}:${type.id}`) ?? null
    const status = stateOf(type, employeeId, newest, inspections, today)
    const inspection = inspections.get(`${employeeId}:${type.id}`) ?? null
    return {
      typeId: type.id, name: type.name, folder: type.folder, validityMonths: type.validityMonths, mode: type.mode, certificate: type.certificate,
      templateId: type.mode === 'file' && type.templateId !== null && templates.has(type.templateId) ? type.templateId : null,
      state: status.state, date: status.date, expiresOn: status.expiresOn, documentId: linked?.id ?? null,
      inspection: inspection === null
        ? null
        : {
            certificateDate: inspection.certificateDate, inspectedOn: inspection.inspectedOn, noRelevantEntry: inspection.noRelevantEntry, recordedAt: inspection.recordedAt,
            recordedBy: inspection.recordedBy === null ? null : recorders.get(inspection.recordedBy) ?? null,
          },
      storedFiles: files.filter(file => file.typeId === type.id).map(file => ({ id: file.id, title: file.title, documentDate: file.documentDate })),
      history: history.filter(line => line.typeId === type.id).map(line => ({ action: line.action, by: line.actor, at: line.at })),
    }
  })
}

/**
 * „Hochladen“ in the box: a new document of the employee in the type's folder (the folder's key, the file checks of the
 * personnel file), titled as given or after the type, linked to the type (an active type of the facility, 404
 * required_type_not_found). A folder given (the fill view's save of „Ausfüllen“) must be the type's (400
 * required_type_folder_mismatch). Returns the document's id.
 */
export function uploadRequiredDocument(
  db: Db, actor: RequiredDocsActor, facilityId: number, employeeId: number, typeId: number,
  meta: { title: string; documentDate: IsoDate; note: string; folder?: EmployeeDocumentFolder }, file: { data: Buffer; filename: string },
  now: Date = new Date(),
): number {
  const type = loadType(db, actor, facilityId, typeId)
  if (!type.active) throw new ServiceError(404, 'required_type_not_found')
  assertFileType(type)
  if (meta.folder !== undefined && meta.folder !== type.folder) throw new ServiceError(400, 'required_type_folder_mismatch')
  return db.transaction((tx) => {
    const id = uploadEmployeeDocument(tx, actor, facilityId, employeeId, {
      folder: type.folder, title: meta.title.trim() || type.name, documentDate: meta.documentDate, note: meta.note,
    }, file, now)
    tx.update(employeeDocuments).set({ requiredTypeId: type.id }).where(eq(employeeDocuments.id, id)).run()
    return id
  })
}

/**
 * „Vorhandenes Dokument zuordnen“ (or with null: the link removed): a document of an employee of the facility (404
 * document_not_found) in a folder the actor may use (403) becomes the type's – a type of the facility whose folder is the
 * document's (400 required_type_folder_mismatch). A file to be deleted (inspectionFileIds) is linked to nothing any more
 * (400 document_inspection_file); removing its link is fine – its marker keeps it on the cleanup list.
 */
export function linkRequiredDocument(db: Db, actor: RequiredDocsActor, facilityId: number, documentId: number, typeId: number | null): void {
  const row = db.select({ folder: employeeDocuments.folder, facilityId: employees.facilityId }).from(employeeDocuments)
    .innerJoin(employees, eq(employees.id, employeeDocuments.employeeId)).where(eq(employeeDocuments.id, documentId)).get()
  if (!row || row.facilityId !== facilityId) throw new ServiceError(404, 'document_not_found')
  if (!mayUse(actor, row.folder)) throw new ServiceError(403, 'forbidden')
  if (typeId !== null) {
    if (inspectionFileIds(db, [documentId]).size > 0) throw new ServiceError(400, 'document_inspection_file')
    const type = loadType(db, actor, facilityId, typeId)
    assertFileType(type)
    if (type.folder !== row.folder) throw new ServiceError(400, 'required_type_folder_mismatch')
  }
  db.update(employeeDocuments).set({ requiredTypeId: typeId }).where(eq(employeeDocuments.id, documentId)).run()
}

/**
 * The type a sign request files its signed copies as: an active type of the facility in the request's folder (else
 * 400 required_type_folder_mismatch, 404 required_type_not_found); null = none.
 */
export function checkedSignRequestType(
  db: Db, actor: Pick<RequiredDocsActor, 'permissions'>, facilityId: number, typeId: number | null, folder: EmployeeDocumentFolder,
): number | null {
  if (typeId === null) return null
  const type = loadType(db, actor, facilityId, typeId)
  if (!type.active) throw new ServiceError(404, 'required_type_not_found')
  assertFileType(type)
  if (type.folder !== folder) throw new ServiceError(400, 'required_type_folder_mismatch')
  return type.id
}

/**
 * What is missing or expired per active employee of the facility (staff who left before today are skipped): the
 * applicable active types in folders the viewer may use. For the employee list and „Was noch fehlt“.
 */
export function missingRequiredDocuments(
  db: Db, viewer: Pick<RequiredDocsActor, 'permissions'>, facilityId: number, today: IsoDate,
): Map<number, { typeId: number; name: string; state: RequiredDocumentState; certificate: boolean }[]> {
  const types = typesOf(db, facilityId).filter(row => row.active && mayUse(viewer, row.folder))
  const missing = new Map<number, { typeId: number; name: string; state: RequiredDocumentState; certificate: boolean }[]>()
  if (types.length === 0) return missing
  const staff = db.select({ id: employees.id, qualification: employees.qualification, leftOn: employees.leftOn }).from(employees)
    .where(eq(employees.facilityId, facilityId)).all().filter(person => person.leftOn === null || person.leftOn >= today)
  const newest = newestLinked(db, staff.map(person => person.id), types)
  const inspections = inspectionsOf(db, staff.map(person => person.id), types)
  for (const person of staff) {
    const rows = applicableTypes(types, viewer, person.qualification).flatMap((type) => {
      const state = stateOf(type, person.id, newest, inspections, today).state
      return needsDocument(state) ? [{ typeId: type.id, name: type.name, state, certificate: type.certificate }] : []
    })
    missing.set(person.id, rows)
  }
  return missing
}

/** A type „nur Einsicht vermerken“ takes no file (400 required_type_inspection_only). */
function assertFileType(type: TypeRow): void {
  if (type.mode === 'inspection') throw new ServiceError(400, 'required_type_inspection_only')
}

/**
 * The files of the employees that must not be kept: marked (inspection_cleanup – set by the migration, when a type is
 * switched to „nur Einsicht“ and for a signed copy that came in after the switch; it survives moving and unlinking) or
 * still linked to a type „nur Einsicht vermerken“ of `types`. `typeId`: the type it was kept for (null once deleted).
 */
function storedInspectionFiles(db: Db, employeeIds: readonly number[], types: readonly TypeRow[]) {
  if (employeeIds.length === 0) return []
  const inspectionTypes = new Set(types.filter(type => type.mode === 'inspection').map(type => type.id))
  return db.select({
    id: employeeDocuments.id, employeeId: employeeDocuments.employeeId, requiredTypeId: employeeDocuments.requiredTypeId,
    inspectionTypeId: employeeDocuments.inspectionTypeId, cleanup: employeeDocuments.inspectionCleanup,
    keptCertificate: employeeDocuments.inspectionCertificate,
    folder: employeeDocuments.folder, title: employeeDocuments.title, documentDate: employeeDocuments.documentDate,
    uploadedAt: employeeDocuments.uploadedAt,
  }).from(employeeDocuments)
    .where(and(
      inArray(employeeDocuments.employeeId, [...employeeIds]),
      or(eq(employeeDocuments.inspectionCleanup, true), inArray(employeeDocuments.requiredTypeId, [...inspectionTypes])),
    )).all()
    .map(({ requiredTypeId, inspectionTypeId, cleanup, keptCertificate, ...row }) => {
      const typeId = cleanup ? inspectionTypeId : requiredTypeId !== null && inspectionTypes.has(requiredTypeId) ? requiredTypeId : null
      // „§ 72a“: the type's while it exists, else what the marker kept of it.
      const type = typeId === null ? undefined : types.find(entry => entry.id === typeId)
      return { ...row, typeId, certificate: type ? type.certificate : cleanup && keptCertificate, documentDate: dayOf(row) }
    })
}

/**
 * „Einsicht vermerken“: for an employee of the facility (404 employee_not_found) and an active type „nur Einsicht
 * vermerken“ of it (404 required_type_not_found, 400 required_type_not_inspection) in a folder the actor may use (403):
 * the certificate's date (not after today: 400 certificate_date_invalid / certificate_date_future), optionally the day of
 * inspection (the same, inspection_date_*, and not before the certificate: inspection_before_certificate) and whether
 * there is no relevant conviction (§ 72a Abs. 1 SGB VIII) – chosen explicitly every time (anything but true or false: 400
 * inspection_choice_required, never read as an entry) – with who recorded it and when. Replaces an earlier record.
 */
export function recordInspection(
  db: Db, actor: RequiredDocsActor, facilityId: number, employeeId: number, typeId: number, input: RequiredInspectionInput,
  today: IsoDate, now: Date = new Date(),
): void {
  const type = loadType(db, actor, facilityId, typeId)
  if (!type.active) throw new ServiceError(404, 'required_type_not_found')
  if (type.mode !== 'inspection') throw new ServiceError(400, 'required_type_not_inspection')
  assertEmployee(db, facilityId, employeeId)
  if (typeof input.noRelevantEntry !== 'boolean') throw new ServiceError(400, 'inspection_choice_required')
  const error = inspectionDateError(input.certificateDate, input.inspectedOn, today)
  if (error) throw new ServiceError(400, error)
  const values = {
    certificateDate: input.certificateDate, inspectedOn: input.inspectedOn, noRelevantEntry: input.noRelevantEntry,
    recordedBy: actor.id, recordedAt: now.toISOString(),
  }
  db.transaction((tx) => {
    const existed = tx.select({ id: requiredInspections.id }).from(requiredInspections)
      .where(and(eq(requiredInspections.employeeId, employeeId), eq(requiredInspections.typeId, typeId))).get() !== undefined
    tx.insert(requiredInspections).values({ employeeId, typeId, ...values })
      .onConflictDoUpdate({ target: [requiredInspections.employeeId, requiredInspections.typeId], set: values }).run()
    logInspection(tx, actor, employeeId, type, existed ? 'changed' : 'recorded', now)
  })
}

/**
 * „Vermerk löschen“ (a correction, or a record left from before its type was switched back to „Datei“): the checks of
 * recordInspection except the mode and that the type is active; nothing there is fine (and logs nothing).
 */
export function deleteInspection(
  db: Db, actor: RequiredDocsActor, facilityId: number, employeeId: number, typeId: number, now: Date = new Date(),
): void {
  const type = loadType(db, actor, facilityId, typeId)
  assertEmployee(db, facilityId, employeeId)
  db.transaction((tx) => {
    const { changes } = tx.delete(requiredInspections)
      .where(and(eq(requiredInspections.employeeId, employeeId), eq(requiredInspections.typeId, typeId))).run()
    if (changes > 0) logInspection(tx, actor, employeeId, type, 'deleted', now)
  })
}

/**
 * An audit line: who (the account's employee name, else its user name, at the time) and when – nothing of the content –
 * with what it keeps of the type (name, folder, „§ 72a“). `linked` false: written without the type (it is going away).
 */
function logInspection(
  tx: Db, actor: Pick<RequiredDocsActor, 'id'>, employeeId: number, type: TypeRow, action: InspectionLogAction, now: Date, linked = true,
): void {
  const account = tx.select({ username: users.username, name: employees.name }).from(users)
    .leftJoin(employees, eq(employees.id, users.employeeId)).where(eq(users.id, actor.id)).get()
  tx.insert(requiredInspectionLog).values({
    employeeId, typeId: linked && action !== 'typeDeleted' ? type.id : null, action, actor: account?.name ?? account?.username ?? '',
    at: now.toISOString(), typeName: type.name, folder: type.folder, certificate: type.certificate,
  }).run()
}

/**
 * On a move to another facility (moveEmployeeToFacility, in its transaction): the person's inspection records and audit
 * lines belong to the old facility's types. A record goes to an active type „nur Einsicht“ of the new facility that
 * applies to the person and has the same „§ 72a“ – for a Führungszeugnis the one of the same name, else the first; any
 * other only to one of the same name – with its lines and a line „übernommen“. Without such a type (or with that type
 * taken by a newer record) the record is removed – the new facility could not show it, the old one no longer sees the
 * person – and a line „beim Wechsel entfernt“ says so; its lines stay without the type (Datenschutz & Löschen). Returns
 * the removed ones whose folder the mover may use (the move's notice).
 */
export function moveInspectionRecords(
  tx: Db, actor: RequiredDocsActor, employeeId: number, facilityId: number, now: Date,
): EmployeeMoveResultDto['inspectionsRemoved'] {
  const { qualification } = tx.select({ qualification: employees.qualification }).from(employees).where(eq(employees.id, employeeId)).get()!
  const targets = typesOf(tx, facilityId)
    .filter(type => type.mode === 'inspection' && type.active && appliesToEmployee(parseAppliesTo(type.appliesTo), qualification))
  const match = (source: TypeRow) => {
    const same = targets.filter(type => type.certificate === source.certificate)
    return same.find(type => folded(type.name) === folded(source.name)) ?? (source.certificate ? same[0] : undefined)
  }
  const records = tx.select().from(requiredInspections).where(eq(requiredInspections.employeeId, employeeId)).all()
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || b.id - a.id)
  const typeIds = [...new Set([
    ...records.map(record => record.typeId),
    ...tx.select({ typeId: requiredInspectionLog.typeId }).from(requiredInspectionLog)
      .where(and(eq(requiredInspectionLog.employeeId, employeeId), isNotNull(requiredInspectionLog.typeId))).all().map(line => line.typeId!),
  ])]
  const sources = new Map((typeIds.length === 0 ? [] : tx.select().from(requiredDocumentTypes).where(inArray(requiredDocumentTypes.id, typeIds)).all())
    .map(type => [type.id, type]))
  const taken = new Set(records.filter(record => sources.get(record.typeId)?.facilityId === facilityId).map(record => record.typeId))
  /** Where the old type's lines go: the type its record went to (or would go to), else nowhere. */
  const linesTo = new Map<number, TypeRow | null>()
  const removed: EmployeeMoveResultDto['inspectionsRemoved'] = []
  for (const record of records) {
    const source = sources.get(record.typeId)!
    if (source.facilityId === facilityId) continue
    const target = match(source)
    if (target && !taken.has(target.id)) {
      taken.add(target.id)
      linesTo.set(source.id, target)
      tx.update(requiredInspections).set({ typeId: target.id }).where(eq(requiredInspections.id, record.id)).run()
      logInspection(tx, actor, employeeId, target, 'moved', now)
      continue
    }
    linesTo.set(source.id, null)
    tx.delete(requiredInspections).where(eq(requiredInspections.id, record.id)).run()
    logInspection(tx, actor, employeeId, source, 'removedOnMove', now, false)
    if (mayUse(actor, source.folder)) removed.push({ typeName: source.name, certificate: source.certificate })
  }
  for (const source of sources.values()) {
    if (source.facilityId === facilityId) continue
    const target = linesTo.has(source.id) ? linesTo.get(source.id)! : match(source) ?? null
    tx.update(requiredInspectionLog).set(target
      ? { typeId: target.id, typeName: target.name, folder: target.folder, certificate: target.certificate }
      : { typeId: null, typeName: source.name, folder: source.folder, certificate: source.certificate })
      .where(and(eq(requiredInspectionLog.employeeId, employeeId), eq(requiredInspectionLog.typeId, source.id))).run()
  }
  return removed
}

/**
 * The audit lines left without their type (it was deleted, or the record was removed on a move), for „Datenschutz &
 * Löschen“: per person of the given facilities and type name, newest first; only lines of a folder the viewer may use
 * (lines from before the folder was kept count as „Pflichtdokumente“).
 */
export function orphanInspectionHistory(
  db: Db, viewer: Pick<RequiredDocsActor, 'permissions'>, facilities: readonly { id: number; name: string }[],
): InspectionHistoryDto[] {
  return facilities.flatMap((facility) => {
    const staff = new Map(db.select({ id: employees.id, name: employees.name }).from(employees).where(eq(employees.facilityId, facility.id)).all()
      .map(row => [row.id, row.name]))
    if (staff.size === 0) return []
    const groups = new Map<string, InspectionHistoryDto>()
    for (const line of db.select().from(requiredInspectionLog)
      .where(and(inArray(requiredInspectionLog.employeeId, [...staff.keys()]), isNull(requiredInspectionLog.typeId)))
      .orderBy(desc(requiredInspectionLog.at), desc(requiredInspectionLog.id)).all()) {
      if (!mayUse(viewer, line.folder ?? REQUIRED_DOCUMENT_FOLDER)) continue
      const key = `${line.employeeId}:${line.typeName}:${line.certificate}`
      const group = groups.get(key) ?? {
        employeeId: line.employeeId, employeeName: staff.get(line.employeeId) ?? '', facilityId: facility.id, facilityName: facility.name,
        typeName: line.typeName, certificate: line.certificate, lines: [],
      }
      group.lines.push({ action: line.action, by: line.actor, at: line.at })
      groups.set(key, group)
    }
    return [...groups.values()].sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'de') || a.typeName.localeCompare(b.typeName, 'de'))
  })
}

/**
 * The files to be deleted (storedInspectionFiles: a Führungszeugnis uploaded before § 72a Abs. 5 SGB VIII was followed,
 * or a signed copy that came in after the switch), for „Datenschutz & Löschen“: every employee of the given facilities
 * (those the viewer may see), also those who left. Only files in folders the viewer may use – the folder the file lies in
 * now, which is what opening and deleting it needs – so the list never names a file the viewer could not open; the type
 * is named only if the viewer may use its folder too. In the facilities' order, then oldest first. `certificate`: kept
 * for a type „§ 72a“ (the texts name the law) – also once that type is deleted (the marker keeps it).
 */
export function storedInspectionFileList(
  db: Db, viewer: Pick<RequiredDocsActor, 'permissions'>, facilities: readonly { id: number; name: string }[],
): RequiredInspectionFileDto[] {
  return facilities.flatMap((facility) => {
    const types = typesOf(db, facility.id)
    const staff = new Map(db.select({ id: employees.id, name: employees.name }).from(employees).where(eq(employees.facilityId, facility.id)).all()
      .map(row => [row.id, row.name]))
    const named = new Map(types.map(type => [type.id, type]))
    return storedInspectionFiles(db, [...staff.keys()], types)
      .filter(file => mayUse(viewer, file.folder))
      .map((file) => {
        const type = file.typeId === null ? undefined : named.get(file.typeId)
        const typeName = type && mayUse(viewer, type.folder) ? type.name : ''
        return {
          documentId: file.id, employeeId: file.employeeId, employeeName: staff.get(file.employeeId) ?? '', facilityId: facility.id,
          facilityName: facility.name, typeName, certificate: file.certificate, title: file.title, documentDate: file.documentDate,
        }
      })
      .sort((a, b) => a.documentDate.localeCompare(b.documentDate) || a.documentId - b.documentId)
  })
}
