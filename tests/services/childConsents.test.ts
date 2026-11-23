import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import type { ChildActor } from '../../server/lib/childViewer'
import {
  createConsentQuestion, deleteConsentQuestion, listConsentQuestions, reorderConsentQuestions, updateConsentQuestion,
} from '../../server/services/childConsents'
import {
  createOverviewSheet, deleteOverviewSheet, listOverviewSheets, reorderOverviewSheets, updateOverviewSheet,
} from '../../server/services/childOverviewSheets'
import { getChild, moveChildToFacility, updateChildConsents } from '../../server/services/children'
import { DEFAULT_CONSENT_QUESTIONS, DEFAULT_OVERVIEW_SHEETS } from '../../shared/domain/childConsents'
import type { OverviewColumnRef } from '../../shared/types/api'
import { answers, questionId } from '../helpers/consents'
import { addChild, addFacility, addUser, asChildViewer, createTestDb, errorCode } from '../helpers/fixtures'

const TODAY = '2026-10-19'
const NOW = new Date('2026-10-19T06:00:00Z')

describe('consent questions of a facility', () => {
  let db: Db
  let admin: ChildActor

  beforeEach(() => {
    db = createTestDb()
    admin = asChildViewer(addUser(db, 'leitung', 'admin'))
  })

  it('gives a new facility the default questions and the eight tabs, its own copies', () => {
    const other = addFacility(db, 'Krippe')
    const questions = listConsentQuestions(db, other)
    expect(questions.map(({ builtinKey, area, short, text, hidden, answerCount }) => ({ builtinKey, area, short, text, hidden, answerCount })))
      .toEqual(DEFAULT_CONSENT_QUESTIONS.map(question => ({ ...question, hidden: false, answerCount: 0 })))
    expect(questions.every(question => !listConsentQuestions(db, 1).some(own => own.id === question.id))).toBe(true)
    const sheets = listOverviewSheets(db, other)
    expect(sheets.map(sheet => sheet.name)).toEqual(DEFAULT_OVERVIEW_SHEETS.map(sheet => sheet.name))
    // The consent columns point to the new facility's own questions.
    expect(sheets[0]!.columns).toEqual(DEFAULT_OVERVIEW_SHEETS[0]!.columns.map(column =>
      column.type === 'consent' ? { type: 'consent', questionId: questionId(db, other, column.builtinKey) } : column))
  })

  it('adds a question at the end, trims it and checks the lengths', () => {
    const created = createConsentQuestion(db, 1, { text: '  Darf Bilderbücher ausleihen ', short: ' Bücher ', area: ' Ausleihe ' })
    expect(created).toMatchObject({ text: 'Darf Bilderbücher ausleihen', short: 'Bücher', area: 'Ausleihe', hidden: false, builtinKey: null, sortOrder: 14 })
    expect(listConsentQuestions(db, 1).at(-1)!.id).toBe(created.id)
    const base = { text: 'Frage', short: 'Kurz', area: 'Bereich' }
    expect(errorCode(() => createConsentQuestion(db, 1, { ...base, text: '  ' }))).toBe('consent_question_text_required')
    expect(errorCode(() => createConsentQuestion(db, 1, { ...base, text: 'x'.repeat(301) }))).toBe('consent_question_text_required')
    expect(errorCode(() => createConsentQuestion(db, 1, { ...base, text: 'x'.repeat(300) }))).toBeNull()
    expect(errorCode(() => createConsentQuestion(db, 1, { ...base, short: '' }))).toBe('consent_question_short_required')
    expect(errorCode(() => createConsentQuestion(db, 1, { ...base, short: 'x'.repeat(41) }))).toBe('consent_question_short_required')
    expect(errorCode(() => createConsentQuestion(db, 1, { ...base, area: ' ' }))).toBe('consent_area_required')
  })

  it('changes text, short name and area, hides and shows again; another facility\'s question is not found', () => {
    const id = questionId(db, 1, 'signalPhotos')
    expect(updateConsentQuestion(db, 1, id, { text: 'Fotos über Threema', short: 'Threema', area: 'Messenger', hidden: true }))
      .toMatchObject({ id, text: 'Fotos über Threema', short: 'Threema', area: 'Messenger', hidden: true, builtinKey: 'signalPhotos' })
    // Left out, hidden stays as it is.
    expect(updateConsentQuestion(db, 1, id, { text: 'Fotos über Threema', short: 'Threema', area: 'Messenger' }).hidden).toBe(true)
    expect(updateConsentQuestion(db, 1, id, { text: 'Fotos über Threema', short: 'Threema', area: 'Messenger', hidden: false }).hidden).toBe(false)
    const other = addFacility(db, 'Krippe')
    const foreign = questionId(db, other, 'signalPhotos')
    expect(errorCode(() => updateConsentQuestion(db, 1, foreign, { text: 'x', short: 'x', area: 'x' }))).toBe('consent_question_not_found')
    expect(errorCode(() => deleteConsentQuestion(db, 1, foreign))).toBe('consent_question_not_found')
    expect(listConsentQuestions(db, other).find(question => question.id === foreign)!.text).toBe('Fotos über Signal versenden')
  })

  it('deletes only a question nobody answered, and takes it out of the tabs; one with answers can only be hidden', () => {
    const child = addChild(db, 1)
    const answered = questionId(db, 1, 'artworkDisplay')
    const unanswered = questionId(db, 1, 'whatsappContact')
    updateChildConsents(db, admin, 1, child, answers(db, 1, { artworkDisplay: false }), TODAY, NOW)
    expect(listConsentQuestions(db, 1).find(question => question.id === answered)!.answerCount).toBe(1)
    expect(errorCode(() => deleteConsentQuestion(db, 1, answered))).toBe('consent_question_answered')
    deleteConsentQuestion(db, 1, unanswered)
    expect(listConsentQuestions(db, 1).map(question => question.id)).not.toContain(unanswered)
    const messenger = listOverviewSheets(db, 1).find(sheet => sheet.name === 'Messenger')!
    expect(messenger.columns).toHaveLength(3)
    expect(messenger.columns).not.toContainEqual({ type: 'consent', questionId: unanswered })
    // An answer that is taken back (keine Angabe) no longer blocks it.
    updateChildConsents(db, admin, 1, child, answers(db, 1, { artworkDisplay: null }), TODAY, NOW)
    deleteConsentQuestion(db, 1, answered)
  })

  it('reorders the whole list only', () => {
    const ids = listConsentQuestions(db, 1).map(question => question.id)
    const reversed = [...ids].reverse()
    reorderConsentQuestions(db, 1, reversed)
    expect(listConsentQuestions(db, 1).map(question => question.id)).toEqual(reversed)
    expect(errorCode(() => reorderConsentQuestions(db, 1, ids.slice(1)))).toBe('invalid_order')
    expect(errorCode(() => reorderConsentQuestions(db, 1, [...ids.slice(1), ids[1]!]))).toBe('invalid_order')
    const other = addFacility(db, 'Krippe')
    expect(errorCode(() => reorderConsentQuestions(db, 1, [...ids.slice(1), questionId(db, other, 'artworkDisplay')]))).toBe('invalid_order')
  })
})

