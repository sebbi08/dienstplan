import { and, asc, count, desc, eq, gte, inArray, isNull, or, type SQL } from 'drizzle-orm'
import { todayIso } from '../../shared/domain/dates'
import { checkAnswers, type FormAnswers, type FormContent } from '../../shared/domain/forms'
import { can, type PermissionKey } from '../../shared/domain/permissions'
import { FOLDER_PERMISSION, type EmployeeDocumentFolder } from '../../shared/domain/personnel'
import type { TemplateChoice } from '../../shared/domain/formCategories'
import type { IsoDate } from '../../shared/domain/types'
import {
  VISIT_LIMITS, VisitError, checkApplicant, checkInfoVisit, type ApplicantFields, type InfoVisitFields,
} from '../../shared/domain/visits'
import type {
  ApplicantHireInput, ApplicantVisitDto, ApplicantVisitListItemDto, ApplicationFormDto, InfoVisitDto, InfoVisitListItemDto,
  InfoVisitTakeOverInput, SessionUser, VisitDocumentDto, VisitFormDto, VisitFormListItemDto, VisitStaffDto,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import {
  applicantVisitDays, applicantVisits, childDocuments, children, employeeDocuments, employees, forms, infoVisits, users, visitDocuments,
} from '../db/schema'
import { asChildPermission } from '../lib/childViewer'
import { ServiceError } from '../lib/errors'
import { safeFileNamePart } from '../lib/fileName'
import { DOCUMENT_EXTENSIONS, checkedDocumentFile, type DocumentMime } from '../lib/fileSignature'
import { fillableFile } from '../lib/pdfForm'
import { addContact } from './childContacts'
import { createChild } from './children'
import { settleDocumentReview } from './documentReview'
import { assertDocumentType } from './documentTypes'
import { createEmployee } from './employees'
import { actorName, loadTemplate, templateChoices, withFormErrors } from './formTemplates'
import { resolveChildViewer } from './tabletUnlock'

/**
 * „Infogespräche“ (Kinder → Planung) and „Bewerbungen & Hospitationen“ (Mitarbeiter): info visits of families and
 * applicants' visits (Bewerbung, Hospitation, Praktikum) of the facility, with documents (stored like the child documents) and forms of the kinds `info` and
 * `applicant`. visits.manage maintains them; visits.applicants.view (which visits.manage includes) reads the applicants
 * only. „Als Vormerkung übernehmen“ needs the right to create children as well, „Einstellen“ the right to create
 * employees. Another facility's record is 404; nothing of it reaches the tablet (the routes do not let it in). The app
 * deletes nothing by itself: the Träger deletes the records under Löschfristen (server/services/retentionOverview.ts).
 * Once taken over or hired, a record keeps only its date, kind, status and the link (minimiseInfoVisit /
 * minimiseApplicant): the contact data, names and notes live in the child's or the personnel record from then on, under
 * that record's rights, so neither a later move of the child or employee nor visits.applicants.view shows them here.
 */

/** Whoever works with the visits: the session user in the facility of the request. */
export type VisitActor = SessionUser & {
  facilityId: number
}

type VisitKind = 'info' | 'applicant'

/** Runs the shared checks and answers their VisitError as 400. */
function checked<T>(run: () => T): T {
  try {
    return run()
  }
  catch (error) {
    if (error instanceof VisitError) throw new ServiceError(400, error.code)
    throw error
  }
}

function assertManager(actor: VisitActor): void {
  if (!can(actor.permissions, 'visits.manage')) throw new ServiceError(403, 'forbidden')
}

const assertApplicantReader = (actor: VisitActor) => {
  if (!can(actor.permissions, 'visits.applicants.view')) throw new ServiceError(403, 'forbidden')
}

/** User names by id (the people who changed or uploaded something), one query. */
function usernames(db: Db, ids: (number | null)[]): Map<number, string> {
  const wanted = [...new Set(ids.filter((id): id is number => id !== null))]
  if (wanted.length === 0) return new Map()
  return new Map(db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, wanted)).all()
    .map(row => [row.id, row.username]))
}

/** The facility's staff who have not left (before today), by name: whom a visit can be guided by or mentored by. */
function staffOf(db: Db, facilityId: number, today: IsoDate): VisitStaffDto[] {
  return db.select({ id: employees.id, name: employees.name }).from(employees)
    .where(and(eq(employees.facilityId, facilityId), or(isNull(employees.leftOn), gte(employees.leftOn, today))))
    .orderBy(asc(employees.name), asc(employees.id)).all()
}

/** 404 employee_not_found for anyone not of the facility's current staff (a kept choice of someone who left stays). */
function assertStaff(db: Db, facilityId: number, employeeId: number | null, keep: number | null, today: IsoDate): void {
  if (employeeId === null || employeeId === keep) return
  if (!staffOf(db, facilityId, today).some(person => person.id === employeeId)) throw new ServiceError(404, 'employee_not_found')
}

// ---- documents and forms of a record ----------------------------------------------------------------------

const DOCUMENT_META = {
  id: visitDocuments.id, infoVisitId: visitDocuments.infoVisitId, applicantVisitId: visitDocuments.applicantVisitId,
  title: visitDocuments.title, mimeType: visitDocuments.mimeType, size: visitDocuments.size, fillable: visitDocuments.fillable,
  uploadedBy: visitDocuments.uploadedBy, uploadedAt: visitDocuments.uploadedAt,
}

