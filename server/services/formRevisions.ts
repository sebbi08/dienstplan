import { and, count, desc, eq, inArray, sql } from 'drizzle-orm'
import { changedItemIds, itemChanges, type ItemChange } from '../../shared/domain/formHistory'
import type { FormAnswers, FormContent } from '../../shared/domain/forms'
import type { FormRevisionDto, FormRevisionsDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { formReads, formRevisions } from '../db/schema'
import type { ChildViewer } from '../lib/childViewer'
import { ServiceError } from '../lib/errors'

/**
 * The stored history of a form's answers and the last openings (no rights checked here: the callers have checked that
 * the viewer may read or edit the form, see server/services/childForms.ts, childFormHistory.ts and staffTalks.ts).
 */

/** Revisions per page of „Verlauf“ (all are kept; the list is paged). */
export const REVISION_PAGE_SIZE = 20

/**
 * Stores a revision for a save that changed answers (`before` → `after`, judged against the form's content); nothing
 * for a save that changed none (only the header, or the same answers again). Call it in the save's transaction.
 */
export function recordRevision(
  db: Db, formId: number, content: FormContent, before: FormAnswers, after: FormAnswers, savedBy: string, savedAt: string,
): void {
  const changed = changedItemIds(content, before, after)
  if (changed.length === 0) return
  db.insert(formRevisions).values({
    formId, savedAt, savedBy, answers: JSON.stringify(after), changedItemIds: JSON.stringify(changed),
  }).run()
}

/**
 * Stores a revision that changes nothing (`initial`): the state a form starts its history with, e.g. the answers copied
 * into a new staff talk form, attributed to the copy.
 */
export function recordInitialRevision(db: Db, formId: number, answers: FormAnswers, savedBy: string, savedAt: string): void {
  db.insert(formRevisions).values({ formId, savedAt, savedBy, answers: JSON.stringify(answers), changedItemIds: '[]', initial: true }).run()
}

/** The last change of each item of the forms that was ever changed (from their revisions, newest first), by form. */
export function itemChangesByForm(db: Db, formIds: number[]): Map<number, Record<string, ItemChange>> {
  const stamps = new Map<number, { savedAt: string; savedBy: string; changedItemIds: string[] }[]>(formIds.map(id => [id, []]))
  if (formIds.length === 0) return new Map()
  const rows = db.select({
    formId: formRevisions.formId, savedAt: formRevisions.savedAt, savedBy: formRevisions.savedBy, changed: formRevisions.changedItemIds,
  }).from(formRevisions).where(and(inArray(formRevisions.formId, formIds), eq(formRevisions.initial, false)))
    .orderBy(desc(formRevisions.id)).all()
  for (const row of rows) {
    stamps.get(row.formId)!.push({ savedAt: row.savedAt, savedBy: row.savedBy, changedItemIds: JSON.parse(row.changed) as string[] })
  }
  return new Map([...stamps].map(([formId, list]) => [formId, itemChanges(list)]))
}

/** The last change of each item of the form that was ever changed (from its revisions, newest first). */
export function itemChangesOf(db: Db, formId: number): Record<string, ItemChange> {
  return itemChangesByForm(db, [formId]).get(formId)!
}

const listColumns = {
  id: formRevisions.id, savedAt: formRevisions.savedAt, savedBy: formRevisions.savedBy, initial: formRevisions.initial,
  changedCount: sql<number>`json_array_length(${formRevisions.changedItemIds})`,
}

/** A page of the form's revisions, newest first (REVISION_PAGE_SIZE per page from `offset` on). */
export function revisionPage(db: Db, formId: number, offset: number): FormRevisionsDto {
  const total = db.select({ n: count() }).from(formRevisions).where(eq(formRevisions.formId, formId)).get()!.n
  const revisions = db.select(listColumns).from(formRevisions).where(eq(formRevisions.formId, formId))
    .orderBy(desc(formRevisions.id)).limit(REVISION_PAGE_SIZE).offset(offset).all()
  return { revisions, total, offset, pageSize: REVISION_PAGE_SIZE }
}

/** One stored state of the form (404 form_revision_not_found when it is not one of this form's). */
export function revisionOf(db: Db, formId: number, revisionId: number): FormRevisionDto {
  const row = db.select({ ...listColumns, answers: formRevisions.answers, changed: formRevisions.changedItemIds }).from(formRevisions)
    .where(and(eq(formRevisions.id, revisionId), eq(formRevisions.formId, formId))).get()
  if (!row) throw new ServiceError(404, 'form_revision_not_found')
  const { answers, changed, ...rest } = row
  return { ...rest, answers: JSON.parse(answers) as FormAnswers, changedItemIds: JSON.parse(changed) as string[] }
}

/** Whose openings count: the account in the office, the unlocking employee at the tablet; null when there is neither. */
type Reader = { userId: number; employeeId?: undefined } | { employeeId: number; userId?: undefined }

function readerOf(viewer: Pick<ChildViewer, 'onTablet' | 'id' | 'employeeId'>): Reader | null {
  if (viewer.onTablet) return viewer.employeeId === null ? null : { employeeId: viewer.employeeId }
  return viewer.id === null ? null : { userId: viewer.id }
}

const readsOf = (reader: Reader, formId: number) => and(
  eq(formReads.formId, formId),
  reader.userId !== undefined ? eq(formReads.userId, reader.userId) : eq(formReads.employeeId, reader.employeeId),
)

/** When the viewer last opened the form (null = never, or nobody to record it for). */
export function lastOpened(db: Db, viewer: Pick<ChildViewer, 'onTablet' | 'id' | 'employeeId'>, formId: number): string | null {
  const reader = readerOf(viewer)
  if (!reader) return null
  return db.select({ openedAt: formReads.openedAt }).from(formReads).where(readsOf(reader, formId)).get()?.openedAt ?? null
}

/** Records that the viewer opened (or saved) the form now. */
export function markOpened(db: Db, viewer: Pick<ChildViewer, 'onTablet' | 'id' | 'employeeId'>, formId: number, at: string): void {
  const reader = readerOf(viewer)
  if (!reader) return
  db.transaction((tx) => {
    const updated = tx.update(formReads).set({ openedAt: sql`max(${formReads.openedAt}, ${at})` }).where(readsOf(reader, formId)).run()
    if (updated.changes === 0) tx.insert(formReads).values({ formId, ...reader, openedAt: at }).run()
  })
}
