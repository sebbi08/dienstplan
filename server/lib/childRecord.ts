import { and, eq } from 'drizzle-orm'
import { childStatus, hiddenFromViewer } from '../../shared/domain/children'
import { groupRight } from '../../shared/domain/groupAccess'
import { isManager } from '../../shared/domain/roles'
import { REVIEW_SECTIONS, type GroupAccess, type ReviewSection } from '../../shared/types/api'
import type { IsoDate } from '../../shared/domain/types'
import type { Db } from '../db/client'
import { children } from '../db/schema'
import type { ChildViewer } from './childViewer'
import { ServiceError } from './errors'

export type ChildRow = typeof children.$inferSelect
export type ChildSection = 'master' | 'contacts' | 'health' | 'consents'

/** The facility's child; another facility's or an unknown id answers 404 child_not_found. */
export function loadChild(db: Db, facilityId: number, id: number): ChildRow {
  const row = db.select().from(children).where(and(eq(children.id, id), eq(children.facilityId, facilityId))).get()
  if (!row) throw new ServiceError(404, 'child_not_found')
  return row
}

/**
 * Whether the viewer's group access (group book spec §3.1) lets them `need` the records of a child in this group (its
 * current group, `children.groupId`): a hidden group answers 404 `notFound` (as if the record did not exist), a group
 * the viewer may only read refuses a write with 403 group_read_only.
 */
export function assertGroupRight(
  viewer: Pick<ChildViewer, 'groups'>, groupId: number | null, need: 'read' | 'write', notFound = 'child_not_found',
): void {
  const right = groupRight(groupId, viewer.groups)
  if (right === 'none') throw new ServiceError(404, notFound)
  if (need === 'write' && right === 'read') throw new ServiceError(403, 'group_read_only')
}

/** Whether a viewer with this group access sees the records of a child in this group at all (for the lists). */
export function seesGroup(groups: GroupAccess | null, groupId: number | null): boolean {
  return groupRight(groupId, groups) !== 'none'
}

/**
 * Like `loadChild`, but a child who has left (archived) cannot be changed any more: 409 child_archived for managers;
 * everybody else must not even know the record exists (404 child_not_found, as when reading it). Nor can a child the
 * facility's tablet hides from the actor or whose group the actor does not see (404 child_not_found), and one of a
 * group the actor may only read is not changed either (403 group_read_only). Every write of a record goes through here.
 */
export function loadEditableChild(
  db: Db, actor: Pick<ChildViewer, 'role' | 'visibility' | 'groups'>, facilityId: number, id: number, today: IsoDate,
): ChildRow {
  const row = loadChild(db, facilityId, id)
  if (childStatus(row, today) === 'archived') {
    throw isManager(actor.role) ? new ServiceError(409, 'child_archived') : new ServiceError(404, 'child_not_found')
  }
  if (hiddenFromViewer(row, actor.visibility, today)) throw new ServiceError(404, 'child_not_found')
  assertGroupRight(actor, row.groupId, 'write')
  return row
}

/** The child's column holding the day since which a section has to be confirmed again (null = nothing to confirm). */
export const REVIEW_COLUMN = {
  contacts: 'contactsReviewSince', health: 'healthReviewSince', consents: 'consentsReviewSince',
  documents: 'documentsReviewSince', careType: 'careTypeReviewSince', keyEducator: 'keyEducatorReviewSince',
  contract: 'contractReviewSince',
} as const satisfies Record<ReviewSection, keyof ChildRow>

/**
 * The record section whose stamp a confirmation sets: care type and Bezugserzieher are part of the master data; the
 * documents and the care contract (a document as well) have no stamp (each document carries its own upload data).
 */
export const REVIEW_STAMP_SECTION: Record<ReviewSection, ChildSection | null> = {
  contacts: 'contacts', health: 'health', consents: 'consents', documents: null, careType: 'master', keyEducator: 'master',
  contract: null,
}

/** The columns that clear the markers of these sections (to set on the child). */
export function clearedReviews(...sections: ReviewSection[]): Partial<ChildRow> {
  return Object.fromEntries(sections.map(section => [REVIEW_COLUMN[section], null]))
}

/** The sections of the record that are still to be confirmed, with the day since which they are. */
export function openReviews(row: ChildRow): Partial<Record<ReviewSection, IsoDate>> {
  return Object.fromEntries(REVIEW_SECTIONS.flatMap((section) => {
    const since = row[REVIEW_COLUMN[section]]
    return since === null ? [] : [[section, since]]
  }))
}

/** Marks a section of the record as changed by the actor at `now` (the columns to set on the child). */
export function sectionStamp(section: ChildSection, actorId: number, now: Date): Partial<ChildRow> {
  const at = now.toISOString()
  switch (section) {
    case 'master': return { masterUpdatedAt: at, masterUpdatedBy: actorId }
    case 'contacts': return { contactsUpdatedAt: at, contactsUpdatedBy: actorId }
    case 'health': return { healthUpdatedAt: at, healthUpdatedBy: actorId }
    case 'consents': return { consentsUpdatedAt: at, consentsUpdatedBy: actorId }
  }
}