const ownerOf = (kind: VisitKind, id: number): SQL =>
  (kind === 'info' ? eq(visitDocuments.infoVisitId, id) : eq(visitDocuments.applicantVisitId, id))
const formsOf = (kind: VisitKind, id: number): SQL => (kind === 'info' ? eq(forms.infoVisitId, id) : eq(forms.applicantVisitId, id))

function documentsOf(db: Db, kind: VisitKind, id: number): VisitDocumentDto[] {
  const rows = db.select(DOCUMENT_META).from(visitDocuments).where(ownerOf(kind, id))
    .orderBy(desc(visitDocuments.uploadedAt), desc(visitDocuments.id)).all()
  const names = usernames(db, rows.map(row => row.uploadedBy))
  return rows.map(row => ({
    id: row.id, title: row.title, mimeType: row.mimeType, size: row.size, fillable: row.fillable === true,
    uploadedBy: row.uploadedBy === null ? null : names.get(row.uploadedBy) ?? null, uploadedAt: row.uploadedAt,
  }))
}

function formListOf(db: Db, kind: VisitKind, id: number): VisitFormListItemDto[] {
  return db.select({ id: forms.id, title: forms.title, templateId: forms.templateId, updatedAt: forms.updatedAt, updatedBy: forms.updatedBy })
    .from(forms).where(formsOf(kind, id)).orderBy(asc(forms.createdAt), asc(forms.id)).all()
}

/** Per record id: how many documents and forms it has (for the lists), two grouped queries. */
function countsOf(db: Db, kind: VisitKind, ids: number[]): { documents: Map<number, number>; forms: Map<number, number> } {
  if (ids.length === 0) return { documents: new Map(), forms: new Map() }
  const documentColumn = kind === 'info' ? visitDocuments.infoVisitId : visitDocuments.applicantVisitId
  const formColumn = kind === 'info' ? forms.infoVisitId : forms.applicantVisitId
  const documents = db.select({ id: documentColumn, n: count() }).from(visitDocuments).where(inArray(documentColumn, ids))
    .groupBy(documentColumn).all()
  const formRows = db.select({ id: formColumn, n: count() }).from(forms).where(inArray(formColumn, ids)).groupBy(formColumn).all()
  return {
    documents: new Map(documents.map(row => [row.id!, row.n])),
    forms: new Map(formRows.map(row => [row.id!, row.n])),
  }
}

function activeTemplates(db: Db, actor: VisitActor, kind: VisitKind): TemplateChoice[] {
  return templateChoices(db, actor.facilityId, kind, actor)
}

// ---- info visits ------------------------------------------------------------------------------------------

type InfoVisitRow = typeof infoVisits.$inferSelect

/** The facility's info visit (404 visit_not_found otherwise, so another facility's ids stay unconfirmed). */
function loadInfoVisit(db: Db, facilityId: number, id: number): InfoVisitRow {
  const row = db.select().from(infoVisits).where(and(eq(infoVisits.id, id), eq(infoVisits.facilityId, facilityId))).get()
  if (!row) throw new ServiceError(404, 'visit_not_found')
  return row
}

/** A taken-over visit is only read: its documents and forms are the child's now (409 visit_transferred). */
function assertInfoOpen(row: InfoVisitRow): void {
  if (row.status === 'waitlisted') throw new ServiceError(409, 'visit_transferred')
}

/**
 * The names of the children the visits were taken over as, for those still in the facility (a child that moved away is
 * not named here any more).
 */
function linkedChildNames(db: Db, facilityId: number, rows: InfoVisitRow[]): Map<number, string> {
  const ids = [...new Set(rows.map(row => row.childId).filter((id): id is number => id !== null))]
  if (ids.length === 0) return new Map()
  return new Map(db.select({ id: children.id, firstName: children.firstName, lastName: children.lastName }).from(children)
    .where(and(inArray(children.id, ids), eq(children.facilityId, facilityId))).all()
    .map(row => [row.id, `${row.firstName} ${row.lastName}`.trim()]))
}

function infoListItem(
  row: InfoVisitRow, guides: Map<number, string>, counts: ReturnType<typeof countsOf>, linked: Map<number, string>,
): InfoVisitListItemDto {
  return {
    id: row.id, visitDate: row.visitDate, visitStart: row.visitStart, familyName: row.familyName, childFirstName: row.childFirstName,
    childLastName: row.childLastName, status: row.status, childId: row.childId,
    linkedName: row.childId === null ? null : linked.get(row.childId) ?? null,
    guidedBy: row.guidedByEmployeeId !== null ? guides.get(row.guidedByEmployeeId) ?? row.guidedByName : row.guidedByName,
    phone: row.phone, email: row.email, documentCount: counts.documents.get(row.id) ?? 0, formCount: counts.forms.get(row.id) ?? 0,
    updatedAt: row.updatedAt,
  }
}

function guideNames(db: Db, rows: InfoVisitRow[]): Map<number, string> {
  const ids = [...new Set(rows.map(row => row.guidedByEmployeeId).filter((id): id is number => id !== null))]
  if (ids.length === 0) return new Map()
  return new Map(db.select({ id: employees.id, name: employees.name }).from(employees).where(inArray(employees.id, ids)).all()
    .map(row => [row.id, row.name]))
}

