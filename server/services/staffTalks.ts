import { and, asc, desc, eq, inArray, max } from 'drizzle-orm'
import { isValidIsoDate, todayIso } from '../../shared/domain/dates'
import { checkAnswers, type FormAnswers, type FormContent } from '../../shared/domain/forms'
import type { IsoDate } from '../../shared/domain/types'
import type {
  FormSavedDto, MyTalkDto, MyTalkFormDto, MyTalkHeaderDto, SessionUser, StaffTalkDto, TalkFormDto, TalkFormRole,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, facilities, forms, staffTalkForms, staffTalks, users } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { actorName, loadTemplate, withFormErrors } from './formTemplates'

export const TALK_LIMITS = { participants: 300, period: 60 } as const

/** The header fields of a talk as the form sends them. */
export interface StaffTalkHeader {
  date: string
  start: number | null
  participants: string
  period: string
}

export interface StaffTalkInput extends StaffTalkHeader {
  employeeId: number
  templateIds: number[]
}

type TalkRow = typeof staffTalks.$inferSelect
type FormRow = typeof forms.$inferSelect
type TalkForm = FormRow & { role: TalkFormRole; talkId: number }

/** Trimmed header fields: a valid ISO date, a start of 0–1439 minutes or none, short texts. */
function checkedHeader(input: StaffTalkHeader): StaffTalkHeader {
  if (!isValidIsoDate(input.date)) throw new ServiceError(400, 'staff_talk_date_invalid')
  if (input.start !== null && (!Number.isInteger(input.start) || input.start < 0 || input.start > 1439)) {
    throw new ServiceError(400, 'staff_talk_start_invalid')
  }
  const participants = input.participants.trim()
  const period = input.period.trim()
  if (participants.length > TALK_LIMITS.participants) throw new ServiceError(400, 'staff_talk_participants_too_long')
  if (period.length > TALK_LIMITS.period) throw new ServiceError(400, 'staff_talk_period_too_long')
  return { date: input.date, start: input.start, participants, period }
}

/**
 * Whose talks a manager handles: those of the active facility, but never their own. A Leitung's talks are held by the
 * Träger or another Leitung; the Leitung sees them only under „Meine Gespräche“ like every employee. Routes pass
 * `{ facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }`.
 */
export interface TalkScope { facilityId: number; ownEmployeeId: number | null }

const isOwn = (scope: TalkScope, employeeId: number) => scope.ownEmployeeId !== null && scope.ownEmployeeId === employeeId

/** 403 staff_talk_own for the manager's own employee (list and create name the employee directly). */
function assertNotOwn(scope: TalkScope, employeeId: number): void {
  if (isOwn(scope, employeeId)) throw new ServiceError(403, 'staff_talk_own')
}

/** A talk of the facility, not about the manager; anything else is 404 staff_talk_not_found (no existence leak). */
function loadTalk(db: Db, scope: TalkScope, id: number): TalkRow {
  const row = db.select().from(staffTalks).where(and(eq(staffTalks.id, id), eq(staffTalks.facilityId, scope.facilityId))).get()
  if (!row || isOwn(scope, row.employeeId)) throw new ServiceError(404, 'staff_talk_not_found')
  return row
}

const talkFormColumns = { form: forms, role: staffTalkForms.role, talkId: staffTalkForms.talkId }

/** A form of one of the facility's talks, not about the manager; anything else is 404 form_not_found. */
function loadTalkForm(db: Db, scope: TalkScope, formId: number): TalkForm {
  const row = db.select({ ...talkFormColumns, employeeId: staffTalks.employeeId }).from(forms)
    .innerJoin(staffTalkForms, eq(staffTalkForms.formId, forms.id))
    .innerJoin(staffTalks, eq(staffTalks.id, staffTalkForms.talkId))
    .where(and(eq(forms.id, formId), eq(staffTalks.facilityId, scope.facilityId))).get()
  if (!row || isOwn(scope, row.employeeId)) throw new ServiceError(404, 'form_not_found')
  return { ...row.form, role: row.role, talkId: row.talkId }
}

function toFormDto(row: TalkForm): TalkFormDto {
  return {
    id: row.id, role: row.role, title: row.title, content: JSON.parse(row.content) as FormContent,
    answers: JSON.parse(row.answers) as FormAnswers, state: row.state, readReleased: row.readReleased,
    updatedAt: row.updatedAt, updatedBy: row.updatedBy, releasedAt: row.releasedAt, submittedAt: row.submittedAt,
    readReleasedAt: row.readReleasedAt,
  }
}

