import { and, asc, eq, inArray, isNotNull, ne } from 'drizzle-orm'
import { can, type PermissionKey } from '../../shared/domain/permissions'
import { EMPLOYEE_DOCUMENT_FOLDERS, FOLDER_PERMISSION, type EmployeeDocumentFolder } from '../../shared/domain/personnel'
import {
  REQUIRED_DOCUMENT_EXAMPLES, REQUIRED_DOCUMENT_LIMITS, REQUIRED_DOCUMENT_MODES, appliesToEmployee, inspectionDateError, inspectionStatus,
  needsDocument, parseAppliesTo, requiredDocumentStatus, serializeAppliesTo, type RequiredDocumentState,
} from '../../shared/domain/requiredDocuments'
import { QUALIFICATIONS } from '../../shared/domain/staffing/types'
import type { IsoDate } from '../../shared/domain/types'
import type {
  EmployeeRequiredDocumentDto, RequiredDocumentTypeDto, RequiredDocumentTypeInput, RequiredInspectionFileDto, RequiredInspectionInput, Role,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { employeeDocuments, employees, requiredDocumentTypes, requiredInspections, users } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { dayOf, uploadEmployeeDocument } from './employeeDocuments'
import { assertEmployee } from './employees'
import { listTemplates } from './printTemplates'

/**
 * Pflichtdokumente (shared/domain/requiredDocuments.ts): per facility the documents its employees must have in the
 * personnel file, each filed in a folder. Everything follows the folder's key (FOLDER_PERMISSION): a type in a folder
 * the person may not use is left out everywhere (settings, the employee's box, the list, „Was noch fehlt“), so neither
 * its existence nor the status of a person's document leaks. The settings change with settings.facility; the routes
 * read with employees.view. Another facility's type, employee or document is 404. A type „nur Einsicht vermerken“
 * (mode 'inspection', § 72a Abs. 5 SGB VIII) takes no file at all – no upload, link, fill or sign request (400
 * required_type_inspection_only) – only the recorded inspection (recordInspection), with the same folder key.
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
    facilityId, name: example.name, folder: example.folder, validityMonths: example.validityMonths, mode: example.mode, sortOrder,
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
    mode: row.mode,
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
 * malformed is 400 required_type_invalid.
 */
function checkedInput(db: Db, actor: RequiredDocsActor, facilityId: number, input: RequiredDocumentTypeInput, exceptId: number | null) {
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
    active: input.active, mode: input.mode,
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
 */
export function updateRequiredType(db: Db, actor: RequiredDocsActor, facilityId: number, id: number, input: RequiredDocumentTypeInput): void {
  assertEditor(actor)
  loadType(db, actor, facilityId, id)
  const values = checkedInput(db, actor, facilityId, input, id)
  db.transaction((tx) => {
    tx.update(requiredDocumentTypes).set(values).where(eq(requiredDocumentTypes.id, id)).run()
    tx.update(employeeDocuments).set({ requiredTypeId: null })
      .where(and(eq(employeeDocuments.requiredTypeId, id), ne(employeeDocuments.folder, values.folder))).run()
  })
}

/** Deletes a type; its documents stay in the personnel files, without the link (and sign requests lose it too). */
export function deleteRequiredType(db: Db, actor: RequiredDocsActor, facilityId: number, id: number): void {
  assertEditor(actor)
  loadType(db, actor, facilityId, id)
  db.delete(requiredDocumentTypes).where(eq(requiredDocumentTypes.id, id)).run()
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
 * in its type's folder (a link from before a move counts nowhere, so no other folder's status shows).
 */
function newestLinked(db: Db, employeeIds: readonly number[], types: readonly TypeRow[]): Map<string, { id: number; date: IsoDate }> {
  const newest = new Map<string, { id: number; date: IsoDate }>()
  if (employeeIds.length === 0 || types.length === 0) return newest
  const folderOf = new Map(types.filter(type => type.mode === 'file').map(type => [type.id, type.folder]))
  const rows = db.select({
    id: employeeDocuments.id, employeeId: employeeDocuments.employeeId, typeId: employeeDocuments.requiredTypeId, folder: employeeDocuments.folder,
    documentDate: employeeDocuments.documentDate, uploadedAt: employeeDocuments.uploadedAt,
  }).from(employeeDocuments).where(and(inArray(employeeDocuments.employeeId, [...employeeIds]), isNotNull(employeeDocuments.requiredTypeId))).all()
  for (const row of rows) {
    if (folderOf.get(row.typeId!) !== row.folder) continue
    const key = `${row.employeeId}:${row.typeId}`
    const date = dayOf(row)
    const known = newest.get(key)
    if (!known || date > known.date || (date === known.date && row.id > known.id)) newest.set(key, { id: row.id, date })
  }
  return newest
}

/** The recorded inspections per employee and type (`${employeeId}:${typeId}`), of the given types only. */
function inspectionsOf(db: Db, employeeIds: readonly number[], types: readonly TypeRow[]) {
  const ids = types.filter(type => type.mode === 'inspection').map(type => type.id)
  const found = new Map<string, typeof requiredInspections.$inferSelect>()
  if (employeeIds.length === 0 || ids.length === 0) return found
  for (const row of db.select().from(requiredInspections)
    .where(and(inArray(requiredInspections.employeeId, [...employeeIds]), inArray(requiredInspections.typeId, ids))).all()) {
    found.set(`${row.employeeId}:${row.typeId}`, row)
  }
  return found
}

/** The status of a type for an employee: from the newest linked document, or for 'inspection' from the record. */
function stateOf(
  type: TypeRow, employeeId: number, newest: ReturnType<typeof newestLinked>, inspections: ReturnType<typeof inspectionsOf>, today: IsoDate,
) {
  const key = `${employeeId}:${type.id}`
  if (type.mode === 'inspection') return inspectionStatus(type.validityMonths, inspections.get(key) ?? null, today)
  return requiredDocumentStatus(type.validityMonths, newest.get(key)?.date ?? null, today)
}

/** The active types of the facility that apply to the qualification and lie in folders the actor may use. */
const applicableTypes = (types: readonly TypeRow[], actor: Pick<RequiredDocsActor, 'permissions'>, qualification: Parameters<typeof appliesToEmployee>[1]) =>
  types.filter(row => row.active && mayUse(actor, row.folder) && appliesToEmployee(parseAppliesTo(row.appliesTo), qualification))

/**
 * „Pflichtdokumente“ of an employee of the facility (404 employee_not_found): every active type that applies to their
 * qualification, in folders the actor may use (others are left out, not even named), with the status from the newest
 * linked document in the type's folder; the template only if the actor sees it (else no „Ausfüllen“ / „Senden“).
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
      typeId: type.id, name: type.name, folder: type.folder, validityMonths: type.validityMonths, mode: type.mode,
      templateId: type.mode === 'file' && type.templateId !== null && templates.has(type.templateId) ? type.templateId : null,
      state: status.state, date: status.date, expiresOn: status.expiresOn, documentId: linked?.id ?? null,
      inspection: inspection === null
        ? null
        : {
            inspectedOn: inspection.inspectedOn, noRelevantEntry: inspection.noRelevantEntry, recordedAt: inspection.recordedAt,
            recordedBy: inspection.recordedBy === null ? null : recorders.get(inspection.recordedBy) ?? null,
          },
      storedFiles: type.mode === 'inspection'
        ? files.filter(file => file.typeId === type.id).map(file => ({ id: file.id, title: file.title, documentDate: file.documentDate }))
        : [],
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
 * document's (400 required_type_folder_mismatch).
 */
export function linkRequiredDocument(db: Db, actor: RequiredDocsActor, facilityId: number, documentId: number, typeId: number | null): void {
  const row = db.select({ folder: employeeDocuments.folder, facilityId: employees.facilityId }).from(employeeDocuments)
    .innerJoin(employees, eq(employees.id, employeeDocuments.employeeId)).where(eq(employeeDocuments.id, documentId)).get()
  if (!row || row.facilityId !== facilityId) throw new ServiceError(404, 'document_not_found')
  if (!mayUse(actor, row.folder)) throw new ServiceError(403, 'forbidden')
  if (typeId !== null) {
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
): Map<number, { typeId: number; name: string; state: RequiredDocumentState }[]> {
  const types = typesOf(db, facilityId).filter(row => row.active && mayUse(viewer, row.folder))
  const missing = new Map<number, { typeId: number; name: string; state: RequiredDocumentState }[]>()
  if (types.length === 0) return missing
  const staff = db.select({ id: employees.id, qualification: employees.qualification, leftOn: employees.leftOn }).from(employees)
    .where(eq(employees.facilityId, facilityId)).all().filter(person => person.leftOn === null || person.leftOn >= today)
  const newest = newestLinked(db, staff.map(person => person.id), types)
  const inspections = inspectionsOf(db, staff.map(person => person.id), types)
  for (const person of staff) {
    const rows = applicableTypes(types, viewer, person.qualification).flatMap((type) => {
      const state = stateOf(type, person.id, newest, inspections, today).state
      return needsDocument(state) ? [{ typeId: type.id, name: type.name, state }] : []
    })
    missing.set(person.id, rows)
  }
  return missing
}

/** A type „nur Einsicht vermerken“ takes no file (400 required_type_inspection_only). */
function assertFileType(type: TypeRow): void {
  if (type.mode === 'inspection') throw new ServiceError(400, 'required_type_inspection_only')
}

/** The files still linked to the given types „nur Einsicht vermerken“ (an old upload of the Führungszeugnis), per employee. */
function storedInspectionFiles(db: Db, employeeIds: readonly number[], types: readonly TypeRow[]) {
  const folders = new Map(types.filter(type => type.mode === 'inspection').map(type => [type.id, type.folder]))
  if (employeeIds.length === 0 || folders.size === 0) return []
  return db.select({
    id: employeeDocuments.id, employeeId: employeeDocuments.employeeId, typeId: employeeDocuments.requiredTypeId,
    folder: employeeDocuments.folder, title: employeeDocuments.title, documentDate: employeeDocuments.documentDate,
    uploadedAt: employeeDocuments.uploadedAt,
  }).from(employeeDocuments)
    .where(and(inArray(employeeDocuments.employeeId, [...employeeIds]), inArray(employeeDocuments.requiredTypeId, [...folders.keys()]))).all()
    .map(row => ({ ...row, typeId: row.typeId!, documentDate: dayOf(row) }))
}

/**
 * „Einsicht vermerken“: for an employee of the facility (404 employee_not_found) and an active type „nur Einsicht
 * vermerken“ of it (404 required_type_not_found, 400 required_type_not_inspection) in a folder the actor may use (403):
 * the day of inspection (a date, not after today: 400 inspection_date_invalid / inspection_date_future) and whether
 * there is no relevant conviction (§ 72a Abs. 1 SGB VIII), with who recorded it and when. Replaces an earlier record.
 */
export function recordInspection(
  db: Db, actor: RequiredDocsActor, facilityId: number, employeeId: number, typeId: number, input: RequiredInspectionInput,
  today: IsoDate, now: Date = new Date(),
): void {
  const type = loadType(db, actor, facilityId, typeId)
  if (!type.active) throw new ServiceError(404, 'required_type_not_found')
  if (type.mode !== 'inspection') throw new ServiceError(400, 'required_type_not_inspection')
  assertEmployee(db, facilityId, employeeId)
  const error = inspectionDateError(input.inspectedOn, today)
  if (error) throw new ServiceError(400, error)
  const values = { inspectedOn: input.inspectedOn, noRelevantEntry: input.noRelevantEntry, recordedBy: actor.id, recordedAt: now.toISOString() }
  db.insert(requiredInspections).values({ employeeId, typeId, ...values })
    .onConflictDoUpdate({ target: [requiredInspections.employeeId, requiredInspections.typeId], set: values }).run()
}

/** Removes the recorded inspection (a correction), with the same checks as recordInspection; nothing there is fine. */
export function deleteInspection(db: Db, actor: RequiredDocsActor, facilityId: number, employeeId: number, typeId: number): void {
  const type = loadType(db, actor, facilityId, typeId)
  if (type.mode !== 'inspection') throw new ServiceError(400, 'required_type_not_inspection')
  assertEmployee(db, facilityId, employeeId)
  db.delete(requiredInspections).where(and(eq(requiredInspections.employeeId, employeeId), eq(requiredInspections.typeId, typeId))).run()
}

/**
 * The files still kept for types „nur Einsicht vermerken“ (Führungszeugnis uploaded before § 72a Abs. 5 SGB VIII was
 * followed), for „Datenschutz & Löschen“: every employee of the facility, also those who left, only in folders the
 * viewer may use (whoever may delete them), oldest first.
 */
export function storedInspectionFileList(db: Db, viewer: Pick<RequiredDocsActor, 'permissions'>, facilityId: number): RequiredInspectionFileDto[] {
  const types = typesOf(db, facilityId).filter(row => row.mode === 'inspection' && mayUse(viewer, row.folder))
  if (types.length === 0) return []
  const staff = new Map(db.select({ id: employees.id, name: employees.name }).from(employees).where(eq(employees.facilityId, facilityId)).all()
    .map(row => [row.id, row.name]))
  const names = new Map(types.map(type => [type.id, type.name]))
  return storedInspectionFiles(db, [...staff.keys()], types)
    .filter(file => mayUse(viewer, file.folder))
    .map(file => ({
      documentId: file.id, employeeId: file.employeeId, employeeName: staff.get(file.employeeId) ?? '', typeName: names.get(file.typeId) ?? '',
      title: file.title, documentDate: file.documentDate,
    }))
    .sort((a, b) => a.documentDate.localeCompare(b.documentDate) || a.documentId - b.documentId)
}
