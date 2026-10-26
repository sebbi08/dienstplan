import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import {
  canCreateChildForm, canManageChildForms, childFormRight, type ChildFormRight, type ChildFormViewer,
} from '../../shared/domain/childForms'
import { childStatus, hiddenFromViewer } from '../../shared/domain/children'
import { isValidIsoDate } from '../../shared/domain/dates'
import { checkAnswers, type FormAnswers, type FormContent } from '../../shared/domain/forms'
import { isManager } from '../../shared/domain/roles'
import { nowInBerlin } from '../../shared/domain/timeRecords'
import type {
  ChildFormDto, ChildFormEditorDto, ChildFormInput, ChildFormListItemDto, ChildFormSavedDto, ChildFormSaveInput,
  ChildFormsDto,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { childParentMeetings, employees, facilities, formEditors, forms, groups } from '../db/schema'
import { assertGroupRight, loadChild, type ChildRow } from '../lib/childRecord'
import type { ChildViewer } from '../lib/childViewer'
import { ServiceError } from '../lib/errors'
import { listTemplates, loadTemplate, withFormErrors } from './formTemplates'

export const CHILD_FORM_LIMITS = { participants: 300 } as const

type FormRow = typeof forms.$inferSelect
type ChildForm = FormRow & { childId: number }

/** The child as the viewer sees it, with whether it is archived; 404 child_not_found when the viewer does not see it. */
interface VisibleChild { row: ChildRow; archived: boolean }

/**
 * The facility's child under the viewer's visibility, as the record itself (see `getChild`): an archived record only
 * for managers, nothing the tablet hides from the viewer, no group the viewer does not see (all 404 child_not_found).
 */
function loadVisibleChild(db: Db, viewer: ChildViewer, childId: number, now: Date): VisibleChild {
  const today = nowInBerlin(now).date
  const row = loadChild(db, viewer.facilityId, childId)
  const archived = childStatus(row, today) === 'archived'
  if (archived && !isManager(viewer.role)) throw new ServiceError(404, 'child_not_found')
  if (hiddenFromViewer(row, viewer.visibility, today)) throw new ServiceError(404, 'child_not_found')
  assertGroupRight(viewer, row.groupId, 'read')
  return { row, archived }
}

/** A child form of the viewer's facility (404 form_not_found otherwise) with its child as the viewer sees it. */
function loadForm(db: Db, viewer: ChildViewer, formId: number, now: Date): { form: ChildForm; child: VisibleChild } {
  const form = db.select().from(forms)
    .where(and(eq(forms.id, formId), eq(forms.facilityId, viewer.facilityId), eq(forms.kind, 'child'))).get()
  if (!form || form.childId === null) throw new ServiceError(404, 'form_not_found')
  return { form: form as ChildForm, child: loadVisibleChild(db, viewer, form.childId, now) }
}

const asRightViewer = (viewer: ChildViewer): ChildFormViewer =>
  ({ role: viewer.role, onTablet: viewer.onTablet, employeeId: viewer.employeeId, canSeeChild: true })

/** The employees unlocked for each of these forms. */
function editorsOf(db: Db, formIds: number[]): Map<number, Set<number>> {
  const result = new Map<number, Set<number>>(formIds.map(id => [id, new Set()]))
  if (formIds.length === 0) return result
  for (const row of db.select({ formId: formEditors.formId, employeeId: formEditors.employeeId }).from(formEditors)
    .where(inArray(formEditors.formId, formIds)).all()) {
    result.get(row.formId)!.add(row.employeeId)
  }
  return result
}

/** The viewer's right on one form of the child; an archived record is only read (it cannot be changed any more). */
function rightOn(viewer: ChildViewer, child: VisibleChild, formId: number, editors: ReadonlySet<number>): ChildFormRight {
  const right = childFormRight(asRightViewer(viewer), { keyEducatorId: child.row.keyEducatorId }, { id: formId }, editors)
  return right === 'edit' && child.archived ? 'read' : right
}

/** The viewer's right, refusing a viewer without one (404 child_not_found: they must not learn of the child). */
function access(viewer: ChildViewer, child: VisibleChild, formId: number, editors: ReadonlySet<number>): 'read' | 'edit' {
  const right = rightOn(viewer, child, formId, editors)
  if (right === 'none') throw new ServiceError(404, 'child_not_found')
  return right
}

/** `canManage` is off on an archived record: unlocking and deleting are refused there (409 child_archived). */
function toListItem(form: ChildForm, right: 'read' | 'edit', viewer: ChildViewer, child: VisibleChild): ChildFormListItemDto {
  return {
    id: form.id, childId: form.childId, templateId: form.templateId, title: form.title, date: form.formDate ?? '',
    start: form.formStart, participants: form.formParticipants, parentMeetingId: form.parentMeetingId,
    updatedAt: form.updatedAt, updatedBy: form.updatedBy, right, canManage: canManageChildForms(viewer) && !child.archived,
  }
}

/** The child's forms, newest first (by date, then time), each with the viewer's right; and whether they may start one. */
export function listChildForms(db: Db, viewer: ChildViewer, childId: number, now: Date = new Date()): ChildFormsDto {
  const child = loadVisibleChild(db, viewer, childId, now)
  const rows = db.select().from(forms).where(and(eq(forms.childId, childId), eq(forms.kind, 'child')))
    .orderBy(desc(forms.formDate), desc(forms.formStart), desc(forms.id)).all() as ChildForm[]
  const editors = editorsOf(db, rows.map(row => row.id))
  const canCreate = !child.archived && canCreateChildForm(asRightViewer(viewer), { keyEducatorId: child.row.keyEducatorId })
  // The tablet cannot read the template list itself (managers only), so whoever may start a form gets the choice here.
  const templates = canCreate
    ? listTemplates(db, viewer.facilityId, 'child').filter(template => !template.archived)
        .map(template => ({ id: template.id, name: template.name }))
    : []
  return {
    forms: rows.map(row => toListItem(row, access(viewer, child, row.id, editors.get(row.id)!), viewer, child)),
    canCreate,
    templates,
  }
}

/** One form with its content, answers and the printout's header (child, group, facility). */
export function getChildForm(db: Db, viewer: ChildViewer, formId: number, now: Date = new Date()): ChildFormDto {
  const { form, child } = loadForm(db, viewer, formId, now)
  const right = access(viewer, child, form.id, editorsOf(db, [form.id]).get(form.id)!)
  const groupName = child.row.groupId === null ? null
    : db.select({ name: groups.name }).from(groups).where(eq(groups.id, child.row.groupId)).get()?.name ?? null
  const facilityName = db.select({ name: facilities.name }).from(facilities).where(eq(facilities.id, form.facilityId)).get()?.name ?? ''
  return {
    ...toListItem(form, right, viewer, child),
    content: JSON.parse(form.content) as FormContent,
    answers: JSON.parse(form.answers) as FormAnswers,
    child: { firstName: child.row.firstName, lastName: child.row.lastName, birthDate: child.row.birthDate, groupName },
    facilityName,
  }
}

interface Header { date: string; start: number | null; participants: string }

/** A valid ISO date, a start of 0–1439 minutes or none, participants trimmed to at most 300 characters. */
function checkedHeader(input: Header): Header {
  if (typeof input.date !== 'string' || !isValidIsoDate(input.date)) throw new ServiceError(400, 'child_form_date_invalid')
  if (input.start !== null && (!Number.isInteger(input.start) || input.start < 0 || input.start > 1439)) {
    throw new ServiceError(400, 'child_form_start_invalid')
  }
  const participants = input.participants.trim()
  if (participants.length > CHILD_FORM_LIMITS.participants) throw new ServiceError(400, 'child_form_participants_too_long')
  return { date: input.date, start: input.start, participants }
}

/** 409 child_archived: an archived record is only read. */
function assertNotArchived(child: VisibleChild): void {
  if (child.archived) throw new ServiceError(409, 'child_archived')
}

/** A parent meeting with an observation form already has one (409 child_form_meeting_taken). */
function assertMeetingFree(db: Db, meetingId: number): void {
  const taken = db.select({ id: forms.id }).from(forms).where(eq(forms.parentMeetingId, meetingId)).get()
  if (taken) throw new ServiceError(409, 'child_form_meeting_taken')
}

/**
 * A new form for the child from an active child template of the facility (its content copied, titled like it); returns
 * its id. Managers and, at the tablet, the child's key educator may (403 forbidden otherwise). From a parent meeting of
 * the child the header is the meeting's date, start and participants, and the two are linked (one form per meeting).
 */
export function createChildForm(
  db: Db, viewer: ChildViewer, childId: number, input: ChildFormInput, now: Date = new Date(),
): number {
  const child = loadVisibleChild(db, viewer, childId, now)
  assertNotArchived(child)
  if (!canCreateChildForm(asRightViewer(viewer), { keyEducatorId: child.row.keyEducatorId })) {
    throw new ServiceError(403, 'forbidden')
  }
  const template = loadTemplate(db, viewer.facilityId, input.templateId)
  if (template.kind !== 'child') throw new ServiceError(404, 'form_template_not_found')
  if (template.archived) throw new ServiceError(409, 'form_template_archived')
  let header: Header
  let parentMeetingId: number | null = null
  if (input.parentMeetingId !== undefined) {
    const meeting = db.select().from(childParentMeetings)
      .where(and(eq(childParentMeetings.id, input.parentMeetingId), eq(childParentMeetings.childId, childId))).get()
    if (!meeting) throw new ServiceError(404, 'meeting_not_found')
    assertMeetingFree(db, meeting.id)
    header = { date: meeting.date, start: meeting.start, participants: meeting.participants.slice(0, CHILD_FORM_LIMITS.participants) }
    parentMeetingId = meeting.id
  }
  else {
    header = checkedHeader(input)
  }
  const at = now.toISOString()
  try {
    return db.insert(forms).values({
      facilityId: viewer.facilityId, templateId: template.id, kind: 'child', title: template.name, content: template.content,
      answers: '{}', createdAt: at, updatedAt: at, updatedBy: viewer.name, childId, parentMeetingId,
      formDate: header.date, formStart: header.start, formParticipants: header.participants,
    }).returning({ id: forms.id }).get().id
  }
  catch (error) {
    // Someone filled a form for the meeting at the same moment (the unique index on the link).
    if (parentMeetingId !== null && String((error as Error).message).includes('UNIQUE')) {
      throw new ServiceError(409, 'child_form_meeting_taken')
    }
    throw error
  }
}

/**
 * Stores the header and the answers (checked against the form's own content) for a viewer with the edit right (403
 * forbidden otherwise). `expectedUpdatedAt` is the last change the saver had loaded; when someone saved in between,
 * nothing is written (409 form_changed). Returns the new last change.
 */
export function saveChildForm(
  db: Db, viewer: ChildViewer, formId: number, input: ChildFormSaveInput, now: Date = new Date(),
): ChildFormSavedDto {
  const { form, child } = loadForm(db, viewer, formId, now)
  assertNotArchived(child)
  if (access(viewer, child, form.id, editorsOf(db, [form.id]).get(form.id)!) !== 'edit') {
    throw new ServiceError(403, 'forbidden')
  }
  if (form.updatedAt !== input.expectedUpdatedAt) throw new ServiceError(409, 'form_changed')
  const header = checkedHeader(input)
  const answers = withFormErrors(() => checkAnswers(JSON.parse(form.content) as FormContent, input.answers))
  const updatedAt = now.toISOString()
  const result = db.update(forms).set({
    answers: JSON.stringify(answers), formDate: header.date, formStart: header.start, formParticipants: header.participants,
    updatedAt, updatedBy: viewer.name,
  }).where(and(eq(forms.id, form.id), eq(forms.updatedAt, input.expectedUpdatedAt))).run()
  if (result.changes !== 1) throw new ServiceError(409, 'form_changed')
  return { updatedAt, updatedBy: viewer.name }
}

/** 403 forbidden unless Leitung or Träger. */
function assertManager(viewer: ChildViewer): void {
  if (!canManageChildForms(viewer)) throw new ServiceError(403, 'forbidden')
}

/** Deletes a form with its unlocked employees (Leitung and Träger only). */
export function deleteChildForm(db: Db, viewer: ChildViewer, formId: number, now: Date = new Date()): void {
  const { form, child } = loadForm(db, viewer, formId, now)
  assertManager(viewer)
  assertNotArchived(child)
  db.delete(forms).where(eq(forms.id, form.id)).run()
}

function editorList(db: Db, formId: number): ChildFormEditorDto[] {
  return db.select({
    employeeId: formEditors.employeeId, name: employees.name, grantedAt: formEditors.grantedAt, grantedBy: formEditors.grantedBy,
  }).from(formEditors).innerJoin(employees, eq(employees.id, formEditors.employeeId))
    .where(eq(formEditors.formId, formId)).orderBy(asc(employees.name), asc(employees.id)).all()
}

/** The employees unlocked for the form (Leitung and Träger only). */
export function listChildFormEditors(db: Db, viewer: ChildViewer, formId: number, now: Date = new Date()): ChildFormEditorDto[] {
  const { form } = loadForm(db, viewer, formId, now)
  assertManager(viewer)
  return editorList(db, form.id)
}

/**
 * „Mitarbeiter freischalten“: the form's unlocked employees become exactly these employees of the facility (404
 * employee_not_found for any other); grants that stay keep their date, new ones are stored with the manager's name.
 * Leitung and Träger only; returns the new list.
 */
export function setChildFormEditors(
  db: Db, viewer: ChildViewer, formId: number, employeeIds: number[], now: Date = new Date(),
): ChildFormEditorDto[] {
  const { form, child } = loadForm(db, viewer, formId, now)
  assertManager(viewer)
  assertNotArchived(child)
  const wanted = [...new Set(employeeIds)]
  const current = editorsOf(db, [form.id]).get(form.id)!
  if (wanted.length > 0) {
    const known = db.select({ id: employees.id, leftOn: employees.leftOn }).from(employees)
      .where(and(inArray(employees.id, wanted), eq(employees.facilityId, viewer.facilityId))).all()
    if (known.length !== wanted.length) throw new ServiceError(404, 'employee_not_found')
    // Nobody who has left is unlocked anew (a grant they already have may stay until it is revoked).
    const today = nowInBerlin(now).date
    if (known.some(employee => !current.has(employee.id) && employee.leftOn !== null && employee.leftOn < today)) {
      throw new ServiceError(409, 'employee_inactive')
    }
  }
  const at = now.toISOString()
  db.transaction((tx) => {
    const gone = [...current].filter(id => !wanted.includes(id))
    if (gone.length > 0) {
      tx.delete(formEditors).where(and(eq(formEditors.formId, form.id), inArray(formEditors.employeeId, gone))).run()
    }
    const added = wanted.filter(id => !current.has(id))
    if (added.length > 0) {
      tx.insert(formEditors).values(added.map(employeeId => ({ formId: form.id, employeeId, grantedAt: at, grantedBy: viewer.name })))
        .run()
    }
  })
  return editorList(db, form.id)
}

/**
 * A child record moved to another facility: its forms go along. The templates stay with the old facility (the forms
 * keep their own copy of the content, so the link is dropped) and so do its employees (their grants are removed). Call
 * it inside the move's transaction.
 */
export function moveChildForms(db: Db, childId: number, facilityId: number): void {
  const formIds = db.select({ id: forms.id }).from(forms).where(eq(forms.childId, childId)).all().map(row => row.id)
  if (formIds.length === 0) return
  db.update(forms).set({ facilityId, templateId: null }).where(inArray(forms.id, formIds)).run()
  db.delete(formEditors).where(inArray(formEditors.formId, formIds)).run()
}