/** The forms of the talks, in their order, by talk id. */
function formsByTalk(db: Db, talkIds: number[]): Map<number, TalkForm[]> {
  const result = new Map<number, TalkForm[]>()
  if (talkIds.length === 0) return result
  const rows = db.select({ ...talkFormColumns, sort: staffTalkForms.sort }).from(staffTalkForms)
    .innerJoin(forms, eq(forms.id, staffTalkForms.formId))
    .where(inArray(staffTalkForms.talkId, talkIds))
    .orderBy(asc(staffTalkForms.sort), asc(forms.id)).all()
  for (const row of rows) {
    const list = result.get(row.talkId) ?? []
    list.push({ ...row.form, role: row.role, talkId: row.talkId })
    result.set(row.talkId, list)
  }
  return result
}

const newestFirst = [desc(staffTalks.date), desc(staffTalks.start), desc(staffTalks.id)]

/** The facility's talks with the employee, newest first, each with all its forms (403 staff_talk_own for oneself). */
export function listTalks(db: Db, scope: TalkScope, employeeId: number): StaffTalkDto[] {
  assertNotOwn(scope, employeeId)
  const talks = db.select().from(staffTalks)
    .where(and(eq(staffTalks.facilityId, scope.facilityId), eq(staffTalks.employeeId, employeeId)))
    .orderBy(...newestFirst).all()
  const byTalk = formsByTalk(db, talks.map(talk => talk.id))
  return talks.map(talk => ({
    id: talk.id, employeeId: talk.employeeId, date: talk.date, start: talk.start, participants: talk.participants,
    period: talk.period, forms: (byTalk.get(talk.id) ?? []).map(toFormDto),
  }))
}

/** The next sort position in a talk. */
function nextSort(db: Db, talkId: number): number {
  const row = db.select({ value: max(staffTalkForms.sort) }).from(staffTalkForms).where(eq(staffTalkForms.talkId, talkId)).get()
  return (row?.value ?? -1) + 1
}

/**
 * Adds a form made from an active staff template of the facility to the talk: a copy of the template's content, titled
 * like the template; a self-assessment template makes a `self` form, any other an assessment.
 */
function insertForm(db: Db, actor: SessionUser, facilityId: number, talkId: number, templateId: number, at: string): number {
  const template = loadTemplate(db, facilityId, templateId)
  if (template.kind !== 'staff') throw new ServiceError(404, 'form_template_not_found')
  if (template.archived) throw new ServiceError(409, 'form_template_archived')
  const formId = db.insert(forms).values({
    facilityId, templateId, kind: 'staff', title: template.name, content: template.content, answers: '{}',
    state: 'draft', readReleased: false, createdAt: at, updatedAt: at, updatedBy: actorName(db, actor),
  }).returning({ id: forms.id }).get().id
  db.insert(staffTalkForms).values({
    talkId, formId, role: template.selfAssessment ? 'self' : 'assessment', sort: nextSort(db, talkId),
  }).run()
  return formId
}

/** A new talk with the employee of the facility and one form per chosen template (in the given order); returns its id. */
export function createTalk(db: Db, actor: SessionUser, scope: TalkScope, input: StaffTalkInput, now: Date = new Date()): number {
  const { facilityId } = scope
  assertNotOwn(scope, input.employeeId)
  const header = checkedHeader(input)
  const employee = db.select({ id: employees.id }).from(employees)
    .where(and(eq(employees.id, input.employeeId), eq(employees.facilityId, facilityId))).get()
  if (!employee) throw new ServiceError(404, 'employee_not_found')
  const templateIds = [...new Set(input.templateIds)]
  if (templateIds.length === 0) throw new ServiceError(400, 'staff_talk_forms_required')
  const at = now.toISOString()
  return db.transaction((tx) => {
    const talkId = tx.insert(staffTalks).values({
      facilityId, employeeId: employee.id, ...header, createdAt: at, createdBy: actor.id,
    }).returning({ id: staffTalks.id }).get().id
    for (const templateId of templateIds) insertForm(tx, actor, facilityId, talkId, templateId, at)
    return talkId
  })
}