describe('answers in the child record', () => {
  let db: Db
  let admin: ChildActor

  beforeEach(() => {
    db = createTestDb()
    admin = asChildViewer(addUser(db, 'leitung', 'admin'))
  })

  it('shows the visible questions and a hidden one only with an answer of this child, read-only', () => {
    const child = addChild(db, 1)
    const other = addChild(db, 1, { lastName: 'Andere' })
    updateChildConsents(db, admin, 1, child, answers(db, 1, { photosDisplay: true, signalPhotos: false }), TODAY, NOW)
    const signal = questionId(db, 1, 'signalPhotos')
    const photos = questionId(db, 1, 'photosDisplay')
    updateConsentQuestion(db, 1, signal, { text: 'Fotos über Signal versenden', short: 'Fotos Signal', area: 'Messenger (WhatsApp, Signal)', hidden: true })
    updateConsentQuestion(db, 1, photos, { text: 'Einzel- und Gruppenfotos aufhängen', short: 'Fotos aufhängen', area: 'Datenschutz', hidden: true })
    const added = createConsentQuestion(db, 1, { text: 'Darf schwimmen gehen', short: 'Schwimmen', area: 'Ausflüge' })
    const record = getChild(db, admin, child, TODAY)
    expect(record.consentQuestions.filter(question => question.hidden).map(question => question.id)).toEqual([photos, signal])
    expect(record.consentQuestions.at(-1)!.id).toBe(added.id)
    expect(record.consents).toEqual({ [photos]: true, [signal]: false })
    // The other child has no answer to the hidden questions: they do not show.
    expect(getChild(db, admin, other, TODAY).consentQuestions.some(question => question.hidden)).toBe(false)
    // A hidden question's answer stays as it is.
    expect(errorCode(() => updateChildConsents(db, admin, 1, child, [{ questionId: signal, value: true }], TODAY, NOW))).toBe('consent_question_hidden')
    updateChildConsents(db, admin, 1, child, [{ questionId: added.id, value: true }], TODAY, NOW)
    expect(getChild(db, admin, child, TODAY).consents).toEqual({ [photos]: true, [signal]: false, [added.id]: true })
  })

  it('refuses a question of another facility, an unknown one and one named twice, and saves nothing then', () => {
    const child = addChild(db, 1)
    const other = addFacility(db, 'Krippe')
    const own = questionId(db, 1, 'artworkDisplay')
    expect(errorCode(() => updateChildConsents(db, admin, 1, child, [
      { questionId: own, value: true }, { questionId: questionId(db, other, 'artworkDisplay'), value: true },
    ], TODAY, NOW))).toBe('consent_question_not_found')
    expect(errorCode(() => updateChildConsents(db, admin, 1, child, [{ questionId: 99999, value: true }], TODAY, NOW))).toBe('consent_question_not_found')
    expect(errorCode(() => updateChildConsents(db, admin, 1, child, [
      { questionId: own, value: true }, { questionId: own, value: false },
    ], TODAY, NOW))).toBe('consent_question_twice')
    expect(getChild(db, admin, child, TODAY).consents).toEqual({})
    expect(getChild(db, admin, child, TODAY).stamps.consents.updatedAt).toBeNull()
  })

  it('follows the record\'s write rules: an archived child\'s answers stay', () => {
    const child = addChild(db, 1, { leftOn: '2026-09-30' })
    expect(errorCode(() => updateChildConsents(db, admin, 1, child, answers(db, 1, { artworkDisplay: true }), TODAY, NOW))).toBe('child_archived')
    expect(getChild(db, admin, child, TODAY).consents).toEqual({})
  })

  it('takes the answers along to another facility: same key or text, else a hidden copy of the question', () => {
    const child = addChild(db, 1)
    const own = createConsentQuestion(db, 1, { text: 'Darf schwimmen gehen', short: 'Schwimmen', area: 'Ausflüge' })
    const krippe = addFacility(db, 'Krippe')
    // The other facility renamed the question with the key and has its own one of the same text (other case).
    updateConsentQuestion(db, krippe, questionId(db, krippe, 'insectRepellent'), { text: 'Mückenspray', short: 'Mücken', area: 'Gesundheit' })
    const theirs = createConsentQuestion(db, krippe, { text: 'darf SCHWIMMEN gehen', short: 'Baden', area: 'Sport' })
    const hiddenHere = createConsentQuestion(db, 1, { text: 'Darf auf den Hochstand', short: 'Hochstand', area: 'Garten' })
    updateChildConsents(db, admin, 1, child, [
      ...answers(db, 1, { insectRepellent: false, artworkDisplay: true }),
      { questionId: own.id, value: true }, { questionId: hiddenHere.id, value: false },
    ], TODAY, NOW)
    moveChildToFacility(db, child, krippe, NOW)
    const provider = asChildViewer(addUser(db, 'traeger', 'provider', null, krippe))
    const record = getChild(db, provider, child, TODAY)
    const copy = listConsentQuestions(db, krippe).find(question => question.text === 'Darf auf den Hochstand')!
    expect(copy).toMatchObject({ hidden: true, area: 'Garten', short: 'Hochstand', answerCount: 1 })
    expect(record.consents).toEqual({
      [questionId(db, krippe, 'insectRepellent')]: false, [questionId(db, krippe, 'artworkDisplay')]: true, [theirs.id]: true, [copy.id]: false,
    })
    // Nothing of the child is left in the old facility's questions.
    expect(listConsentQuestions(db, 1).every(question => question.answerCount === 0)).toBe(true)
  })
})

