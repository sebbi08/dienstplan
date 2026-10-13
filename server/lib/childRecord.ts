import { and, eq } from 'drizzle-orm'
import { childStatus } from '../../shared/domain/children'
import { isManager } from '../../shared/domain/roles'
import { REVIEW_SECTIONS, type ReviewSection, type Role } from '../../shared/types/api'
import type { IsoDate } from '../../shared/domain/types'
import type { Db } from '../db/client'
import { children } from '../db/schema'
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
 * Like `loadChild`, but a child who has left (archived) cannot be changed any more: 409 child_archived for managers;
 * everybody else must not even know the record exists (404 child_not_found, as when reading it).
 */
export function loadEditableChild(
  db: Db, actor: { role: Role | null }, facilityId: number, id: number, today: IsoDate,
): ChildRow {
  const row = loadChild(db, facilityId, id)
  if (childStatus(row, today) === 'archived') {
    throw isManager(actor.role) ? new ServiceError(409, 'child_archived') : new ServiceError(404, 'child_not_found')
  }
  return row
}

/** The child's column holding the day since which a section has to be confirmed again (null = nothing to confirm). */
export const REVIEW_COLUMN = {
  contacts: 'contactsReviewSince', health: 'healthReviewSince', consents: 'consentsReviewSince',
  documents: 'documentsReviewSince', careType: 'careTypeReviewSince', keyEducator: 'keyEducatorReviewSince',
} as const satisfies Record<ReviewSection, keyof ChildRow>

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
