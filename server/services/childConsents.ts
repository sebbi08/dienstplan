import { and, asc, count, eq, inArray, max } from 'drizzle-orm'
import {
  CONSENT_AREA_MAX, CONSENT_SHORT_MAX, CONSENT_TEXT_MAX, DEFAULT_CONSENT_QUESTIONS, DEFAULT_OVERVIEW_SHEETS, INSECT_REPELLENT_KEY,
  type OverviewColumnRef,
} from '../../shared/domain/childConsents'
import type {
  ConsentAnswerInput, ConsentAnswers, ConsentQuestionDto, ConsentQuestionInput, ConsentQuestionSettingsDto,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { childConsentAnswers, childConsentQuestions, childOverviewSheets } from '../db/schema'
import { ServiceError } from '../lib/errors'

// The facility's consent questions (Einstellungen → Kinder → Einwilligungen & Erlaubnisse) and the children's answers
// to them. Only ja and nein are stored; no row = keine Angabe.

type QuestionRow = typeof childConsentQuestions.$inferSelect

function toDto(row: QuestionRow): ConsentQuestionDto {
  return {
    id: row.id, text: row.text, short: row.short, area: row.area, sortOrder: row.sortOrder, hidden: row.hidden,
    builtinKey: row.builtinKey,
  }
}

function questionRows(db: Db, facilityId: number): QuestionRow[] {
  return db.select().from(childConsentQuestions).where(eq(childConsentQuestions.facilityId, facilityId))
    .orderBy(asc(childConsentQuestions.sortOrder), asc(childConsentQuestions.id)).all()
}

/** Every question of the facility in its order, hidden ones included. */
export function consentQuestionsOf(db: Db, facilityId: number): ConsentQuestionDto[] {
  return questionRows(db, facilityId).map(toDto)
}

/** For the settings: every question with the number of children who answered it. */
export function listConsentQuestions(db: Db, facilityId: number): ConsentQuestionSettingsDto[] {
  const rows = questionRows(db, facilityId)
  const counts = new Map(rows.length === 0 ? [] : db.select({ id: childConsentAnswers.questionId, value: count() })
    .from(childConsentAnswers).where(inArray(childConsentAnswers.questionId, rows.map(row => row.id)))
    .groupBy(childConsentAnswers.questionId).all().map(row => [row.id, row.value]))
  return rows.map(row => ({ ...toDto(row), answerCount: counts.get(row.id) ?? 0 }))
}

/** The facility's question; 404 consent_question_not_found for one of another facility or none. */
function loadQuestion(db: Db, facilityId: number, id: number): QuestionRow {
  const row = db.select().from(childConsentQuestions)
    .where(and(eq(childConsentQuestions.id, id), eq(childConsentQuestions.facilityId, facilityId))).get()
  if (!row) throw new ServiceError(404, 'consent_question_not_found')
  return row
}

/** Trimmed texts of the allowed length (400 consent_question_text_required / consent_question_short_required / consent_area_required). */
function checkedInput(input: ConsentQuestionInput): { text: string; short: string; area: string } {
  const text = input.text.trim()
  const short = input.short.trim()
  const area = input.area.trim()
  if (text === '' || text.length > CONSENT_TEXT_MAX) throw new ServiceError(400, 'consent_question_text_required')
  if (short === '' || short.length > CONSENT_SHORT_MAX) throw new ServiceError(400, 'consent_question_short_required')
  if (area === '' || area.length > CONSENT_AREA_MAX) throw new ServiceError(400, 'consent_area_required')
  return { text, short, area }
}

/** A new question at the end of the facility's list (so last in its area). */
export function createConsentQuestion(db: Db, facilityId: number, input: ConsentQuestionInput): ConsentQuestionDto {
  const values = checkedInput(input)
  return db.transaction((tx) => {
    const sortOrder = (tx.select({ value: max(childConsentQuestions.sortOrder) }).from(childConsentQuestions)
      .where(eq(childConsentQuestions.facilityId, facilityId)).get()?.value ?? -1) + 1
    return toDto(tx.insert(childConsentQuestions)
      .values({ ...values, facilityId, sortOrder, hidden: input.hidden ?? false }).returning().get())
  })
}

/** Changes text, short name, area and whether it is hidden (`hidden` left out: stays as it is). */
export function updateConsentQuestion(db: Db, facilityId: number, id: number, input: ConsentQuestionInput): ConsentQuestionDto {
  const row = loadQuestion(db, facilityId, id)
  const values = checkedInput(input)
  return toDto(db.update(childConsentQuestions).set({ ...values, hidden: input.hidden ?? row.hidden })
    .where(eq(childConsentQuestions.id, id)).returning().get())
}

/**
 * Deletes a question no child has answered (409 consent_question_answered otherwise: the answers are proof, so it can
 * only be hidden). Tabs that showed it lose the column.
 */
export function deleteConsentQuestion(db: Db, facilityId: number, id: number): void {
  loadQuestion(db, facilityId, id)
  if (db.select({ id: childConsentAnswers.childId }).from(childConsentAnswers).where(eq(childConsentAnswers.questionId, id)).get()) {
    throw new ServiceError(409, 'consent_question_answered')
  }
  db.transaction((tx) => {
    for (const sheet of tx.select().from(childOverviewSheets).where(eq(childOverviewSheets.facilityId, facilityId)).all()) {
      const columns = sheet.columns.filter(column => !(column.type === 'consent' && column.questionId === id))
      if (columns.length !== sheet.columns.length) {
        tx.update(childOverviewSheets).set({ columns }).where(eq(childOverviewSheets.id, sheet.id)).run()
      }
    }
    tx.delete(childConsentQuestions).where(eq(childConsentQuestions.id, id)).run()
  })
}

/** The new order of all the facility's questions (400 invalid_order unless it is exactly them, each once). */
export function reorderConsentQuestions(db: Db, facilityId: number, ids: number[]): void {
  const existing = new Set(questionRows(db, facilityId).map(row => row.id))
  if (ids.length !== existing.size || new Set(ids).size !== ids.length || !ids.every(id => existing.has(id))) {
    throw new ServiceError(400, 'invalid_order')
  }
  db.transaction((tx) => {
    ids.forEach((id, index) => tx.update(childConsentQuestions).set({ sortOrder: index }).where(eq(childConsentQuestions.id, id)).run())
  })
}

/** The answers of the children, by child (every given child has an entry, maybe empty). */
export function answersOf(db: Db, childIds: number[]): Map<number, ConsentAnswers> {
  const result = new Map<number, ConsentAnswers>(childIds.map(id => [id, {}]))
  if (childIds.length === 0) return result
  for (const row of db.select().from(childConsentAnswers).where(inArray(childConsentAnswers.childId, childIds)).all()) {
    result.get(row.childId)![row.questionId] = row.value
  }
  return result
}

/** The questions a record shows: the visible ones and the hidden ones the child answered, in their order. */
export function recordQuestions(db: Db, facilityId: number, answers: ConsentAnswers): ConsentQuestionDto[] {
  return consentQuestionsOf(db, facilityId).filter(question => !question.hidden || answers[question.id] !== undefined)
}

/**
 * Saves the child's answers to the given questions (null = keine Angabe: the answer is removed); the others stay. Each
 * must be a question of the child's facility (404 consent_question_not_found) named once (400 consent_question_twice).
 * A hidden question is no longer asked: its answer can still be withdrawn (nein) or cleared, and a stored ja may stay,
 * but no new ja is given (400 consent_question_hidden). Call in the transaction of the save, after the record was
 * checked.
 */
export function saveAnswers(db: Db, facilityId: number, childId: number, input: ConsentAnswerInput[]): void {
  const questions = new Map(questionRows(db, facilityId).map(row => [row.id, row]))
  const stored = answersOf(db, [childId]).get(childId)!
  const seen = new Set<number>()
  for (const answer of input) {
    const question = questions.get(answer.questionId)
    if (!question) throw new ServiceError(404, 'consent_question_not_found')
    if (question.hidden && answer.value === true && stored[question.id] !== true) throw new ServiceError(400, 'consent_question_hidden')
    if (seen.has(answer.questionId)) throw new ServiceError(400, 'consent_question_twice')
    seen.add(answer.questionId)
  }
  for (const answer of input) {
    const key = and(eq(childConsentAnswers.childId, childId), eq(childConsentAnswers.questionId, answer.questionId))
    if (answer.value === null) {
      db.delete(childConsentAnswers).where(key).run()
    }
    else {
      db.insert(childConsentAnswers).values({ childId, questionId: answer.questionId, value: answer.value })
        .onConflictDoUpdate({ target: [childConsentAnswers.childId, childConsentAnswers.questionId], set: { value: answer.value } }).run()
    }
  }
}

/**
 * The answer to the facility's question about insect repellent (by its key, whatever it is called now and also while
 * hidden: a „nein“ stays important), by child; null without the question or an answer.
 */
export function insectRepellentOf(db: Db, facilityId: number, childIds: number[]): Map<number, boolean | null> {
  const question = db.select({ id: childConsentQuestions.id }).from(childConsentQuestions)
    .where(and(eq(childConsentQuestions.facilityId, facilityId), eq(childConsentQuestions.builtinKey, INSECT_REPELLENT_KEY))).get()
  const result = new Map<number, boolean | null>(childIds.map(id => [id, null]))
  if (!question || childIds.length === 0) return result
  for (const row of db.select().from(childConsentAnswers)
    .where(and(eq(childConsentAnswers.questionId, question.id), inArray(childConsentAnswers.childId, childIds))).all()) {
    result.set(row.childId, row.value)
  }
  return result
}

const folded = (value: string) => value.trim().toLocaleLowerCase('de')

/**
 * A child moves to another facility (in its transaction): each answer goes to the target facility's question with the
 * same key while both still ask the same (same text regardless of case), else to its question of the same text; a
 * question the target does not have is created there hidden, in the same area, so the answer stays as proof and shows
 * read-only in the record. The question about insect repellent always goes by its key (the attendance list reads it
 * by key; the target may word it differently but it means the same).
 */
export function moveAnswers(db: Db, childId: number, targetFacilityId: number): void {
  const answers = db.select().from(childConsentAnswers).where(eq(childConsentAnswers.childId, childId)).all()
  if (answers.length === 0) return
  const sources = new Map(db.select().from(childConsentQuestions)
    .where(inArray(childConsentQuestions.id, answers.map(answer => answer.questionId))).all().map(row => [row.id, row]))
  const targets = questionRows(db, targetFacilityId)
  let nextOrder = (targets.at(-1)?.sortOrder ?? -1) + 1
  const moved = new Set<number>()
  for (const answer of answers) {
    const source = sources.get(answer.questionId)!
    if (source.facilityId === targetFacilityId) continue
    const sameKey = source.builtinKey === null ? undefined : targets.find(row => row.builtinKey === source.builtinKey)
    let target = (sameKey && (source.builtinKey === INSECT_REPELLENT_KEY || folded(sameKey.text) === folded(source.text)) ? sameKey : undefined)
      ?? targets.find(row => folded(row.text) === folded(source.text))
    if (!target) {
      target = db.insert(childConsentQuestions).values({
        facilityId: targetFacilityId, text: source.text, short: source.short, area: source.area, sortOrder: nextOrder++,
        // The key once per facility: the target's own question with it asks something else now, so the copy has none.
        hidden: true, builtinKey: sameKey ? null : source.builtinKey,
      }).returning().get()
      targets.push(target)
    }
    const key = and(eq(childConsentAnswers.childId, childId), eq(childConsentAnswers.questionId, answer.questionId))
    // Two questions of the same text: the first answer counts.
    if (moved.has(target.id)) db.delete(childConsentAnswers).where(key).run()
    else db.update(childConsentAnswers).set({ questionId: target.id }).where(key).run()
    moved.add(target.id)
  }
}

/** The default questions and the eight tabs of a new facility (in its creation's transaction). */
export function seedConsentDefaults(db: Db, facilityId: number): void {
  const ids = new Map(DEFAULT_CONSENT_QUESTIONS.map((question, sortOrder) => [
    question.builtinKey,
    db.insert(childConsentQuestions).values({ ...question, facilityId, sortOrder, hidden: false })
      .returning({ id: childConsentQuestions.id }).get().id,
  ]))
  db.insert(childOverviewSheets).values(DEFAULT_OVERVIEW_SHEETS.map((sheet, sortOrder) => ({
    facilityId, name: sheet.name, sortOrder,
    columns: sheet.columns.map((column): OverviewColumnRef => column.type === 'field'
      ? column
      : { type: 'consent', questionId: ids.get(column.builtinKey)! }),
  }))).run()
}
