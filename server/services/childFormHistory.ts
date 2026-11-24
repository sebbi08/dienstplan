import { and, count, desc, eq, sql } from 'drizzle-orm'
import type { FormAnswers } from '../../shared/domain/forms'
import type { ChildFormRevisionDto, ChildFormRevisionsDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { formRevisions } from '../db/schema'
import type { ChildViewer } from '../lib/childViewer'
import { ServiceError } from '../lib/errors'
import { readableChildForm } from './childForms'
import { markOpened, REVISION_PAGE_SIZE } from './formRevisions'

/**
 * „Verlauf“ of a child form and the record of its openings. Everyone who may open the form (getChildForm: the same 404s,
 * at the tablet too) may read its history, also with the read right only; nothing here changes the form.
 */

const listColumns = {
  id: formRevisions.id, savedAt: formRevisions.savedAt, savedBy: formRevisions.savedBy, initial: formRevisions.initial,
  changedCount: sql<number>`json_array_length(${formRevisions.changedItemIds})`,
}

/** A page of the form's revisions, newest first (REVISION_PAGE_SIZE per page from `offset` on). */
export function listChildFormRevisions(
  db: Db, viewer: ChildViewer, formId: number, offset: number, now: Date = new Date(),
): ChildFormRevisionsDto {
  const { form } = readableChildForm(db, viewer, formId, now)
  const total = db.select({ n: count() }).from(formRevisions).where(eq(formRevisions.formId, form.id)).get()!.n
  const revisions = db.select(listColumns).from(formRevisions).where(eq(formRevisions.formId, form.id))
    .orderBy(desc(formRevisions.id)).limit(REVISION_PAGE_SIZE).offset(offset).all()
  return { revisions, total, offset, pageSize: REVISION_PAGE_SIZE }
}

/** One stored state of the form (404 form_revision_not_found when it is not one of this form's). */
export function getChildFormRevision(
  db: Db, viewer: ChildViewer, formId: number, revisionId: number, now: Date = new Date(),
): ChildFormRevisionDto {
  const { form } = readableChildForm(db, viewer, formId, now)
  const row = db.select({ ...listColumns, answers: formRevisions.answers, changed: formRevisions.changedItemIds }).from(formRevisions)
    .where(and(eq(formRevisions.id, revisionId), eq(formRevisions.formId, form.id))).get()
  if (!row) throw new ServiceError(404, 'form_revision_not_found')
  const { answers, changed, ...rest } = row
  return { ...rest, answers: JSON.parse(answers) as FormAnswers, changedItemIds: JSON.parse(changed) as string[] }
}

/**
 * Records that the viewer opened the form (after it showed the markers of `changedSinceSeen`): the account in the
 * office, the unlocking employee at the tablet.
 */
export function markChildFormOpened(db: Db, viewer: ChildViewer, formId: number, now: Date = new Date()): void {
  const { form } = readableChildForm(db, viewer, formId, now)
  markOpened(db, viewer, form.id, now.toISOString())
}
