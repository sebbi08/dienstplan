import type { FormRevisionDto, FormRevisionsDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import type { ChildViewer } from '../lib/childViewer'
import { readableChildForm } from './childForms'
import { markOpened, revisionOf, revisionPage } from './formRevisions'

/**
 * „Verlauf“ of a child form and the record of its openings. Everyone who may open the form (getChildForm: the same 404s,
 * at the tablet too) may read its history, also with the read right only; nothing here changes the form.
 */

/** A page of the form's revisions, newest first (REVISION_PAGE_SIZE per page from `offset` on). */
export function listChildFormRevisions(
  db: Db, viewer: ChildViewer, formId: number, offset: number, now: Date = new Date(),
): FormRevisionsDto {
  return revisionPage(db, readableChildForm(db, viewer, formId, now).form.id, offset)
}

/** One stored state of the form (404 form_revision_not_found when it is not one of this form's). */
export function getChildFormRevision(
  db: Db, viewer: ChildViewer, formId: number, revisionId: number, now: Date = new Date(),
): FormRevisionDto {
  return revisionOf(db, readableChildForm(db, viewer, formId, now).form.id, revisionId)
}

/**
 * Records that the viewer opened the form (after it showed the markers of `changedSinceSeen`): the account in the
 * office, the unlocking employee at the tablet. `seenUntil` is the `updatedAt` of the state the viewer loaded: a save
 * between loading and this call stays unseen (and marked next time). A time after now counts as now.
 */
export function markChildFormOpened(db: Db, viewer: ChildViewer, formId: number, seenUntil: string, now: Date = new Date()): void {
  const { form } = readableChildForm(db, viewer, formId, now)
  const at = now.toISOString()
  markOpened(db, viewer, form.id, seenUntil < at ? seenUntil : at)
}
