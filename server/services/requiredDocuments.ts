import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm'
import { can, type PermissionKey } from '../../shared/domain/permissions'
import { EMPLOYEE_DOCUMENT_FOLDERS, FOLDER_PERMISSION, type EmployeeDocumentFolder } from '../../shared/domain/personnel'
import {
  REQUIRED_DOCUMENT_EXAMPLES, REQUIRED_DOCUMENT_LIMITS, appliesToEmployee, needsDocument, parseAppliesTo, requiredDocumentStatus,
  serializeAppliesTo, type RequiredDocumentState,
} from '../../shared/domain/requiredDocuments'
import { QUALIFICATIONS } from '../../shared/domain/staffing/types'
import type { IsoDate } from '../../shared/domain/types'
import type {
  EmployeeRequiredDocumentDto, RequiredDocumentTypeDto, RequiredDocumentTypeInput, Role,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { employeeDocuments, employees, requiredDocumentTypes } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { dayOf, uploadEmployeeDocument } from './employeeDocuments'
import { assertEmployee } from './employees'
import { listTemplates } from './printTemplates'

/**
 * Pflichtdokumente (shared/domain/requiredDocuments.ts): per facility the documents its employees must have in the
 * personnel file, each filed in a folder. Everything follows the folder's key (FOLDER_PERMISSION): a type in a folder
 * the person may not use is left out everywhere (settings, the employee's box, the list, „Was noch fehlt“), so neither
 * its existence nor the status of a person's document leaks. The settings change with settings.facility; the routes
 * read with employees.view. Another facility's type, employee or document is 404.
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
    facilityId, name: example.name, folder: example.folder, validityMonths: example.validityMonths, sortOrder,
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
  }))
}

function assertEditor(actor: Pick<RequiredDocsActor, 'permissions'>): void {
  if (!can(actor.permissions, 'settings.facility')) throw new ServiceError(403, 'forbidden')
}

// In JS, not SQLite's lower(), which only folds ASCII letters (Ä ≠ ä).
const folded = (value: string) => value.trim().toLocaleLowerCase('de')

/**
 * The checked input: a name (1–100 characters, unique in the facility regardless of case: 409
 * required_type_name_taken), a folder the actor may use (403), the qualifications of the catalog, a validity of 1–240
 * months or none, and a template the actor sees in the facility (400 required_type_template_invalid). Anything else
 * malformed is 400 required_type_invalid.
 */
function checkedInput(db: Db, actor: RequiredDocsActor, facilityId: number, input: RequiredDocumentTypeInput, exceptId: number | null) {
  const name = input.name.trim()
  if (name === '' || name.length > REQUIRED_DOCUMENT_LIMITS.name) throw new ServiceError(400, 'required_type_name_required')
  if (typesOf(db, facilityId).some(row => row.id !== exceptId && folded(row.name) === folded(name))) {
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
  if (input.templateId !== null && !listTemplates(db, { ...actor, facilityId }).some(template => template.id === input.templateId)) {
    throw new ServiceError(400, 'required_type_template_invalid')
  }
  return {
    name, folder: input.folder, appliesTo: serializeAppliesTo(appliesTo), validityMonths: validity, templateId: input.templateId,
    active: input.active,
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

/** Changes a type; documents linked to it stay linked (also when its folder changes: they keep theirs). */
export function updateRequiredType(db: Db, actor: RequiredDocsActor, facilityId: number, id: number, input: RequiredDocumentTypeInput): void {
  assertEditor(actor)
  loadType(db, actor, facilityId, id)
  db.update(requiredDocumentTypes).set(checkedInput(db, actor, facilityId, input, id)).where(eq(requiredDocumentTypes.id, id)).run()
}

/** Deletes a type; its documents stay in the personnel files, without the link (and sign requests lose it too). */
export function deleteRequiredType(db: Db, actor: RequiredDocsActor, facilityId: number, id: number): void {
  assertEditor(actor)
  loadType(db, actor, facilityId, id)
  db.delete(requiredDocumentTypes).where(eq(requiredDocumentTypes.id, id)).run()
}

/** ▲/▼: swaps the type with its neighbour in the facility's list (at an end nothing changes); the list is numbered afresh. */
export function moveRequiredType(db: Db, actor: RequiredDocsActor, facilityId: number, id: number, direction: 'up' | 'down'): void {
  assertEditor(actor)
  loadType(db, actor, facilityId, id)
  const all = typesOf(db, facilityId)
  const at = all.findIndex(row => row.id === id)
  const other = direction === 'up' ? at - 1 : at + 1
  if (other < 0 || other >= all.length) return
  const order = [...all]
  ;[order[at], order[other]] = [order[other]!, order[at]!]
  db.transaction((tx) => {
    order.forEach((row, sortOrder) => {
      if (row.sortOrder !== sortOrder) tx.update(requiredDocumentTypes).set({ sortOrder }).where(eq(requiredDocumentTypes.id, row.id)).run()
    })
  })
}

/** The newest linked document per employee and type (by its date, then id). */
function newestLinked(db: Db, employeeIds: readonly number[]): Map<string, { id: number; date: IsoDate }> {
  const newest = new Map<string, { id: number; date: IsoDate }>()
  if (employeeIds.length === 0) return newest
  const rows = db.select({
    id: employeeDocuments.id, employeeId: employeeDocuments.employeeId, typeId: employeeDocuments.requiredTypeId,
    documentDate: employeeDocuments.documentDate, uploadedAt: employeeDocuments.uploadedAt,
  }).from(employeeDocuments).where(and(inArray(employeeDocuments.employeeId, [...employeeIds]), isNotNull(employeeDocuments.requiredTypeId))).all()
  for (const row of rows) {
    const key = `${row.employeeId}:${row.typeId}`
    const date = dayOf(row)
    const known = newest.get(key)
    if (!known || date > known.date || (date === known.date && row.id > known.id)) newest.set(key, { id: row.id, date })
  }
  return newest
}

/** The active types of the facility that apply to the qualification and lie in folders the actor may use. */
const applicableTypes = (types: readonly TypeRow[], actor: Pick<RequiredDocsActor, 'permissions'>, qualification: Parameters<typeof appliesToEmployee>[1]) =>
  types.filter(row => row.active && mayUse(actor, row.folder) && appliesToEmployee(parseAppliesTo(row.appliesTo), qualification))

/**
 * „Pflichtdokumente“ of an employee of the facility (404 employee_not_found): every active type that applies to their
 * qualification, in folders the actor may use (others are left out, not even named), with the status from the newest
 * linked document.
 */
export function employeeRequiredDocuments(
  db: Db, actor: RequiredDocsActor, facilityId: number, employeeId: number, today: IsoDate,
): EmployeeRequiredDocumentDto[] {
  assertEmployee(db, facilityId, employeeId)
  const { qualification } = db.select({ qualification: employees.qualification }).from(employees).where(eq(employees.id, employeeId)).get()!
  const newest = newestLinked(db, [employeeId])
  return applicableTypes(typesOf(db, facilityId), actor, qualification).map((type) => {
    const linked = newest.get(`${employeeId}:${type.id}`) ?? null
    const status = requiredDocumentStatus(type.validityMonths, linked?.date ?? null, today)
    return {
      typeId: type.id, name: type.name, folder: type.folder, validityMonths: type.validityMonths, templateId: type.templateId,
      state: status.state, date: status.date, expiresOn: status.expiresOn, documentId: linked?.id ?? null,
    }
  })
}

/**
 * „Hochladen“ in the box: a new document of the employee in the type's folder (the folder's key, the file checks of the
 * personnel file), titled as given or after the type, linked to the type (an active type of the facility, 404
 * required_type_not_found). Returns the document's id.
 */
export function uploadRequiredDocument(
  db: Db, actor: RequiredDocsActor, facilityId: number, employeeId: number, typeId: number,
  meta: { title: string; documentDate: IsoDate; note: string }, file: { data: Buffer; filename: string }, now: Date = new Date(),
): number {
  const type = loadType(db, actor, facilityId, typeId)
  if (!type.active) throw new ServiceError(404, 'required_type_not_found')
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
  if (typeId !== null && loadType(db, actor, facilityId, typeId).folder !== row.folder) throw new ServiceError(400, 'required_type_folder_mismatch')
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
  const newest = newestLinked(db, staff.map(person => person.id))
  for (const person of staff) {
    const rows = applicableTypes(types, viewer, person.qualification).flatMap((type) => {
      const state = requiredDocumentStatus(type.validityMonths, newest.get(`${person.id}:${type.id}`)?.date ?? null, today).state
      return needsDocument(state) ? [{ typeId: type.id, name: type.name, state }] : []
    })
    missing.set(person.id, rows)
  }
  return missing
}
