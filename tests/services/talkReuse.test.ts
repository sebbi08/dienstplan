import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { formRevisions, forms, staffTalkForms, staffTalks } from '../../server/db/schema'
import { listTemplates } from '../../server/services/formTemplates'
import {
  createTalk, deleteTalk, getMyTalkForm, getTalkForm, getTalkFormRevision, listMyTalks, listTalkFormRevisions, listTalks,
  releaseTalkForm, reuseTalk, saveMyTalkFormAnswers, saveTalkFormAnswers, setTalkFormReadRelease, submitMyTalkForm,
} from '../../server/services/staffTalks'
import { compareForms } from '../../shared/domain/formHistory'
import type { AnswerableItem, FormContent } from '../../shared/domain/forms'
import type { SessionUser, TalkFormDto } from '../../shared/types/api'
import { addEmployee, addFacility, addUser, createTestDb, errorCode } from '../helpers/fixtures'

let db: Db
let leitung: SessionUser
let anna: SessionUser
let annaId: number
let selfTemplate: number
let assessmentTemplate: number
const T0 = new Date('2025-11-03T09:00:00.000Z')
const T1 = new Date('2026-10-26T09:00:00.000Z')
const T2 = new Date('2026-10-27T09:00:00.000Z')
const F1 = { facilityId: 1, ownEmployeeId: null }
const oldHeader = { date: '2025-11-03', start: 600, participants: 'Lea Leitung, Anna Muster', period: '2024/25' }
const newHeader = { date: '2026-10-26', start: null, participants: 'Lea Leitung, Anna Muster', period: '2025/26' }

const items = (content: FormContent) => content.sections.flatMap(section => section.items)
const itemOf = <K extends AnswerableItem['kind']>(content: FormContent, kind: K) =>
  items(content).find(item => item.kind === kind) as Extract<AnswerableItem, { kind: K }>
const talkForms = (talkId: number) => listTalks(db, F1, annaId).find(talk => talk.id === talkId)!.forms
const updatedAt = (formId: number) => db.select({ value: forms.updatedAt }).from(forms).where(eq(forms.id, formId)).get()!.value

/** The old talk: Anna's self form submitted with answers, the assessment filled in by the Leitung and released to read. */
function oldTalk() {
  const talkId = createTalk(db, leitung, F1, { ...oldHeader, employeeId: annaId, templateIds: [selfTemplate, assessmentTemplate] }, T0)
  const [self, assessment] = talkForms(talkId) as [TalkFormDto, TalkFormDto]
  const selfText = itemOf(self.content, 'text')
  releaseTalkForm(db, F1, self.id, T0)
  saveMyTalkFormAnswers(db, anna, self.id, { [selfText.id]: '<p>Ich arbeite gern im Team</p>' }, updatedAt(self.id), T0)
  submitMyTalkForm(db, anna, self.id, updatedAt(self.id), T0)
  const rating = itemOf(assessment.content, 'rating')
  const text = itemOf(assessment.content, 'text')
  saveTalkFormAnswers(db, leitung, F1, assessment.id, {
    [rating.id]: { value: '~', remark: '' }, [text.id]: '<p>Zuverlässig</p>',
  }, updatedAt(assessment.id), T0)
  setTalkFormReadRelease(db, F1, assessment.id, true, T0)
  return { talkId, self: talkForms(talkId)[0]!, assessment: talkForms(talkId)[1]!, selfText, rating, text }
}

beforeEach(() => {
  db = createTestDb()
  leitung = addUser(db, 'leitung', 'admin', addEmployee(db, 'Lea Leitung'))
  annaId = addEmployee(db, 'Anna Muster')
  anna = addUser(db, 'anna', 'observer', annaId)
  const staff = listTemplates(db, 1, 'staff')
  selfTemplate = staff.find(template => template.starterKey === 'staff_self_assessment')!.id
  assessmentTemplate = staff.find(template => template.starterKey === 'staff_assessment')!.id
})

