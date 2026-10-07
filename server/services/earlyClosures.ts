import { and, asc, eq, gte, lte, ne } from 'drizzle-orm'
import type { IsoDate, Minutes } from '../../shared/domain/types'
import type { EarlyClosureDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { earlyClosures } from '../db/schema'
import { ServiceError } from '../lib/errors'

export interface EarlyClosureInput {
  date: IsoDate
  closedFrom: Minutes
  reason: string
}

/** Trimmed input; one early closure per day and facility. */
function normalize(db: Db, facilityId: number, input: EarlyClosureInput, ignoreId: number | null): EarlyClosureInput {
  const reason = input.reason.trim()
  if (!reason) throw new ServiceError(400, 'reason_required')
  const taken = db.select().from(earlyClosures)
    .where(and(
      eq(earlyClosures.facilityId, facilityId), eq(earlyClosures.date, input.date),
      ignoreId === null ? undefined : ne(earlyClosures.id, ignoreId),
    )).get()
  if (taken) throw new ServiceError(409, 'early_closure_exists')
  return { ...input, reason }
}

const dtoColumns = {
  id: earlyClosures.id, date: earlyClosures.date, closedFrom: earlyClosures.closedFrom, reason: earlyClosures.reason,
}

function ownClosure(facilityId: number, id: number) {
  return and(eq(earlyClosures.id, id), eq(earlyClosures.facilityId, facilityId))
}

export function listEarlyClosures(db: Db, facilityId: number, year: number): EarlyClosureDto[] {
  return db.select(dtoColumns).from(earlyClosures)
    .where(and(
      eq(earlyClosures.facilityId, facilityId), gte(earlyClosures.date, `${year}-01-01`), lte(earlyClosures.date, `${year}-12-31`),
    ))
    .orderBy(asc(earlyClosures.date)).all()
}

export function createEarlyClosure(db: Db, facilityId: number, input: EarlyClosureInput): EarlyClosureDto {
  return db.insert(earlyClosures).values({ facilityId, ...normalize(db, facilityId, input, null) }).returning(dtoColumns).get()
}

export function updateEarlyClosure(db: Db, facilityId: number, id: number, input: EarlyClosureInput): void {
  if (!db.select().from(earlyClosures).where(ownClosure(facilityId, id)).get()) throw new ServiceError(404, 'early_closure_not_found')
  db.update(earlyClosures).set(normalize(db, facilityId, input, id)).where(ownClosure(facilityId, id)).run()
}

export function deleteEarlyClosure(db: Db, facilityId: number, id: number): void {
  db.delete(earlyClosures).where(ownClosure(facilityId, id)).run()
}