/** The facility's info visits, newest visit first (visits.manage). */
export function listInfoVisits(db: Db, actor: VisitActor): InfoVisitListItemDto[] {
  assertManager(actor)
  const rows = db.select().from(infoVisits).where(eq(infoVisits.facilityId, actor.facilityId))
    .orderBy(desc(infoVisits.visitDate), desc(infoVisits.visitStart), desc(infoVisits.id)).all()
  const counts = countsOf(db, 'info', rows.map(row => row.id))
  const guides = guideNames(db, rows)
  const linked = linkedChildNames(db, actor.facilityId, rows)
  return rows.map(row => infoListItem(row, guides, counts, linked))
}

/** One info visit with its documents, forms, the templates to start a form from and the staff to choose the guide from. */
export function getInfoVisit(db: Db, actor: VisitActor, id: number, today: IsoDate = todayIso()): InfoVisitDto {
  assertManager(actor)
  const row = loadInfoVisit(db, actor.facilityId, id)
  const names = usernames(db, [row.createdBy, row.updatedBy])
  return {
    ...infoListItem(row, guideNames(db, [row]), countsOf(db, 'info', [row.id]), linkedChildNames(db, actor.facilityId, [row])),
    childBirthDate: row.childBirthDate, desiredStart: row.desiredStart, guidedByEmployeeId: row.guidedByEmployeeId,
    guidedByName: row.guidedByName, notes: row.notes, createdAt: row.createdAt,
    createdBy: row.createdBy === null ? null : names.get(row.createdBy) ?? null,
    updatedBy: row.updatedBy === null ? null : names.get(row.updatedBy) ?? null,
    documents: documentsOf(db, 'info', row.id), forms: formListOf(db, 'info', row.id),
    templates: activeTemplates(db, actor, 'info'), staff: staffOf(db, actor.facilityId, today),
  }
}

/** The checked fields of an info visit; the guide must be of the facility's staff (a kept one of someone who left stays). */
function infoFields(db: Db, actor: VisitActor, input: Record<string, unknown>, keep: number | null, today: IsoDate): InfoVisitFields {
  const fields = checked(() => checkInfoVisit(input, today))
  assertStaff(db, actor.facilityId, fields.guidedByEmployeeId, keep, today)
  return fields
}

/** A new info visit of the facility (status open); returns its id. */
export function createInfoVisit(db: Db, actor: VisitActor, input: Record<string, unknown>, now: Date = new Date()): number {
  assertManager(actor)
  const fields = infoFields(db, actor, input, null, todayIso(now))
  const at = now.toISOString()
  return db.insert(infoVisits).values({
    ...fields, facilityId: actor.facilityId, createdAt: at, createdBy: actor.id, updatedAt: at, updatedBy: actor.id,
  }).returning({ id: infoVisits.id }).get().id
}

/** Changes an info visit that is not taken over (409 visit_transferred); `status` may be open or declined. */
export function updateInfoVisit(db: Db, actor: VisitActor, id: number, input: Record<string, unknown>, now: Date = new Date()): void {
  assertManager(actor)
  const row = loadInfoVisit(db, actor.facilityId, id)
  assertInfoOpen(row)
  const fields = infoFields(db, actor, input, row.guidedByEmployeeId, todayIso(now))
  const status = input.status === undefined ? row.status : input.status
  if (status !== 'open' && status !== 'declined') throw new ServiceError(400, 'invalid_input')
  db.update(infoVisits).set({ ...fields, status, updatedAt: now.toISOString(), updatedBy: actor.id }).where(eq(infoVisits.id, id)).run()
}

/** Deletes an info visit with its documents and forms (the route checkpoints the WAL afterwards). */
export function deleteInfoVisit(db: Db, actor: VisitActor, id: number): void {
  assertManager(actor)
  loadInfoVisit(db, actor.facilityId, id)
  db.delete(infoVisits).where(eq(infoVisits.id, id)).run()
}

/** What a taken-over visit keeps no more (its date, time, status and the child link stay). */
const MINIMISED_INFO_VISIT = {
  familyName: '', phone: '', email: '', childFirstName: '', childLastName: '', childBirthDate: null, desiredStart: null,
  guidedByEmployeeId: null, guidedByName: '', notes: '',
} as const

/**
 * „Als Vormerkung übernehmen“: creates the waitlist child (names and birth date, the desired start as planned entry, the
 * visit day as info meeting date, the notes as the record's note), the family as a contact (phone, e-mail in its note),
 * moves the documents into the child's record with the chosen document type (its confidentiality default) and the forms
 * (they stay readable in the record's forms, for childForms.manage only) and marks the visit as waitlisted with the
 * child, keeping only its date, time, status and that link (MINIMISED_INFO_VISIT). Needs the right to create
 * children with the own account (403 children_tablet_only / forbidden otherwise, as the child pages). The child needs a
 * first and last name (400 visit_child_name_required) and a birth date (given here, prefilled from the visit). With
 * documents a document type of the facility is required (400 document_type_required, 404 document_type_not_found).
 * Answers the child's id; the route checkpoints the WAL (the files left the visit's table).
 */