describe('„Für ein weiteres Gespräch verwenden“', () => {
  it('makes a new talk with copies of the forms (content, answers, roles, order) and leaves the old talk as it was', () => {
    const old = oldTalk()
    const before = {
      talk: db.select().from(staffTalks).where(eq(staffTalks.id, old.talkId)).get(),
      forms: db.select().from(forms).all(),
      links: db.select().from(staffTalkForms).all(),
    }
    const newId = reuseTalk(db, leitung, F1, old.talkId, newHeader, T1)
    expect(newId).not.toBe(old.talkId)

    const [talk] = listTalks(db, F1, annaId)
    expect(talk).toMatchObject({ id: newId, employeeId: annaId, ...newHeader })
    const [self, assessment] = talk!.forms
    expect(talk!.forms.map(form => [form.role, form.title, form.state, form.readReleased, form.releasedAt, form.submittedAt, form.readReleasedAt]))
      .toEqual([
        ['self', old.self.title, 'draft', false, null, null, null],
        ['assessment', old.assessment.title, 'draft', false, null, null, null],
      ])
    expect(self!.content).toEqual(old.self.content)
    expect(self!.answers).toEqual(old.self.answers)
    expect(assessment!.answers).toEqual(old.assessment.answers)
    expect(self).toMatchObject({ updatedBy: 'Lea Leitung', updatedAt: T1.toISOString(), source: { formId: old.self.id, talkDate: oldHeader.date } })
    expect(assessment!.source).toEqual({ formId: old.assessment.id, talkDate: oldHeader.date })

    // The old talk and its forms are untouched.
    expect(db.select().from(staffTalks).where(eq(staffTalks.id, old.talkId)).get()).toEqual(before.talk)
    expect(db.select().from(forms).all().filter(form => before.forms.some(old => old.id === form.id))).toEqual(before.forms)
    expect(db.select().from(staffTalkForms).all().filter(link => link.talkId === old.talkId)).toEqual(before.links)
  })

  it('the copied answers start the history as one revision of the copy, not as a change', () => {
    const old = oldTalk()
    const newId = reuseTalk(db, leitung, F1, old.talkId, newHeader, T1)
    const [, assessment] = talkForms(newId)
    expect(listTalkFormRevisions(db, F1, assessment!.id, 0)).toMatchObject({
      total: 1, revisions: [{ savedAt: T1.toISOString(), savedBy: 'Lea Leitung', initial: true, changedCount: 0 }],
    })
    // Unchanged non-empty answers count as carried over; nothing as changed.
    expect(assessment!.itemChanges).toEqual({})
    expect([...assessment!.carriedOver].sort()).toEqual([old.rating.id, old.text.id].sort())
  })

  it('marks per answer: carried over until changed in the new talk, then „geändert am … von …“', () => {
    const old = oldTalk()
    const newId = reuseTalk(db, leitung, F1, old.talkId, newHeader, T1)
    const [self, assessment] = talkForms(newId) as [TalkFormDto, TalkFormDto]
    saveTalkFormAnswers(db, leitung, F1, assessment.id, {
      ...assessment.answers, [old.rating.id]: { value: '+', remark: 'deutlich sicherer' },
    }, updatedAt(assessment.id), T2)
    const changed = talkForms(newId)[1]!
    expect(changed.itemChanges).toEqual({ [old.rating.id]: { changedAt: T2.toISOString(), changedBy: 'Lea Leitung' } })
    expect(changed.carriedOver).toEqual([old.text.id])
    expect(getTalkFormRevision(db, F1, assessment.id, listTalkFormRevisions(db, F1, assessment.id, 0).revisions.at(-1)!.id).answers)
      .toEqual(old.assessment.answers)

    // The employee's self-assessment starts from the old answers once released again; her changes are hers.
    expect(errorCode(() => getMyTalkForm(db, anna, self.id))).toBe('form_not_found')
    releaseTalkForm(db, F1, self.id, T2)
    expect(getMyTalkForm(db, anna, self.id).form).toMatchObject({
      state: 'released', answers: old.self.answers, carriedOver: [old.selfText.id], itemChanges: {},
      source: { talkDate: oldHeader.date },
    })
    saveMyTalkFormAnswers(db, anna, self.id, { [old.selfText.id]: '<p>Ich arbeite gern im Team und leite die Bauecke</p>' }, updatedAt(self.id), T2)
    expect(getMyTalkForm(db, anna, self.id).form).toMatchObject({
      carriedOver: [], itemChanges: { [old.selfText.id]: { changedAt: T2.toISOString(), changedBy: 'Anna Muster' } },
    })
  })

  it('the employee sees the marking only on her own self-assessment, not on an assessment released to read', () => {
    const old = oldTalk()
    const newId = reuseTalk(db, leitung, F1, old.talkId, newHeader, T1)
    const [, assessment] = talkForms(newId)
    setTalkFormReadRelease(db, F1, assessment!.id, true, T1)
    const mine = getMyTalkForm(db, anna, assessment!.id).form
    expect(mine).toMatchObject({ itemChanges: {}, carriedOver: [], source: null, answers: old.assessment.answers })
    expect(listMyTalks(db, anna)[0]!.forms.find(form => form.id === assessment!.id)).toMatchObject({ carriedOver: [], source: null })
    // On the old talk, her self form (never copied from anything) has no origin either.
    expect(getMyTalkForm(db, anna, old.self.id).form.source).toBeNull()
  })

  it('gives the data to compare with the previous talk: the old form side by side, trend of the ratings', () => {
    const old = oldTalk()
    const newId = reuseTalk(db, leitung, F1, old.talkId, newHeader, T1)
    const [, assessment] = talkForms(newId) as [TalkFormDto, TalkFormDto]
    saveTalkFormAnswers(db, leitung, F1, assessment.id, { ...assessment.answers, [old.rating.id]: { value: '+', remark: '' } }, updatedAt(assessment.id), T2)
    const newer = getTalkForm(db, F1, assessment.id)
    const older = getTalkForm(db, F1, newer.form.source!.formId!)
    expect(older.talk).toMatchObject({ id: old.talkId, date: oldHeader.date })
    const rows = compareForms(newer.form, older.form).flatMap(section => section.rows)
    expect(rows.find(row => row.id === old.rating.id)).toMatchObject({ trend: 'up', older: { value: '~' }, newer: { value: '+' } })
  })

  it('checks the header, and only who may manage the old talk reuses it (another facility, the own talk: 404)', () => {
    const old = oldTalk()
    expect(errorCode(() => reuseTalk(db, leitung, F1, old.talkId, { ...newHeader, date: '2026-02-30' }, T1))).toBe('staff_talk_date_invalid')
    const other = addFacility(db, 'Krippe')
    expect(errorCode(() => reuseTalk(db, leitung, { facilityId: other, ownEmployeeId: null }, old.talkId, newHeader, T1))).toBe('staff_talk_not_found')
    expect(errorCode(() => reuseTalk(db, leitung, { facilityId: 1, ownEmployeeId: annaId }, old.talkId, newHeader, T1))).toBe('staff_talk_not_found')
    expect(errorCode(() => listTalkFormRevisions(db, { facilityId: other, ownEmployeeId: null }, old.self.id, 0))).toBe('form_not_found')
    expect(errorCode(() => getTalkFormRevision(db, { facilityId: 1, ownEmployeeId: annaId }, old.self.id, 1))).toBe('form_not_found')
    expect(listTalks(db, F1, annaId)).toHaveLength(1)
  })

  it('every staff form keeps its history; a save that changes nothing writes none', () => {
    const old = oldTalk()
    // Anna's save and the Leitung's save each wrote one revision.
    expect(listTalkFormRevisions(db, F1, old.self.id, 0).revisions.map(revision => [revision.savedBy, revision.changedCount]))
      .toEqual([['Anna Muster', 1]])
    saveTalkFormAnswers(db, leitung, F1, old.assessment.id, old.assessment.answers, updatedAt(old.assessment.id), T1)
    expect(listTalkFormRevisions(db, F1, old.assessment.id, 0).total).toBe(1)
    expect(old.assessment.itemChanges).toEqual({
      [old.rating.id]: { changedAt: T0.toISOString(), changedBy: 'Lea Leitung' }, [old.text.id]: { changedAt: T0.toISOString(), changedBy: 'Lea Leitung' },
    })
    expect(old.assessment.carriedOver).toEqual([])
  })

  it('deleting the old talk keeps the copies with the date of the talk they came from', () => {
    const old = oldTalk()
    const newId = reuseTalk(db, leitung, F1, old.talkId, newHeader, T1)
    deleteTalk(db, F1, old.talkId)
    expect(talkForms(newId).map(form => form.source)).toEqual([
      { formId: null, talkDate: oldHeader.date }, { formId: null, talkDate: oldHeader.date },
    ])
    // Deleting the new talk takes its revisions along.
    deleteTalk(db, F1, newId)
    expect(db.select().from(formRevisions).all()).toEqual([])
  })
})