/** Changes the header fields of a talk. */
export function updateTalk(db: Db, scope: TalkScope, id: number, input: StaffTalkHeader): void {
  loadTalk(db, scope, id)
  db.update(staffTalks).set(checkedHeader(input)).where(eq(staffTalks.id, id)).run()
}

/** Deletes a talk with all its forms. */
export function deleteTalk(db: Db, scope: TalkScope, id: number): void {
  loadTalk(db, scope, id)
  db.transaction((tx) => {
    const formIds = tx.select({ id: staffTalkForms.formId }).from(staffTalkForms).where(eq(staffTalkForms.talkId, id))
      .all().map(row => row.id)
    tx.delete(staffTalks).where(eq(staffTalks.id, id)).run()
    if (formIds.length > 0) tx.delete(forms).where(inArray(forms.id, formIds)).run()
  })
}

/** Adds one more form from a template to a talk; returns the form's id. */
export function addTalkForm(
  db: Db, actor: SessionUser, scope: TalkScope, talkId: number, templateId: number, now: Date = new Date(),
): number {
  loadTalk(db, scope, talkId)
  return db.transaction(tx => insertForm(tx, actor, scope.facilityId, talkId, templateId, now.toISOString()))
}

/** Removes a form from its talk. */
export function deleteTalkForm(db: Db, scope: TalkScope, formId: number): void {
  loadTalkForm(db, scope, formId)
  db.delete(forms).where(eq(forms.id, formId)).run()
}

/**
 * Stores the answers, checked against the form's own copy of the content. `expectedUpdatedAt` is the last change the
 * saver had loaded; when someone saved in between, nothing is written (409 form_changed). `state` additionally
 * requires the form to be in that state at the moment of writing.
 */
function writeAnswers(
  db: Db, actor: SessionUser, form: TalkForm, answers: unknown, expectedUpdatedAt: string, now: Date,
  state?: FormRow['state'],
): FormSavedDto {
  if (form.updatedAt !== expectedUpdatedAt) throw new ServiceError(409, 'form_changed')
  const content = JSON.parse(form.content) as FormContent
  const checked = withFormErrors(() => checkAnswers(content, answers))
  const updatedAt = now.toISOString()
  const updatedBy = actorName(db, actor)
  const result = db.update(forms)
    .set({ answers: JSON.stringify(checked), updatedAt, updatedBy })
    .where(and(eq(forms.id, form.id), eq(forms.updatedAt, expectedUpdatedAt), state && eq(forms.state, state))).run()
  if (result.changes !== 1) throw new ServiceError(409, 'form_changed')
  // A save changes no state, so the other timestamps stay as loaded.
  return { updatedAt, updatedBy, releasedAt: form.releasedAt, submittedAt: form.submittedAt, readReleasedAt: form.readReleasedAt }
}

/** Leitung and Träger save the answers of any form of the facility's talks, in any state. */
export function saveTalkFormAnswers(
  db: Db, actor: SessionUser, scope: TalkScope, formId: number, answers: unknown, expectedUpdatedAt: string,
  now: Date = new Date(),
): FormSavedDto {
  return writeAnswers(db, actor, loadTalkForm(db, scope, formId), answers, expectedUpdatedAt, now)
}

const hasLeft = (leftOn: IsoDate | null, today: IsoDate) => leftOn !== null && leftOn < today

/** 409 employee_inactive when the employee has left (before today). */
function assertNotLeft(db: Db, employeeId: number, today: IsoDate): void {
  const employee = db.select({ leftOn: employees.leftOn }).from(employees).where(eq(employees.id, employeeId)).get()
  if (!employee || hasLeft(employee.leftOn, today)) throw new ServiceError(409, 'employee_inactive')
}

/** 409 employee_inactive unless the talk's employee is still there and has an active account to sign in with. */
function assertReachable(db: Db, talkId: number, today: IsoDate): void {
  const talk = db.select({ employeeId: staffTalks.employeeId }).from(staffTalks).where(eq(staffTalks.id, talkId)).get()!
  assertNotLeft(db, talk.employeeId, today)
  const account = db.select({ id: users.id }).from(users)
    .where(and(eq(users.employeeId, talk.employeeId), eq(users.active, true))).get()
  if (!account) throw new ServiceError(409, 'employee_inactive')
}