export function takeOverInfoVisit(
  db: Db, actor: VisitActor, id: number, input: InfoVisitTakeOverInput, now: Date = new Date(),
): number {
  assertManager(actor)
  const row = loadInfoVisit(db, actor.facilityId, id)
  assertInfoOpen(row)
  const childActor = asChildPermission(resolveChildViewer(db, actor, undefined, now), 'children.edit')
  if (row.childFirstName === '' || row.childLastName === '') throw new ServiceError(400, 'visit_child_name_required')
  const documentIds = db.select({ id: visitDocuments.id }).from(visitDocuments).where(ownerOf('info', id)).all().map(doc => doc.id)
  const type = documentIds.length === 0 ? null
    : input.documentTypeId === null ? (() => { throw new ServiceError(400, 'document_type_required') })()
      : assertDocumentType(db, actor.facilityId, input.documentTypeId)
  const today = todayIso(now)
  const at = now.toISOString()
  return db.transaction((tx) => {
    const childId = createChild(tx, childActor, actor.facilityId, {
      lastName: row.childLastName, firstName: row.childFirstName, birthDate: input.birthDate, address: '', groupId: null,
      careTypeId: null, entryDate: null, plannedEntryDate: row.desiredStart, admissionStatus: 'waitlist', waitlistedOn: null,
      infoMeetingDate: row.visitDate, schoolStartDate: null, primarySchool: '', schoolDistrict: '', keyEducatorId: null,
      note: row.notes,
    }, now)
    if (row.phone !== '' || row.email !== '') {
      addContact(tx, childActor, actor.facilityId, childId, {
        name: row.familyName, relation: '', phoneHome: '', phoneMobile: row.phone, phoneWork: '', isGuardian: false,
        mayPickUp: false, emergencyRank: null, contactBan: false, contactBanNote: '', note: row.email === '' ? '' : `E-Mail: ${row.email}`,
      }, today, now)
    }
    if (type) {
      for (const documentId of documentIds) {
        const doc = tx.select().from(visitDocuments).where(eq(visitDocuments.id, documentId)).get()!
        tx.insert(childDocuments).values({
          childId, documentTypeId: type.id, title: doc.title, documentDate: doc.uploadedAt.slice(0, 10),
          confidential: type.confidentialDefault, mimeType: doc.mimeType, size: doc.size, data: doc.data, fillable: doc.fillable,
          uploadedBy: doc.uploadedBy, uploadedAt: doc.uploadedAt,
        }).run()
      }
      tx.delete(visitDocuments).where(ownerOf('info', id)).run()
      settleDocumentReview(tx, childId)
    }
    tx.update(forms).set({ childId, infoVisitId: null, formDate: row.visitDate, formStart: row.visitStart }).where(formsOf('info', id)).run()
    tx.update(infoVisits).set({ ...MINIMISED_INFO_VISIT, status: 'waitlisted', childId, updatedAt: at, updatedBy: actor.id })
      .where(eq(infoVisits.id, id)).run()
    return childId
  })
}

// ---- applicants -------------------------------------------------------------------------------------------

type ApplicantRow = typeof applicantVisits.$inferSelect

function loadApplicant(db: Db, facilityId: number, id: number): ApplicantRow {
  const row = db.select().from(applicantVisits).where(and(eq(applicantVisits.id, id), eq(applicantVisits.facilityId, facilityId))).get()
  if (!row) throw new ServiceError(404, 'visit_not_found')
  return row
}

/** A hired applicant is only read: the documents and forms are in the personnel file now (409 visit_transferred). */
function assertApplicantOpen(row: ApplicantRow): void {
  if (row.status === 'hired') throw new ServiceError(409, 'visit_transferred')
}

function daysOf(db: Db, ids: number[]): Map<number, { date: IsoDate; from: number | null; to: number | null }[]> {
  const result = new Map<number, { date: IsoDate; from: number | null; to: number | null }[]>(ids.map(id => [id, []]))
  if (ids.length === 0) return result
  for (const day of db.select().from(applicantVisitDays).where(inArray(applicantVisitDays.visitId, ids))
    .orderBy(asc(applicantVisitDays.date)).all()) {
    result.get(day.visitId)!.push({ date: day.date, from: day.from, to: day.to })
  }
  return result
}

/** The names of the employees the applicants were hired as, for those still in the facility. */
function linkedEmployeeNames(db: Db, facilityId: number, rows: ApplicantRow[]): Map<number, string> {
  const ids = [...new Set(rows.map(row => row.employeeId).filter((id): id is number => id !== null))]
  if (ids.length === 0) return new Map()
  return new Map(db.select({ id: employees.id, name: employees.name }).from(employees)
    .where(and(inArray(employees.id, ids), eq(employees.facilityId, facilityId))).all().map(row => [row.id, row.name]))
}

/**
 * A hired applicant's phone and e-mail stay on the record only when they could not go into the personal data (see
 * hireApplicant); then only visits.manage reads them.
 */
const contactOf = (row: ApplicantRow, manager: boolean) =>
  (row.status === 'hired' && !manager ? { phone: '', email: '' } : { phone: row.phone, email: row.email })

