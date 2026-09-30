import { and, eq } from 'drizzle-orm'
import type { SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { monthPlans } from '../db/schema'

export function releaseMonth(db: Db, actor: SessionUser, year: number, month: number, now: Date = new Date()): void {
  const releasedAt = now.toISOString()
  db.insert(monthPlans).values({ year, month, releasedAt, releasedBy: actor.id })
    .onConflictDoUpdate({ target: [monthPlans.year, monthPlans.month], set: { releasedAt, releasedBy: actor.id } })
    .run()
}

export function unreleaseMonth(db: Db, year: number, month: number): void {
  db.update(monthPlans).set({ releasedAt: null, releasedBy: null })
    .where(and(eq(monthPlans.year, year), eq(monthPlans.month, month))).run()
}
