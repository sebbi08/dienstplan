import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or } from 'drizzle-orm'
import {
  JOB_TITLES, MAX_ACCIDENT_ATTACHMENTS, QUALIFICATION_TITLES, reportDue, reportState,
} from '../../shared/domain/accidents'
import { childStatus, hiddenFromViewer } from '../../shared/domain/children'
import { isValidIsoDate } from '../../shared/domain/dates'
import { checkAnswers, type FormAnswers, type FormContent, type FormSubject, type PrefillKey } from '../../shared/domain/forms'
import { U1000_STARTER_KEY } from '../../shared/domain/forms/starters'
import { can, type PermissionKey } from '../../shared/domain/permissions'
import { formatTime } from '../../shared/domain/time'
import { nowInBerlin } from '../../shared/domain/timeRecords'
import type { IsoDate } from '../../shared/domain/types'
import type {
  AccidentAttachmentDto, AccidentCreateInput, AccidentFormDto, AccidentHeaderInput, AccidentListItemDto, AccidentSavedDto,
  AccidentSaveInput, AccidentsDto, ReminderDto, SessionUser,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import {
  children, employeePayroll, employees, entries, facilities, formAttachments, forms, groups, timeRecords,
} from '../db/schema'
import { assertGroupRight, loadChild, loadEditableChild, type ChildRow } from '../lib/childRecord'
import { groupRightOf, type ChildViewer } from '../lib/childViewer'
import { ServiceError } from '../lib/errors'
import { DOCUMENT_EXTENSIONS, checkedDocumentFile, type DocumentMime } from '../lib/fileSignature'
import { safeFileNamePart } from '../lib/fileName'
import { facilityContactData } from './facilityContact'
import { actorName, listTemplates, loadTemplate, withFormErrors } from './formTemplates'

/**
 * Accident reports („Unfälle“, forms of kind `accident`, see shared/domain/accidents.ts): an Unfallbericht about a child
 * (`forms.child_id`) or an Unfallanzeige about an employee (`forms.employee_id`), each made from an active accident
 * template of that subject (its content copied), with the fixed header Datum (`form_date`, required, not in the future),
 * Uhrzeit (`form_start`), Arztbesuch, arbeitsunfähig (employees only) and „an Unfallkasse gemeldet am“, and attached
 * files (`form_attachments`, stored like the child documents).
 *
 * Rights. About a child (in the record, at the office or at the unlocked tablet; the tablet writes as the unlocked
 * person): whoever reads the record reads the reports; whoever keeps the child's attendance writes them (the same rule as
 * the child notes: children.attendance in a group whose attendance the viewer writes, never in a group they only read,
 * never in the record of a child that has left), a person without an account at the tablet included. A report is
 * changed by its author and by Leitung/Träger (accidents.manage) within that rule; deleted by Leitung/Träger only.
 * About an employee (never at the tablet): Leitung/Träger (accidents.manage) read, fill in, change and delete the
 * reports of the facility's employees (like the Personalakte: another facility's employee or report is 404); the
 * employee reads the reports about themselves („Meine Unfälle“), fills one in about themselves and changes the ones they
 * filled in, never deletes. Anybody else gets 404, so nothing tells that a report exists.
 *
 * Prefill (template items with a `prefill` key, PREFILL_KINDS): only what the acting person may read is filled in. About
 * oneself everything; otherwise the birth date and the address with employees.personal, the health insurer with
 * employees.payroll, job title and „seit“ with employees.contractView (else the qualification), the working time and
 * home office of the day with time.manage. Facility data, name and group always. A child's name, birth date and group
 * for whoever writes the report.
 */

type FormRow = typeof forms.$inferSelect
type EmployeeRow = typeof employees.$inferSelect

/** Who works with employee reports: the account (never the tablet) and, for accidents.manage, the facility it works in. */
export interface AccidentActor {
  user: SessionUser
  /** The facility the account works in for the managers' rights (null without one). */
  facilityId: number | null
}

/** One report as the viewer may use it. */
interface Access {
  form: FormRow
  subject: FormSubject
  right: 'read' | 'edit'
  canDelete: boolean
  /** The viewer's name for „zuletzt geändert von“. */
  actorName: string
  /** The person's data for the header and the list. */
  person: { name: string; birthDate: IsoDate | null; groupName: string | null }
}

const MAX_FILE_NAME = 120

// ---- header ---------------------------------------------------------------

interface Header { date: IsoDate; start: number | null; doctor: boolean; unfit: boolean | null; reportedOn: IsoDate | null }

/**
 * The checked header: a valid date not after today (400 accident_date_invalid), a start of 0–1439 minutes or none (400
 * accident_start_invalid), „arbeitsunfähig“ only for an employee (400 accident_unfit_employee_only), „gemeldet am“ a
 * valid date or none (400 accident_reported_invalid).
 */
function checkedHeader(input: AccidentHeaderInput, subject: FormSubject, today: IsoDate): Header {
  if (typeof input.date !== 'string' || !isValidIsoDate(input.date) || input.date > today) {
    throw new ServiceError(400, 'accident_date_invalid')
  }
  if (input.start !== null && (!Number.isInteger(input.start) || input.start < 0 || input.start > 1439)) {
    throw new ServiceError(400, 'accident_start_invalid')
  }
  if (subject === 'child' && input.unfit) throw new ServiceError(400, 'accident_unfit_employee_only')
  const reportedOn = input.reportedOn === null || input.reportedOn === '' ? null : input.reportedOn
  if (reportedOn !== null && !isValidIsoDate(reportedOn)) throw new ServiceError(400, 'accident_reported_invalid')
  return {
    date: input.date, start: input.start, doctor: input.doctor === true, unfit: subject === 'employee' ? input.unfit === true : null,
    reportedOn,
  }
}

const headerColumns = (header: Header) => ({
  formDate: header.date, formStart: header.start, accidentDoctor: header.doctor, accidentUnfit: header.unfit,
  accidentReportedOn: header.reportedOn,
})

// ---- prefill --------------------------------------------------------------

/** What the acting person may read of the employee's data for the prefill (see the module comment). */
interface Readable { personal: boolean; payroll: boolean; contract: boolean; times: boolean }

function readableFor(permissions: ReadonlySet<PermissionKey>, self: boolean): Readable {
  if (self) return { personal: true, payroll: true, contract: true, times: true }
  return {
    personal: can(permissions, 'employees.personal'), payroll: can(permissions, 'employees.payroll'),
    contract: can(permissions, 'employees.contractView'), times: can(permissions, 'time.manage'),
  }
}

function birthDateOf(row: Pick<EmployeeRow, 'birthYear' | 'birthday'>): IsoDate | null {
  if (row.birthYear === null || row.birthday === null) return null
  const date = `${row.birthYear}-${row.birthday}`
  return isValidIsoDate(date) ? date : null
}

function groupName(db: Db, groupId: number | null): string | null {
  if (groupId === null) return null
  return db.select({ name: groups.name }).from(groups).where(eq(groups.id, groupId)).get()?.name ?? null
}

const joinLines = (...parts: (string | null | undefined)[]) => parts.map(part => part?.trim() ?? '').filter(Boolean).join('\n')

/** Begin and end of the stamped time on the day, else of the planned duties (no breaks); null without either. */
function workingTime(db: Db, employeeId: number, date: IsoDate): { start: number; end: number } | null {
  const stamped = db.select({ start: timeRecords.start, end: timeRecords.end }).from(timeRecords)
    .where(and(eq(timeRecords.employeeId, employeeId), eq(timeRecords.date, date))).all()
  const closed = stamped.filter((row): row is { start: number; end: number } => row.end !== null)
  if (closed.length > 0) return { start: Math.min(...closed.map(row => row.start)), end: Math.max(...closed.map(row => row.end)) }
  const planned = db.select({ start: entries.start, end: entries.end }).from(entries)
    .where(and(eq(entries.employeeId, employeeId), eq(entries.date, date), ne(entries.kind, 'break'), isNotNull(entries.start),
      isNotNull(entries.end))).all() as { start: number; end: number }[]
  if (planned.length === 0) return null
  return { start: Math.min(...planned.map(row => row.start)), end: Math.max(...planned.map(row => row.end)) }
}

function homeOffice(db: Db, employeeId: number, date: IsoDate): boolean {
  return db.select({ id: entries.id }).from(entries)
    .where(and(eq(entries.employeeId, employeeId), eq(entries.date, date), eq(entries.homeOffice, true))).get() !== undefined
}

type PrefillValues = Partial<Record<Exclude<PrefillKey, 'homeOffice'>, string | null>> & { homeOffice?: boolean }

/** The prefill values for a report about an employee, as far as the actor may read them. */
function employeePrefill(db: Db, employee: EmployeeRow, date: IsoDate, readable: Readable): PrefillValues {
  const values: PrefillValues = { personName: employee.name, group: groupName(db, employee.groupId) }
  if (readable.personal) {
    values.birthDate = birthDateOf(employee)
    values.address = joinLines(employee.street, [employee.postalCode, employee.city].filter(Boolean).join(' '))
  }
  if (readable.payroll) {
    values.healthInsurer = db.select({ value: employeePayroll.healthInsurer }).from(employeePayroll)
      .where(eq(employeePayroll.employeeId, employee.id)).get()?.value ?? null
  }
  const job = employee.jobKey === 'other' ? employee.jobOther : employee.jobKey === null ? null : JOB_TITLES[employee.jobKey] ?? null
  const qualification = employee.qualification === null ? null : QUALIFICATION_TITLES[employee.qualification] ?? null
  values.jobTitle = (readable.contract ? job : null) ?? qualification
  if (readable.contract) values.employedSince = employee.employedSince
  if (readable.times) {
    const time = workingTime(db, employee.id, date)
    // hh:mm as the official form asks.
    const hhmm = (minutes: number) => formatTime(minutes).padStart(5, '0')
    values.workingTime = time === null ? null : `Beginn ${hhmm(time.start)} Uhr, Ende ${hhmm(time.end)} Uhr`
    values.homeOffice = homeOffice(db, employee.id, date)
  }
  return values
}

/** The prefill values for a report about a child (whoever writes it sees the record). */
function childPrefill(db: Db, child: ChildRow): PrefillValues {
  return { personName: `${child.firstName} ${child.lastName}`.trim(), birthDate: child.birthDate, group: groupName(db, child.groupId) }
}

/** The answers the new form starts with: every prefilled item that has a value (the rest stays untouched). */
function prefilledAnswers(db: Db, content: FormContent, facilityId: number, values: PrefillValues): FormAnswers {
  const contact = facilityContactData(db, facilityId)
  const all: PrefillValues = {
    ...values,
    facility: contact ? joinLines(contact.name, contact.address) : null,
    facilityPhone: contact?.phone || null,
  }
  const answers: FormAnswers = {}
  for (const item of content.sections.flatMap(section => section.items)) {
    if (item.kind === 'choices' && item.prefill === 'homeOffice') {
      const yes = item.options.find(option => option.label.trim().toLocaleLowerCase('de') === 'ja')
      if (all.homeOffice && yes) answers[item.id] = [yes.id]
    }
    else if ((item.kind === 'text' || item.kind === 'date') && item.prefill) {
      const value = all[item.prefill]
      if (typeof value === 'string' && value !== '' && (item.kind === 'text' || isValidIsoDate(value))) answers[item.id] = value
    }
  }
  return answers
}

// ---- shared parts ---------------------------------------------------------

function attachmentsOf(db: Db, formId: number): AccidentAttachmentDto[] {
  return db.select({
    id: formAttachments.id, fileName: formAttachments.fileName, mimeType: formAttachments.mimeType, size: formAttachments.size,
    uploadedAt: formAttachments.uploadedAt, uploadedByName: formAttachments.uploadedByName,
  }).from(formAttachments).where(eq(formAttachments.formId, formId)).orderBy(asc(formAttachments.id)).all()
}

function toListItem(access: Access): AccidentListItemDto {
  const { form } = access
  return {
    id: form.id, subject: access.subject, childId: form.childId, employeeId: form.employeeId, personName: access.person.name,
    templateId: form.templateId, title: form.title, date: form.formDate ?? '', start: form.formStart,
    doctor: form.accidentDoctor === true, unfit: form.accidentUnfit === true, reportedOn: form.accidentReportedOn,
    printLayout: form.printLayout, updatedAt: form.updatedAt, updatedBy: form.updatedBy, right: access.right,
    canDelete: access.canDelete,
  }
}

function toFormDto(db: Db, access: Access): AccidentFormDto {
  const facilityName = db.select({ name: facilities.name }).from(facilities).where(eq(facilities.id, access.form.facilityId)).get()?.name ?? ''
  return {
    ...toListItem(access),
    content: JSON.parse(access.form.content) as FormContent,
    answers: JSON.parse(access.form.answers) as FormAnswers,
    attachments: attachmentsOf(db, access.form.id),
    person: access.person,
    facilityName,
  }
}

/** Whether the viewer filled in the report: the same account, or the same person (at the tablet the one who unlocked). */
function isAuthor(form: Pick<FormRow, 'createdByUserId' | 'createdByEmployeeId'>, userId: number | null, employeeId: number | null): boolean {
  return (form.createdByUserId !== null && form.createdByUserId === userId)
    || (form.createdByEmployeeId !== null && form.createdByEmployeeId === employeeId)
}

/** The active accident template of the facility for the subject (404 form_template_not_found, 409 form_template_archived). */
function accidentTemplate(db: Db, facilityId: number, templateId: number, subject: FormSubject) {
  const template = loadTemplate(db, facilityId, templateId)
  if (template.kind !== 'accident' || template.subject !== subject) throw new ServiceError(404, 'form_template_not_found')
  if (template.archived) throw new ServiceError(409, 'form_template_archived')
  return template
}

function activeTemplates(db: Db, facilityId: number, subject: FormSubject): { id: number; name: string }[] {
  return listTemplates(db, facilityId, 'accident').filter(template => !template.archived && template.subject === subject)
    .map(template => ({ id: template.id, name: template.name }))
}

interface NewForm {
  facilityId: number
  subject: FormSubject
  templateId: number
  header: Header
  childId?: number
  employeeId?: number
  prefill: PrefillValues
  author: { userId: number | null; employeeId: number | null; name: string }
}

function insertForm(db: Db, input: NewForm, now: Date): number {
  const template = accidentTemplate(db, input.facilityId, input.templateId, input.subject)
  const content = JSON.parse(template.content) as FormContent
  const answers = prefilledAnswers(db, content, input.facilityId, input.prefill)
  const at = now.toISOString()
  return db.insert(forms).values({
    facilityId: input.facilityId, templateId: template.id, kind: 'accident', title: template.name, content: template.content,
    answers: JSON.stringify(answers), createdAt: at, updatedAt: at, updatedBy: input.author.name,
    childId: input.childId ?? null, employeeId: input.employeeId ?? null, ...headerColumns(input.header),
    createdByUserId: input.author.userId, createdByEmployeeId: input.author.employeeId,
    printLayout: template.starterKey === U1000_STARTER_KEY ? 'u1000' : null,
  }).returning({ id: forms.id }).get().id
}

function assertEdit(access: Access): void {
  if (access.right !== 'edit') throw new ServiceError(403, 'forbidden')
}

/** Stores header and answers (checked against the form's own copy of the content); 409 form_changed after a newer save. */
function saveForm(db: Db, access: Access, input: AccidentSaveInput, today: IsoDate, now: Date): AccidentSavedDto {
  assertEdit(access)
  const { form } = access
  if (form.updatedAt !== input.expectedUpdatedAt) throw new ServiceError(409, 'form_changed')
  const header = checkedHeader(input, access.subject, today)
  const answers = withFormErrors(() => checkAnswers(JSON.parse(form.content) as FormContent, input.answers))
  const updatedAt = now.toISOString()
  const result = db.update(forms).set({
    answers: JSON.stringify(answers), ...headerColumns(header), updatedAt, updatedBy: access.actorName,
  }).where(and(eq(forms.id, form.id), eq(forms.updatedAt, input.expectedUpdatedAt))).run()
  if (result.changes !== 1) throw new ServiceError(409, 'form_changed')
  return { updatedAt, updatedBy: access.actorName }
}

function deleteForm(db: Db, access: Access): void {
  if (!access.canDelete) throw new ServiceError(403, 'forbidden')
  db.delete(forms).where(eq(forms.id, access.form.id)).run()
}

/** The cleaned display name of an upload: no path, trimmed, at most 120 characters; else „Anhang.<ext>“. */
function attachmentName(original: string, mime: DocumentMime): string {
  const base = original.split(/[\\/]/).pop()!.replace(/[\u0000-\u001F\u007F]/g, '').trim()
  return base === '' ? `Anhang.${DOCUMENT_EXTENSIONS[mime]}` : base.slice(-MAX_FILE_NAME)
}

/** A new attachment (JPG, PNG, PDF, at most 10 MB, judged by the bytes); 409 accident_attachments_full at 20. */
function addAttachment(db: Db, access: Access, file: { data: Buffer; filename: string }, now: Date): number {
  assertEdit(access)
  const mimeType = checkedDocumentFile(file.data)
  if (attachmentsOf(db, access.form.id).length >= MAX_ACCIDENT_ATTACHMENTS) throw new ServiceError(409, 'accident_attachments_full')
  return db.insert(formAttachments).values({
    formId: access.form.id, fileName: attachmentName(file.filename, mimeType), mimeType, size: file.data.length,
    data: file.data, uploadedAt: now.toISOString(), uploadedByName: access.actorName,
  }).returning({ id: formAttachments.id }).get().id
}

type AttachmentRow = typeof formAttachments.$inferSelect

function loadAttachmentRow(db: Db, attachmentId: number): AttachmentRow {
  const row = db.select().from(formAttachments).where(eq(formAttachments.id, attachmentId)).get()
  if (!row) throw new ServiceError(404, 'attachment_not_found')
  return row
}

/** Runs the access check of the attachment's form; anything that hides the form hides the attachment (404). */
function withAttachment<T>(db: Db, attachmentId: number, resolve: (formId: number) => Access, run: (row: AttachmentRow, access: Access) => T): T {
  const row = loadAttachmentRow(db, attachmentId)
  let access: Access
  try {
    access = resolve(row.formId)
  }
  catch (error) {
    if (error instanceof ServiceError && error.statusCode === 404) throw new ServiceError(404, 'attachment_not_found')
    throw error
  }
  return run(row, access)
}

function attachmentFile(row: AttachmentRow): { data: Buffer; mimeType: string; fileName: string } {
  const extension = DOCUMENT_EXTENSIONS[row.mimeType as DocumentMime] ?? 'bin'
  const stem = row.fileName.replace(/\.[A-Za-z0-9]{1,5}$/, '')
  return { data: row.data, mimeType: row.mimeType, fileName: `${safeFileNamePart(stem) || 'Anhang'}.${extension}` }
}

// ---- child reports --------------------------------------------------------

interface VisibleChild { row: ChildRow; archived: boolean }

/** The child as the viewer sees its record (404 child_not_found otherwise, as `getChild`). */
function loadVisibleChild(db: Db, viewer: ChildViewer, childId: number, today: IsoDate): VisibleChild {
  const row = loadChild(db, viewer.facilityId, childId)
  const archived = childStatus(row, today) === 'archived'
  if (archived && !can(viewer.permissions, 'children.manage')) throw new ServiceError(404, 'child_not_found')
  if (hiddenFromViewer(row, viewer.visibility, today)) throw new ServiceError(404, 'child_not_found')
  assertGroupRight(viewer, row.groupId, 'read')
  return { row, archived }
}

/** Whether the viewer writes reports in the child's record: as the notes, whoever keeps its attendance there. */
function writesFor(viewer: ChildViewer, child: VisibleChild): boolean {
  return !child.archived && can(viewer.permissions, 'children.attendance')
    && groupRightOf(viewer, child.row.groupId, 'children.attendance') === 'write'
}

function childAccessOf(viewer: ChildViewer, form: FormRow, child: VisibleChild): Access {
  const writes = writesFor(viewer, child)
  const manager = can(viewer.permissions, 'accidents.manage')
  return {
    form, subject: 'child',
    right: writes && (manager || isAuthor(form, viewer.id, viewer.employeeId)) ? 'edit' : 'read',
    canDelete: manager && !child.archived,
    actorName: viewer.name,
    person: { name: `${child.row.firstName} ${child.row.lastName}`.trim(), birthDate: child.row.birthDate, groupName: null },
  }
}

/** A report about a child of the viewer's facility whose record the viewer sees (404 form_not_found otherwise). */
function childAccess(db: Db, viewer: ChildViewer, formId: number, now: Date): Access {
  const form = db.select().from(forms)
    .where(and(eq(forms.id, formId), eq(forms.facilityId, viewer.facilityId), eq(forms.kind, 'accident'), isNotNull(forms.childId))).get()
  if (!form) throw new ServiceError(404, 'form_not_found')
  let child: VisibleChild
  try {
    child = loadVisibleChild(db, viewer, form.childId!, nowInBerlin(now).date)
  }
  catch (error) {
    if (error instanceof ServiceError && error.statusCode === 404) throw new ServiceError(404, 'form_not_found')
    throw error
  }
  const access = childAccessOf(viewer, form, child)
  access.person.groupName = groupName(db, child.row.groupId)
  return access
}

/** The child's accident reports, newest first, with the viewer's right; whether and from which templates they may add one. */
export function listChildAccidents(db: Db, viewer: ChildViewer, childId: number, now: Date = new Date()): AccidentsDto {
  const child = loadVisibleChild(db, viewer, childId, nowInBerlin(now).date)
  const rows = db.select().from(forms).where(and(eq(forms.childId, childId), eq(forms.kind, 'accident')))
    .orderBy(desc(forms.formDate), desc(forms.formStart), desc(forms.id)).all()
  const canCreate = writesFor(viewer, child)
  return {
    forms: rows.map(row => toListItem(childAccessOf(viewer, row, child))),
    canCreate,
    templates: canCreate ? activeTemplates(db, viewer.facilityId, 'child') : [],
  }
}

/**
 * „Unfallbericht ausfüllen“ in the child's record: whoever keeps the child's attendance (403 forbidden without the
 * attendance permission, 403 group_read_only in a group the viewer only reads, 409 child_archived / 404 for a child that
 * has left, see `loadEditableChild`). The viewer is the author (at the tablet the unlocked person). Returns the id.
 */
export function createChildAccident(
  db: Db, viewer: ChildViewer, childId: number, input: AccidentCreateInput, now: Date = new Date(),
): number {
  if (!can(viewer.permissions, 'children.attendance')) throw new ServiceError(403, 'forbidden')
  const today = nowInBerlin(now).date
  const child = loadEditableChild(db, viewer, viewer.facilityId, childId, today, now, 'children.attendance')
  const header = checkedHeader(input, 'child', today)
  return insertForm(db, {
    facilityId: viewer.facilityId, subject: 'child', templateId: input.templateId, header, childId,
    prefill: childPrefill(db, child), author: { userId: viewer.id, employeeId: viewer.employeeId, name: viewer.name },
  }, now)
}

export function getChildAccident(db: Db, viewer: ChildViewer, formId: number, now: Date = new Date()): AccidentFormDto {
  return toFormDto(db, childAccess(db, viewer, formId, now))
}

export function saveChildAccident(db: Db, viewer: ChildViewer, formId: number, input: AccidentSaveInput, now: Date = new Date()): AccidentSavedDto {
  return saveForm(db, childAccess(db, viewer, formId, now), input, nowInBerlin(now).date, now)
}

export function deleteChildAccident(db: Db, viewer: ChildViewer, formId: number, now: Date = new Date()): void {
  deleteForm(db, childAccess(db, viewer, formId, now))
}

export function addChildAccidentAttachment(
  db: Db, viewer: ChildViewer, formId: number, file: { data: Buffer; filename: string }, now: Date = new Date(),
): number {
  return addAttachment(db, childAccess(db, viewer, formId, now), file, now)
}

export function readChildAccidentAttachment(db: Db, viewer: ChildViewer, attachmentId: number, now: Date = new Date()) {
  return withAttachment(db, attachmentId, formId => childAccess(db, viewer, formId, now), row => attachmentFile(row))
}

export function deleteChildAccidentAttachment(db: Db, viewer: ChildViewer, attachmentId: number, now: Date = new Date()): void {
  withAttachment(db, attachmentId, formId => childAccess(db, viewer, formId, now), (row, access) => {
    assertEdit(access)
    db.delete(formAttachments).where(eq(formAttachments.id, row.id)).run()
  })
}

// ---- employee reports -----------------------------------------------------

const isManagerOf = (actor: AccidentActor, facilityId: number) =>
  can(actor.user.permissions, 'accidents.manage') && actor.facilityId === facilityId

function employeeAccessOf(db: Db, actor: AccidentActor, form: FormRow, employee: EmployeeRow): Access {
  const manager = isManagerOf(actor, form.facilityId)
  const self = actor.user.employeeId === employee.id
  const readable = readableFor(actor.user.permissions, self)
  return {
    form, subject: 'employee',
    right: manager || (self && isAuthor(form, actor.user.id, actor.user.employeeId)) ? 'edit' : 'read',
    canDelete: manager,
    actorName: actorName(db, actor.user),
    person: { name: employee.name, birthDate: readable.personal ? birthDateOf(employee) : null, groupName: groupName(db, employee.groupId) },
  }
}

/** A report about an employee: for Leitung/Träger of its facility or the employee themselves (404 form_not_found otherwise). */
function employeeAccess(db: Db, actor: AccidentActor, formId: number): Access {
  const row = db.select({ form: forms, employee: employees }).from(forms).innerJoin(employees, eq(employees.id, forms.employeeId))
    .where(and(eq(forms.id, formId), eq(forms.kind, 'accident'))).get()
  if (!row || (!isManagerOf(actor, row.form.facilityId) && actor.user.employeeId !== row.employee.id)) {
    throw new ServiceError(404, 'form_not_found')
  }
  return employeeAccessOf(db, actor, row.form, row.employee)
}

function loadEmployee(db: Db, employeeId: number): EmployeeRow {
  const row = db.select().from(employees).where(eq(employees.id, employeeId)).get()
  if (!row) throw new ServiceError(404, 'employee_not_found')
  return row
}

/** The employee whose reports the actor manages (accidents.manage, employee of the actor's facility; else 403 / 404). */
function managedEmployee(db: Db, actor: AccidentActor, employeeId: number): EmployeeRow {
  if (!can(actor.user.permissions, 'accidents.manage') || actor.facilityId === null) throw new ServiceError(403, 'forbidden')
  const row = loadEmployee(db, employeeId)
  if (row.facilityId !== actor.facilityId) throw new ServiceError(404, 'employee_not_found')
  return row
}

/** The signed-in account's own employee (404 employee_not_found without one). */
function ownEmployee(db: Db, user: SessionUser): EmployeeRow {
  if (user.employeeId === null) throw new ServiceError(404, 'employee_not_found')
  return loadEmployee(db, user.employeeId)
}

function employeeList(db: Db, actor: AccidentActor, employee: EmployeeRow, canCreate: boolean): AccidentsDto {
  const rows = db.select().from(forms).where(and(eq(forms.employeeId, employee.id), eq(forms.kind, 'accident')))
    .orderBy(desc(forms.formDate), desc(forms.formStart), desc(forms.id)).all()
  return {
    forms: rows.map(row => toListItem(employeeAccessOf(db, actor, row, employee))),
    canCreate,
    templates: canCreate ? activeTemplates(db, employee.facilityId, 'employee') : [],
  }
}

function createEmployeeForm(db: Db, actor: AccidentActor, employee: EmployeeRow, input: AccidentCreateInput, now: Date): number {
  const today = nowInBerlin(now).date
  const header = checkedHeader(input, 'employee', today)
  const self = actor.user.employeeId === employee.id
  return insertForm(db, {
    facilityId: employee.facilityId, subject: 'employee', templateId: input.templateId, header, employeeId: employee.id,
    prefill: employeePrefill(db, employee, header.date, readableFor(actor.user.permissions, self)),
    author: { userId: actor.user.id, employeeId: actor.user.employeeId, name: actorName(db, actor.user) },
  }, now)
}

/** The Personalakte's „Unfälle“: the employee's reports (Leitung/Träger, accidents.manage). */
export function listEmployeeAccidents(db: Db, actor: AccidentActor, employeeId: number): AccidentsDto {
  return employeeList(db, actor, managedEmployee(db, actor, employeeId), true)
}

export function createEmployeeAccident(db: Db, actor: AccidentActor, employeeId: number, input: AccidentCreateInput, now: Date = new Date()): number {
  return createEmployeeForm(db, actor, managedEmployee(db, actor, employeeId), input, now)
}

/** „Meine Unfälle“: the reports about the signed-in employee; they may fill in one about themselves. */
export function listMyAccidents(db: Db, user: SessionUser): AccidentsDto {
  return employeeList(db, { user, facilityId: null }, ownEmployee(db, user), true)
}

export function createMyAccident(db: Db, user: SessionUser, input: AccidentCreateInput, now: Date = new Date()): number {
  return createEmployeeForm(db, { user, facilityId: null }, ownEmployee(db, user), input, now)
}

export function getEmployeeAccident(db: Db, actor: AccidentActor, formId: number): AccidentFormDto {
  return toFormDto(db, employeeAccess(db, actor, formId))
}

export function saveEmployeeAccident(db: Db, actor: AccidentActor, formId: number, input: AccidentSaveInput, now: Date = new Date()): AccidentSavedDto {
  return saveForm(db, employeeAccess(db, actor, formId), input, nowInBerlin(now).date, now)
}

export function deleteEmployeeAccident(db: Db, actor: AccidentActor, formId: number): void {
  deleteForm(db, employeeAccess(db, actor, formId))
}

export function addEmployeeAccidentAttachment(
  db: Db, actor: AccidentActor, formId: number, file: { data: Buffer; filename: string }, now: Date = new Date(),
): number {
  return addAttachment(db, employeeAccess(db, actor, formId), file, now)
}

export function readEmployeeAccidentAttachment(db: Db, actor: AccidentActor, attachmentId: number) {
  return withAttachment(db, attachmentId, formId => employeeAccess(db, actor, formId), row => attachmentFile(row))
}

export function deleteEmployeeAccidentAttachment(db: Db, actor: AccidentActor, attachmentId: number): void {
  withAttachment(db, attachmentId, formId => employeeAccess(db, actor, formId), (row, access) => {
    assertEdit(access)
    db.delete(formAttachments).where(eq(formAttachments.id, row.id)).run()
  })
}

/**
 * The employee moved to another facility: their reports go along. The templates stay with the old facility (the forms
 * keep their own copy of the content, so the link is dropped). Call it inside the move's transaction.
 */
export function moveEmployeeAccidents(db: Db, employeeId: number, facilityId: number): void {
  db.update(forms).set({ facilityId, templateId: null })
    .where(and(eq(forms.employeeId, employeeId), eq(forms.kind, 'accident'))).run()
}

// ---- overview and reminder ------------------------------------------------

/** Every accident report of the facility with the person's name (child or employee), optionally within some days. */
function facilityReports(db: Db, facilityId: number, from?: IsoDate, to?: IsoDate) {
  return db.select({ form: forms, firstName: children.firstName, lastName: children.lastName, employeeName: employees.name })
    .from(forms)
    .leftJoin(children, eq(children.id, forms.childId))
    .leftJoin(employees, eq(employees.id, forms.employeeId))
    .where(and(
      eq(forms.facilityId, facilityId), eq(forms.kind, 'accident'),
      from === undefined ? undefined : gte(forms.formDate, from), to === undefined ? undefined : lte(forms.formDate, to),
    ))
    .orderBy(desc(forms.formDate), desc(forms.formStart), desc(forms.id)).all()
    .map(({ form, firstName, lastName, employeeName }) => ({
      form,
      subject: (form.childId !== null ? 'child' : 'employee') as FormSubject,
      name: form.childId !== null ? `${firstName ?? ''} ${lastName ?? ''}`.trim() : employeeName ?? '',
    }))
}

/**
 * „Unfälle“ (Mehr, accidents.manage): every accident report of the facility dated in the year, newest first, children's
 * and employees' (the page filters). Leitung/Träger may change and delete each (a report of an archived child record
 * only read).
 */
export function listAccidentOverview(db: Db, user: SessionUser, facilityId: number, year: number, now: Date = new Date()): AccidentListItemDto[] {
  if (!can(user.permissions, 'accidents.manage')) throw new ServiceError(403, 'forbidden')
  const today = nowInBerlin(now).date
  const childIds = new Set<number>()
  const reports = facilityReports(db, facilityId, `${year}-01-01`, `${year}-12-31`)
  for (const report of reports) if (report.form.childId !== null) childIds.add(report.form.childId)
  const archived = new Set(childIds.size === 0 ? [] : db.select().from(children).where(inArray(children.id, [...childIds])).all()
    .filter(row => childStatus(row, today) === 'archived').map(row => row.id))
  return reports.map(({ form, subject, name }) => {
    const readOnly = form.childId !== null && archived.has(form.childId)
    return toListItem({
      form, subject, right: readOnly ? 'read' : 'edit', canDelete: !readOnly, actorName: '',
      person: { name, birthDate: null, groupName: null },
    })
  })
}

/**
 * The reminders „Unfallanzeige an die Unfallkasse“ for Leitung/Träger (accidents.manage, not at the tablet): every report
 * of the facility with Arztbesuch (child or employee) or arbeitsunfähig (employee) that has no „gemeldet am“ yet, from the
 * accident day on; overdue after 3 days, gone once the day of the report is entered. `childId` is null for an employee
 * (the box words it „falls länger als 3 Kalendertage arbeitsunfähig“).
 */
export function accidentReminders(db: Db, viewer: Pick<ChildViewer, 'permissions' | 'onTablet' | 'facilityId'>, today: IsoDate): ReminderDto[] {
  if (!can(viewer.permissions, 'accidents.manage') || viewer.onTablet) return []
  const open = db.select({ form: forms, firstName: children.firstName, lastName: children.lastName, employeeName: employees.name })
    .from(forms)
    .leftJoin(children, eq(children.id, forms.childId))
    .leftJoin(employees, eq(employees.id, forms.employeeId))
    .where(and(
      eq(forms.facilityId, viewer.facilityId), eq(forms.kind, 'accident'), isNull(forms.accidentReportedOn),
      or(eq(forms.accidentDoctor, true), eq(forms.accidentUnfit, true)), isNotNull(forms.formDate), lte(forms.formDate, today),
    )).all()
  return open
    .filter(({ form }) => reportDue({ doctor: form.accidentDoctor === true, unfit: form.accidentUnfit === true, reportedOn: form.accidentReportedOn }))
    .map(({ form, firstName, lastName, employeeName }) => ({
      kind: 'accident' as const, date: form.formDate!, state: reportState(form.formDate!, today),
      name: form.childId !== null ? `${firstName ?? ''} ${lastName ?? ''}`.trim() : employeeName ?? '',
      childId: form.childId, age: null, ownChild: false, canDone: false, time: null, meetingKind: null, count: null,
    }))
}