function applicantListItem(
  row: ApplicantRow, days: { date: IsoDate }[], mentors: Map<number, string>, counts: ReturnType<typeof countsOf>,
  linked: Map<number, string>, manager: boolean,
): ApplicantVisitListItemDto {
  return {
    id: row.id, name: row.name, kind: row.kind, status: row.status, declinedAt: row.declinedAt, employeeId: row.employeeId,
    linkedName: row.employeeId === null ? null : linked.get(row.employeeId) ?? null,
    firstDay: days[0]?.date ?? null, lastDay: days.at(-1)?.date ?? null, dayCount: days.length,
    mentorName: row.mentorEmployeeId === null ? null : mentors.get(row.mentorEmployeeId) ?? null,
    ...contactOf(row, manager), documentCount: counts.documents.get(row.id) ?? 0, formCount: counts.forms.get(row.id) ?? 0,
    updatedAt: row.updatedAt,
  }
}

function mentorNames(db: Db, rows: ApplicantRow[]): Map<number, string> {
  const ids = [...new Set(rows.map(row => row.mentorEmployeeId).filter((id): id is number => id !== null))]
  if (ids.length === 0) return new Map()
  return new Map(db.select({ id: employees.id, name: employees.name }).from(employees).where(inArray(employees.id, ids)).all()
    .map(row => [row.id, row.name]))
}

/** The facility's applicants, the next or latest day first, those without days last (visits.applicants.view). */
export function listApplicants(db: Db, actor: VisitActor): ApplicantVisitListItemDto[] {
  assertApplicantReader(actor)
  const rows = db.select().from(applicantVisits).where(eq(applicantVisits.facilityId, actor.facilityId))
    .orderBy(desc(applicantVisits.id)).all()
  const days = daysOf(db, rows.map(row => row.id))
  const counts = countsOf(db, 'applicant', rows.map(row => row.id))
  const mentors = mentorNames(db, rows)
  const linked = linkedEmployeeNames(db, actor.facilityId, rows)
  const manager = can(actor.permissions, 'visits.manage')
  return rows.map(row => applicantListItem(row, days.get(row.id)!, mentors, counts, linked, manager))
    .sort((a, b) => (b.firstDay ?? '').localeCompare(a.firstDay ?? '') || b.id - a.id)
}

/** One applicant with days, documents and forms; `canManage` for visits.manage (else read only). */
export function getApplicant(db: Db, actor: VisitActor, id: number, today: IsoDate = todayIso()): ApplicantVisitDto {
  assertApplicantReader(actor)
  const row = loadApplicant(db, actor.facilityId, id)
  const days = daysOf(db, [row.id]).get(row.id)!
  const names = usernames(db, [row.createdBy, row.updatedBy])
  const manager = can(actor.permissions, 'visits.manage')
  return {
    ...applicantListItem(row, days, mentorNames(db, [row]), countsOf(db, 'applicant', [row.id]), linkedEmployeeNames(db, actor.facilityId, [row]), manager),
    notes: row.notes, mentorEmployeeId: row.mentorEmployeeId, days, createdAt: row.createdAt,
    createdBy: row.createdBy === null ? null : names.get(row.createdBy) ?? null,
    updatedBy: row.updatedBy === null ? null : names.get(row.updatedBy) ?? null,
    documents: documentsOf(db, 'applicant', row.id), forms: formListOf(db, 'applicant', row.id),
    templates: manager ? activeTemplates(db, actor, 'applicant') : [],
    staff: manager ? staffOf(db, actor.facilityId, today) : [],
    canManage: manager,
  }
}

function applicantFields(db: Db, actor: VisitActor, input: Record<string, unknown>, keep: number | null, today: IsoDate): ApplicantFields {
  const fields = checked(() => checkApplicant(input))
  assertStaff(db, actor.facilityId, fields.mentorEmployeeId, keep, today)
  return fields
}

/** A new applicant of the facility (status open) with its days; returns its id. */
export function createApplicant(db: Db, actor: VisitActor, input: Record<string, unknown>, now: Date = new Date()): number {
  assertManager(actor)
  const { days, ...fields } = applicantFields(db, actor, input, null, todayIso(now))
  const at = now.toISOString()
  return db.transaction((tx) => {
    const id = tx.insert(applicantVisits).values({
      ...fields, facilityId: actor.facilityId, createdAt: at, createdBy: actor.id, updatedAt: at, updatedBy: actor.id,
    }).returning({ id: applicantVisits.id }).get().id
    if (days.length > 0) tx.insert(applicantVisitDays).values(days.map(day => ({ ...day, visitId: id }))).run()
    return id
  })
}

/**
 * Changes an applicant that is not hired (409 visit_transferred), its days replaced by the given ones. `status`: open
 * or declined; declining sets the day of the refusal (today), opening again clears it.
 */
export function updateApplicant(db: Db, actor: VisitActor, id: number, input: Record<string, unknown>, now: Date = new Date()): void {
  assertManager(actor)
  const row = loadApplicant(db, actor.facilityId, id)
  assertApplicantOpen(row)
  const today = todayIso(now)
  const { days, ...fields } = applicantFields(db, actor, input, row.mentorEmployeeId, today)
  const status = input.status === undefined ? row.status : input.status
  if (status !== 'open' && status !== 'declined') throw new ServiceError(400, 'invalid_input')
  const declinedAt = status === 'declined' ? row.declinedAt ?? today : null
  db.transaction((tx) => {
    tx.update(applicantVisits).set({ ...fields, status, declinedAt, updatedAt: now.toISOString(), updatedBy: actor.id })
      .where(eq(applicantVisits.id, id)).run()
    tx.delete(applicantVisitDays).where(eq(applicantVisitDays.visitId, id)).run()
    if (days.length > 0) tx.insert(applicantVisitDays).values(days.map(day => ({ ...day, visitId: id }))).run()
  })
}