describe('overview tabs of a facility', () => {
  let db: Db

  beforeEach(() => {
    db = createTestDb()
  })

  it('adds, renames, reorders and deletes tabs', () => {
    const created = createOverviewSheet(db, 1, { name: '  Ausflug ', columns: [{ type: 'field', key: 'birthday' }, { type: 'field', key: 'phones' }] })
    expect(created).toMatchObject({ name: 'Ausflug', sortOrder: 8, columns: [{ type: 'field', key: 'birthday' }, { type: 'field', key: 'phones' }] })
    const swim = createConsentQuestion(db, 1, { text: 'Darf schwimmen gehen', short: 'Schwimmen', area: 'Ausflüge' })
    const columns: OverviewColumnRef[] = [{ type: 'consent', questionId: swim.id }, { type: 'field', key: 'school' }, { type: 'field', key: 'group' }]
    expect(updateOverviewSheet(db, 1, created.id, { name: 'Schwimmbad', columns })).toMatchObject({ name: 'Schwimmbad', columns })
    const ids = listOverviewSheets(db, 1).map(sheet => sheet.id)
    reorderOverviewSheets(db, 1, [created.id, ...ids.filter(id => id !== created.id)])
    expect(listOverviewSheets(db, 1)[0]!.name).toBe('Schwimmbad')
    expect(errorCode(() => reorderOverviewSheets(db, 1, ids.slice(1)))).toBe('invalid_order')
    for (const id of ids) deleteOverviewSheet(db, 1, id)
    expect(listOverviewSheets(db, 1)).toEqual([])
  })

  it('refuses unknown fields, questions of another facility or none, a column twice, empty and taken names', () => {
    const other = addFacility(db, 'Krippe')
    const own = questionId(db, 1, 'artworkDisplay')
    const sheet = listOverviewSheets(db, 1)[0]!
    const save = (columns: unknown[], name = 'Neu') => errorCode(() => createOverviewSheet(db, 1, { name, columns: columns as OverviewColumnRef[] }))
    expect(save([{ type: 'field', key: 'shoeSize' }])).toBe('overview_column_unknown')
    expect(save([{ type: 'consent', questionId: questionId(db, other, 'artworkDisplay') }])).toBe('overview_column_unknown')
    expect(save([{ type: 'consent', questionId: 99999 }])).toBe('overview_column_unknown')
    expect(save([{ type: 'consent', questionId: own }, { type: 'consent', questionId: own }])).toBe('overview_column_twice')
    expect(save([{ type: 'field', key: 'group' }, { type: 'field', key: 'group' }])).toBe('overview_column_twice')
    expect(save([], '  ')).toBe('overview_sheet_name_required')
    expect(save([], 'x'.repeat(41))).toBe('overview_sheet_name_required')
    expect(save([], 'MESSENGER')).toBe('overview_sheet_name_taken')
    expect(errorCode(() => updateOverviewSheet(db, 1, sheet.id, { name: sheet.name, columns: [] }))).toBeNull()
    // Another facility's tab is not found.
    const foreign = listOverviewSheets(db, other)[0]!
    expect(errorCode(() => updateOverviewSheet(db, 1, foreign.id, { name: 'x', columns: [] }))).toBe('overview_sheet_not_found')
    expect(errorCode(() => deleteOverviewSheet(db, 1, foreign.id))).toBe('overview_sheet_not_found')
    expect(listOverviewSheets(db, other)[0]!.name).toBe('Datenschutz')
  })

  it('keeps a hidden question as a column', () => {
    const id = questionId(db, 1, 'artworkDisplay')
    updateConsentQuestion(db, 1, id, { text: 'Bastel- und Malarbeiten aufhängen', short: 'Bastelarbeiten', area: 'Datenschutz', hidden: true })
    expect(errorCode(() => createOverviewSheet(db, 1, { name: 'Alt', columns: [{ type: 'consent', questionId: id }] }))).toBeNull()
  })
})