/** Moves a self form from one state to the next, only if it is still in `from` (409 form_state_invalid otherwise). */
function transition(
  db: Db, form: TalkForm, from: FormRow['state'], values: Partial<typeof forms.$inferInsert>, expectedUpdatedAt?: string,
): void {
  if (form.role !== 'self') throw new ServiceError(409, 'form_state_invalid')
  const result = db.update(forms).set(values)
    .where(and(eq(forms.id, form.id), eq(forms.state, from), expectedUpdatedAt === undefined ? undefined : eq(forms.updatedAt, expectedUpdatedAt))).run()
  if (result.changes !== 1) throw new ServiceError(409, expectedUpdatedAt === undefined ? 'form_state_invalid' : 'form_changed')
}

/** „Zum Ausfüllen freigeben“: a self form in draft goes to the employee (only an employee who can sign in). */
export function releaseTalkForm(db: Db, scope: TalkScope, formId: number, now: Date = new Date()): void {
  const form = loadTalkForm(db, scope, formId)
  assertReachable(db, form.talkId, todayIso(now))
  transition(db, form, 'draft', { state: 'released', releasedAt: now.toISOString(), submittedAt: null })
}

/** Takes the release back while the employee has not submitted yet. */
export function withdrawTalkForm(db: Db, scope: TalkScope, formId: number): void {
  const form = loadTalkForm(db, scope, formId)
  transition(db, form, 'released', { state: 'draft', releasedAt: null })
}

/** „Wieder öffnen“: a submitted self form is open to the employee again (only an employee who can still sign in). */
export function reopenTalkForm(db: Db, scope: TalkScope, formId: number, now: Date = new Date()): void {
  const form = loadTalkForm(db, scope, formId)
  assertReachable(db, form.talkId, todayIso(now))
  transition(db, form, 'submitted', { state: 'released', submittedAt: null })
}

/** „Zum Lesen freigeben“ / zurücknehmen for an assessment (a new release only to an employee who can sign in). */
export function setTalkFormReadRelease(db: Db, scope: TalkScope, formId: number, released: boolean, now: Date = new Date()): void {
  const form = loadTalkForm(db, scope, formId)
  if (form.role !== 'assessment') throw new ServiceError(409, 'form_state_invalid')
  if (released === form.readReleased) return
  if (released) assertReachable(db, form.talkId, todayIso(now))
  const result = db.update(forms).set({ readReleased: released, readReleasedAt: released ? now.toISOString() : null })
    .where(and(eq(forms.id, formId), eq(forms.readReleased, !released))).run()
  // Someone toggled it in between: say so instead of silently doing nothing.
  if (result.changes !== 1) throw new ServiceError(409, 'form_state_invalid')
}

// ---- the employee's own view ---------------------------------------------

/** What the employee may see: self forms released or submitted, assessments released to read. */
const visibleToEmployee = (form: TalkForm) =>
  form.role === 'self' ? form.state !== 'draft' : form.readReleased

const toHeader = (talk: TalkRow): MyTalkHeaderDto =>
  ({ id: talk.id, date: talk.date, start: talk.start, participants: talk.participants, period: talk.period })

/** The signed-in user's talks with only their visible forms (talks without one are left out); 404 without an employee. */
export function listMyTalks(db: Db, user: SessionUser): MyTalkDto[] {
  if (user.employeeId === null) throw new ServiceError(404, 'no_employee')
  const talks = db.select().from(staffTalks).where(eq(staffTalks.employeeId, user.employeeId)).orderBy(...newestFirst).all()
  const byTalk = formsByTalk(db, talks.map(talk => talk.id))
  return talks
    .map(talk => ({ ...toHeader(talk), forms: (byTalk.get(talk.id) ?? []).filter(visibleToEmployee).map(toFormDto) }))
    .filter(talk => talk.forms.length > 0)
}

/** A form of the user's own talk that is visible to them; anything else is 404 form_not_found. */
/**
 * `writing`: the employee saves or submits. Their own self form that went back to draft (the Leitung took the release
 * back while they were typing) then answers 409 form_release_withdrawn instead of 404, so they know why.
 */