/** Deletes an applicant with days, documents and forms (the route checkpoints the WAL afterwards). */
export function deleteApplicant(db: Db, actor: VisitActor, id: number): void {
  assertManager(actor)
  loadApplicant(db, actor.facilityId, id)
  db.delete(applicantVisits).where(eq(applicantVisits.id, id)).run()
}

/**
 * „Einstellen“: creates the employee in the facility (name; short name, start and weekly hours as the hire form gives
 * them – the Träger completes the contract data), moves the documents into the chosen folder of the personnel file (one
 * the actor may use: 403 forbidden; required with documents: 400 folder_required) and the forms into the personnel file
 * (readable there under Dokumente) and marks the applicant as hired with the employee (a refusal date goes). The phone
 * and e-mail go into the personal data only for an actor with employees.personal („Anschrift und Kontakt“); otherwise
 * they stay on the record (`contactCopied` false). Apart from that the record keeps only its kind, days, status and the
 * link (name, notes and mentor go). Needs the right to create employees (403 forbidden). Answers the employee's id; the
 * route checkpoints the WAL.
 */
export function hireApplicant(
  db: Db, actor: VisitActor, id: number, input: ApplicantHireInput, now: Date = new Date(),
): { employeeId: number; contactCopied: boolean } {
  assertManager(actor)
  if (!can(actor.permissions, 'employees.edit')) throw new ServiceError(403, 'forbidden')
  const row = loadApplicant(db, actor.facilityId, id)
  assertApplicantOpen(row)
  const documentIds = db.select({ id: visitDocuments.id }).from(visitDocuments).where(ownerOf('applicant', id)).all().map(doc => doc.id)
  const folder: EmployeeDocumentFolder | null = documentIds.length === 0 ? null : input.folder
  if (documentIds.length > 0) {
    if (folder === null) throw new ServiceError(400, 'folder_required')
    if (!can(actor.permissions, FOLDER_PERMISSION[folder])) throw new ServiceError(403, 'forbidden')
  }
  const at = now.toISOString()
  const contactCopied = can(actor.permissions, 'employees.personal')
  return db.transaction((tx) => {
    const employeeId = createEmployee(tx, actor, actor.facilityId, {
      name: row.name, shortName: input.shortName, weeklyMinutes: input.weeklyMinutes, validFrom: input.validFrom, groupId: input.groupId,
    }, now)
    if (contactCopied) {
      tx.update(employees).set({ phone: row.phone === '' ? null : row.phone, email: row.email === '' ? null : row.email })
        .where(eq(employees.id, employeeId)).run()
    }
    if (folder !== null) {
      for (const documentId of documentIds) {
        const doc = tx.select().from(visitDocuments).where(eq(visitDocuments.id, documentId)).get()!
        tx.insert(employeeDocuments).values({
          employeeId, folder, title: doc.title, documentDate: doc.uploadedAt.slice(0, 10), note: '', mimeType: doc.mimeType,
          size: doc.size, data: doc.data, fillable: doc.fillable, uploadedBy: doc.uploadedBy, uploadedAt: doc.uploadedAt,
        }).run()
      }
      tx.delete(visitDocuments).where(ownerOf('applicant', id)).run()
    }
    tx.update(forms).set({ employeeId, applicantVisitId: null }).where(formsOf('applicant', id)).run()
    tx.update(applicantVisits).set({
      status: 'hired', employeeId, declinedAt: null, name: '', notes: '', mentorEmployeeId: null,
      ...(contactCopied ? { phone: '', email: '' } : {}), updatedAt: at, updatedBy: actor.id,
    }).where(eq(applicantVisits.id, id)).run()
    return { employeeId, contactCopied }
  })
}

// ---- documents --------------------------------------------------------------------------------------------

/** The record a document or form is added to: open, of the facility, and the actor may change it. */
function touchOpenRecord(db: Db, actor: VisitActor, kind: VisitKind, id: number, now: Date): void {
  assertManager(actor)
  const set = { updatedAt: now.toISOString(), updatedBy: actor.id }
  if (kind === 'info') {
    assertInfoOpen(loadInfoVisit(db, actor.facilityId, id))
    db.update(infoVisits).set(set).where(eq(infoVisits.id, id)).run()
  }
  else {
    assertApplicantOpen(loadApplicant(db, actor.facilityId, id))
    db.update(applicantVisits).set(set).where(eq(applicantVisits.id, id)).run()
  }
}

/** The title as stored: trimmed, at most 200 characters, else the file's name without its extension, else „Dokument“. */
function documentTitle(title: string | undefined, filename: string): string {
  const given = (title ?? '').trim()
  if (given.length > VISIT_LIMITS.documentTitle) throw new ServiceError(400, 'visit_text_too_long')
  return given || filename.replace(/\.[^.]*$/, '').trim().slice(0, VISIT_LIMITS.documentTitle) || 'Dokument'
}

/**
 * A new document of the record (PDF, JPEG or PNG judged by the first bytes: 400 document_type_invalid; at most 30 MB:
 * 413 document_too_large); returns its id. Counts as a change of the record (its last activity).
 */
