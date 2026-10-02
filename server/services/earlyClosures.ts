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

function normalize(db: Db, input: EarlyClosureInput, ignoreId: number | null): EarlyClosureInput {
  const reason = input.reason.trim()
  if (!reason) throw new ServiceError(400, 'reason_required')
  const taken = db.select().from(earlyClosures)
    .where(and(eq(earlyClosures.date, input.date), ignoreId === null ? undefined : ne(earlyClosures.id, ignoreId))).get()
  if (taken) throw new ServiceError(409, 'early_closure_exists')
  return { ...input, reason }
}

export function listEarlyClosures(db: Db, year: number): EarlyClosureDto[] {
  return db.select().from(earlyClosures)
    .where(and(gte(earlyClosures.date, `${year}-01-01`), lte(earlyClosures.date, `${year}-12-31`)))
    .orderBy(asc(earlyClosures.date)).all()
}

export function createEarlyClosure(db: Db, input: EarlyClosureInput): EarlyClosureDto {
  return db.insert(earlyClosures).values(normalize(db, input, null)).returning().get()
}

export function updateEarlyClosure(db: Db, id: number, input: EarlyClosureInput): void {
  if (!db.select().from(earlyClosures).where(eq(earlyClosures.id, id)).get()) throw new ServiceError(404, 'early_closure_not_found')
  db.update(earlyClosures).set(normalize(db, input, id)).where(eq(earlyClosures.id, id)).run()
}

export function deleteEarlyClosure(db: Db, id: number): void {
  db.delete(earlyClosures).where(eq(earlyClosures.id, id)).run()
}
