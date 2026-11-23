import { and, eq } from 'drizzle-orm'
import type { Db } from '../../server/db/client'
import { childConsentQuestions } from '../../server/db/schema'
import type { BuiltinConsentKey } from '../../shared/domain/childConsents'
import type { ConsentAnswerInput, TriState } from '../../shared/types/api'

/** The id of the facility's question with this key (every facility starts with the defaults). */
export function questionId(db: Db, facilityId: number, key: BuiltinConsentKey): number {
  return db.select({ id: childConsentQuestions.id }).from(childConsentQuestions)
    .where(and(eq(childConsentQuestions.facilityId, facilityId), eq(childConsentQuestions.builtinKey, key))).get()!.id
}

/** Answers to the facility's default questions by key, as the record saves them. */
export function answers(db: Db, facilityId: number, values: Partial<Record<BuiltinConsentKey, TriState>>): ConsentAnswerInput[] {
  return Object.entries(values).map(([key, value]) => ({ questionId: questionId(db, facilityId, key as BuiltinConsentKey), value: value! }))
}