export function uploadVisitDocument(
  db: Db, actor: VisitActor, kind: VisitKind, id: number, title: string | undefined, file: { data: Buffer; filename: string },
  now: Date = new Date(),
): number {
  assertManager(actor)
  const mimeType = checkedDocumentFile(file.data)
  const stored = documentTitle(title, file.filename)
  return db.transaction((tx) => {
    touchOpenRecord(tx, actor, kind, id, now)
    return tx.insert(visitDocuments).values({
      ...(kind === 'info' ? { infoVisitId: id } : { applicantVisitId: id }), title: stored, mimeType,
      fillable: fillableFile(file.data, mimeType), size: file.data.length, data: file.data, uploadedBy: actor.id, uploadedAt: now.toISOString(),
    }).returning({ id: visitDocuments.id }).get().id
  })
}

type DocumentMetaRow = { id: number; infoVisitId: number | null; applicantVisitId: number | null; title: string; mimeType: string; uploadedAt: string }

/**
 * The document of a record of the facility (404 document_not_found otherwise) the actor may read: an info visit's with
 * visits.manage, an applicant's with visits.applicants.view (403 forbidden). Answers its kind and owner as well.
 */
function loadVisitDocument(db: Db, actor: VisitActor, documentId: number): DocumentMetaRow & { kind: VisitKind; ownerName: string } {
  const row = db.select({
    id: visitDocuments.id, infoVisitId: visitDocuments.infoVisitId, applicantVisitId: visitDocuments.applicantVisitId,
    title: visitDocuments.title, mimeType: visitDocuments.mimeType, uploadedAt: visitDocuments.uploadedAt,
  }).from(visitDocuments).where(eq(visitDocuments.id, documentId)).get()
  if (!row) throw new ServiceError(404, 'document_not_found')
  const owner = row.infoVisitId !== null
    ? db.select({ facilityId: infoVisits.facilityId, name: infoVisits.familyName }).from(infoVisits).where(eq(infoVisits.id, row.infoVisitId)).get()
    : db.select({ facilityId: applicantVisits.facilityId, name: applicantVisits.name }).from(applicantVisits)
      .where(eq(applicantVisits.id, row.applicantVisitId!)).get()
  if (!owner || owner.facilityId !== actor.facilityId) throw new ServiceError(404, 'document_not_found')
  const kind: VisitKind = row.infoVisitId !== null ? 'info' : 'applicant'
  const needed: PermissionKey = kind === 'info' ? 'visits.manage' : 'visits.applicants.view'
  if (!can(actor.permissions, needed)) throw new ServiceError(403, 'forbidden')
  return { ...row, kind, ownerName: owner.name }
}

/** The file with its stored type, its size and a download name `<family or person>-<title>.<ext>`. */
export function readVisitDocumentFile(
  db: Db, actor: VisitActor, documentId: number,
): { data: Buffer; mimeType: string; size: number; fileName: string } {
  const row = loadVisitDocument(db, actor, documentId)
  const { data } = db.select({ data: visitDocuments.data }).from(visitDocuments).where(eq(visitDocuments.id, documentId)).get()!
  const extension = DOCUMENT_EXTENSIONS[row.mimeType as DocumentMime] ?? 'bin'
  const base = [row.ownerName, row.title].map(safeFileNamePart).filter(part => part !== '').join('-')
  return { data, mimeType: row.mimeType, size: data.length, fileName: `${base || 'Dokument'}.${extension}` }
}

const ownerIdOf = (row: DocumentMetaRow) => (row.infoVisitId ?? row.applicantVisitId)!

/** „Bearbeiten“ of a PDF filled in the app: only a PDF replaces a PDF; the title stays, the upload counts as now by the actor. */
export function replaceVisitDocumentFile(
  db: Db, actor: VisitActor, documentId: number, file: { data: Buffer; filename: string }, now: Date = new Date(),
): void {
  assertManager(actor)
  const row = loadVisitDocument(db, actor, documentId)
  if (row.mimeType !== 'application/pdf') throw new ServiceError(400, 'document_type_invalid')
  const mimeType = checkedDocumentFile(file.data, ['application/pdf'])
  db.transaction((tx) => {
    touchOpenRecord(tx, actor, row.kind, ownerIdOf(row), now)
    tx.update(visitDocuments).set({
      mimeType, fillable: fillableFile(file.data, mimeType), size: file.data.length, data: file.data, uploadedBy: actor.id,
      uploadedAt: now.toISOString(),
    }).where(eq(visitDocuments.id, documentId)).run()
  })
}

/** Deletes the document of an open record; the route runs the WAL checkpoint afterwards. */
export function deleteVisitDocument(db: Db, actor: VisitActor, documentId: number, now: Date = new Date()): void {
  assertManager(actor)
  const row = loadVisitDocument(db, actor, documentId)
  db.transaction((tx) => {
    touchOpenRecord(tx, actor, row.kind, ownerIdOf(row), now)
    tx.delete(visitDocuments).where(eq(visitDocuments.id, documentId)).run()
  })
}

// ---- forms ------------------------------------------------------------------------------------------------

/**
 * A new form of the record from an active template of its kind (`info` for an info visit, `applicant` for an applicant;
 * another kind or facility 404 form_template_not_found, archived 409 form_template_archived); returns its id.
 */