function loadMyForm(db: Db, user: SessionUser, formId: number, writing = false): { talk: TalkRow; form: TalkForm } {
  if (user.employeeId === null) throw new ServiceError(404, 'form_not_found')
  const row = db.select({ ...talkFormColumns, talk: staffTalks }).from(forms)
    .innerJoin(staffTalkForms, eq(staffTalkForms.formId, forms.id))
    .innerJoin(staffTalks, eq(staffTalks.id, staffTalkForms.talkId))
    .where(and(eq(forms.id, formId), eq(staffTalks.employeeId, user.employeeId))).get()
  if (!row) throw new ServiceError(404, 'form_not_found')
  const form = { ...row.form, role: row.role, talkId: row.talkId }
  if (!visibleToEmployee(form)) {
    if (writing && form.role === 'self' && form.state === 'draft') throw new ServiceError(409, 'form_release_withdrawn')
    throw new ServiceError(404, 'form_not_found')
  }
  return { talk: row.talk, form }
}

/** The talk's employee and facility by name, for the printout's header. */
function printNames(db: Db, talk: TalkRow): { employeeName: string; facilityName: string } {
  const employee = db.select({ name: employees.name }).from(employees).where(eq(employees.id, talk.employeeId)).get()
  const facility = db.select({ name: facilities.name }).from(facilities).where(eq(facilities.id, talk.facilityId)).get()
  return { employeeName: employee?.name ?? '', facilityName: facility?.name ?? '' }
}

export function getMyTalkForm(db: Db, user: SessionUser, formId: number): MyTalkFormDto {
  const { talk, form } = loadMyForm(db, user, formId)
  return { talk: toHeader(talk), form: toFormDto(form), ...printNames(db, talk) }
}

/** Any form of the facility's talks with its talk (Leitung and Träger: the print page); 404 form_not_found otherwise. */
export function getTalkForm(db: Db, scope: TalkScope, formId: number): MyTalkFormDto {
  const form = loadTalkForm(db, scope, formId)
  const talk = loadTalk(db, scope, form.talkId)
  return { talk: toHeader(talk), form: toFormDto(form), ...printNames(db, talk) }
}

/**
 * The employee saves their self form while it is released to them (409 form_not_editable otherwise, 409
 * employee_inactive once they have left, 409 form_changed when the Leitung saved in between).
 */
export function saveMyTalkFormAnswers(
  db: Db, user: SessionUser, formId: number, answers: unknown, expectedUpdatedAt: string, now: Date = new Date(),
): FormSavedDto {
  const { talk, form } = loadMyForm(db, user, formId, true)
  if (form.role !== 'self' || form.state !== 'released') throw new ServiceError(409, 'form_not_editable')
  assertNotLeft(db, talk.employeeId, todayIso(now))
  return writeAnswers(db, user, form, answers, expectedUpdatedAt, now, 'released')
}

/** „Abgeben“: the released self form is submitted; the employee can no longer change it (not after leaving). */
export function submitMyTalkForm(
  db: Db, user: SessionUser, formId: number, expectedUpdatedAt: string, now: Date = new Date(),
): void {
  const { talk, form } = loadMyForm(db, user, formId, true)
  assertNotLeft(db, talk.employeeId, todayIso(now))
  if (form.role !== 'self' || form.state !== 'released') throw new ServiceError(409, 'form_state_invalid')
  // The employee submits what they have seen: a newer save of the Leitung is shown first (409 form_changed).
  if (form.updatedAt !== expectedUpdatedAt) throw new ServiceError(409, 'form_changed')
  transition(db, form, 'released', { state: 'submitted', submittedAt: now.toISOString() }, expectedUpdatedAt)
}

/**
 * An employee moved to another facility: their talks and the talks' forms go along (the new Leitung sees them, the old
 * one no longer). Call it inside the move's transaction.
 */
export function moveStaffTalks(db: Db, employeeId: number, facilityId: number): void {
  const talkIds = db.select({ id: staffTalks.id }).from(staffTalks).where(eq(staffTalks.employeeId, employeeId)).all()
    .map(row => row.id)
  if (talkIds.length === 0) return
  db.update(staffTalks).set({ facilityId }).where(inArray(staffTalks.id, talkIds)).run()
  const formIds = db.select({ id: staffTalkForms.formId }).from(staffTalkForms).where(inArray(staffTalkForms.talkId, talkIds))
    .all().map(row => row.id)
  // The templates stay with the old facility; the forms keep their own copy of the content, so the link is dropped
  // (otherwise the old facility could neither see the form nor delete the template).
  if (formIds.length > 0) db.update(forms).set({ facilityId, templateId: null }).where(inArray(forms.id, formIds)).run()
}