export function createVisitForm(db: Db, actor: VisitActor, kind: VisitKind, id: number, templateId: number, now: Date = new Date()): number {
  assertManager(actor)
  const template = loadTemplate(db, actor.facilityId, templateId, actor)
  if (template.kind !== kind) throw new ServiceError(404, 'form_template_not_found')
  if (template.archived) throw new ServiceError(409, 'form_template_archived')
  const at = now.toISOString()
  return db.transaction((tx) => {
    touchOpenRecord(tx, actor, kind, id, now)
    return tx.insert(forms).values({
      facilityId: actor.facilityId, templateId: template.id, kind, title: template.name, content: template.content, answers: '{}',
      createdAt: at, updatedAt: at, updatedBy: actorName(tx, actor),
      ...(kind === 'info' ? { infoVisitId: id } : { applicantVisitId: id }),
    }).returning({ id: forms.id }).get().id
  })
}

type FormRow = typeof forms.$inferSelect

/** A form of a record of the facility (not yet taken over), as the actor may read it (404 form_not_found, 403 forbidden). */
function loadVisitForm(db: Db, actor: VisitActor, formId: number): { form: FormRow; kind: VisitKind } {
  const form = db.select().from(forms).where(and(eq(forms.id, formId), eq(forms.facilityId, actor.facilityId))).get()
  if (!form || (form.infoVisitId === null && form.applicantVisitId === null)) throw new ServiceError(404, 'form_not_found')
  const kind: VisitKind = form.infoVisitId !== null ? 'info' : 'applicant'
  if (!can(actor.permissions, kind === 'info' ? 'visits.manage' : 'visits.applicants.view')) throw new ServiceError(403, 'forbidden')
  return { form, kind }
}

/** One form with content and answers; editable for visits.manage. */
export function getVisitForm(db: Db, actor: VisitActor, formId: number): VisitFormDto {
  const { form, kind } = loadVisitForm(db, actor, formId)
  return {
    id: form.id, title: form.title, templateId: form.templateId, updatedAt: form.updatedAt, updatedBy: form.updatedBy, kind,
    content: JSON.parse(form.content) as FormContent, answers: JSON.parse(form.answers) as FormAnswers,
    editable: can(actor.permissions, 'visits.manage'),
  }
}

/**
 * Stores the answers (checked against the form's own content). `expectedUpdatedAt` is the last change the saver loaded;
 * someone else's save in between is 409 form_changed. Counts as a change of the record. Returns the new last change.
 */
export function saveVisitForm(
  db: Db, actor: VisitActor, formId: number, input: { answers: unknown; expectedUpdatedAt: string }, now: Date = new Date(),
): { updatedAt: string; updatedBy: string } {
  assertManager(actor)
  const { form, kind } = loadVisitForm(db, actor, formId)
  if (form.updatedAt !== input.expectedUpdatedAt) throw new ServiceError(409, 'form_changed')
  const answers = withFormErrors(() => checkAnswers(JSON.parse(form.content) as FormContent, input.answers))
  const updatedAt = now.toISOString()
  const updatedBy = actorName(db, actor)
  db.transaction((tx) => {
    touchOpenRecord(tx, actor, kind, (form.infoVisitId ?? form.applicantVisitId)!, now)
    const result = tx.update(forms).set({ answers: JSON.stringify(answers), updatedAt, updatedBy })
      .where(and(eq(forms.id, form.id), eq(forms.updatedAt, input.expectedUpdatedAt))).run()
    if (result.changes !== 1) throw new ServiceError(409, 'form_changed')
  })
  return { updatedAt, updatedBy }
}

/** Deletes a form of an open record. */
export function deleteVisitForm(db: Db, actor: VisitActor, formId: number, now: Date = new Date()): void {
  assertManager(actor)
  const { form, kind } = loadVisitForm(db, actor, formId)
  db.transaction((tx) => {
    touchOpenRecord(tx, actor, kind, (form.infoVisitId ?? form.applicantVisitId)!, now)
    tx.delete(forms).where(eq(forms.id, form.id)).run()
  })
}

/**
 * The forms of the application moved into the personnel file at „Einstellen“ (kind `applicant`), oldest first, read
 * only: for whoever may use the folder „Bewerbung“ or holds visits.manage; anyone else gets none. 404
 * employee_not_found for an employee of another facility (the route asks for employees.view).
 */
export function listApplicationForms(db: Db, actor: VisitActor, employeeId: number): ApplicationFormDto[] {
  const employee = db.select({ facilityId: employees.facilityId }).from(employees).where(eq(employees.id, employeeId)).get()
  if (!employee || employee.facilityId !== actor.facilityId) throw new ServiceError(404, 'employee_not_found')
  if (!can(actor.permissions, 'visits.manage') && !can(actor.permissions, 'employees.docs.application')) return []
  return db.select().from(forms).where(and(eq(forms.employeeId, employeeId), eq(forms.kind, 'applicant')))
    .orderBy(asc(forms.createdAt), asc(forms.id)).all()
    .map(form => ({
      id: form.id, title: form.title, content: JSON.parse(form.content) as FormContent, answers: JSON.parse(form.answers) as FormAnswers,
      updatedAt: form.updatedAt, updatedBy: form.updatedBy,
    }))
}
