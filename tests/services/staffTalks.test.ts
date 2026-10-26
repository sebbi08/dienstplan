import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { employees, forms, staffTalkForms, users } from '../../server/db/schema'
import { moveEmployeeToFacility } from '../../server/services/employees'
import { createTemplate, listTemplates, updateTemplate } from '../../server/services/formTemplates'
import {
  addTalkForm, createTalk, deleteTalk, deleteTalkForm, getMyTalkForm, getTalkForm, listMyTalks, listTalks, releaseTalkForm,
  reopenTalkForm, saveMyTalkFormAnswers, saveTalkFormAnswers, setTalkFormReadRelease, submitMyTalkForm, updateTalk,
  withdrawTalkForm,
} from '../../server/services/staffTalks'
import type { FormContent } from '../../shared/domain/forms'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addUser, createTestDb, errorCode } from '../helpers/fixtures'

let db: Db
let leitung: SessionUser
let traeger: SessionUser
let anna: SessionUser
let ben: SessionUser
let annaId: number
let benId: number
let selfTemplate: number
let assessmentTemplate: number
const now = new Date('2026-10-26T09:00:00.000Z')

beforeEach(() => {
  db = createTestDb()
  leitung = addUser(db, 'leitung', 'admin', addEmployee(db, 'Lea Leitung'))
  traeger = addUser(db, 'traeger', 'provider')
  annaId = addEmployee(db, 'Anna Muster')
  benId = addEmployee(db, 'Ben Beispiel')
  anna = addUser(db, 'anna', 'observer', annaId)
  ben = addUser(db, 'ben', 'observer', benId)
  const staff = listTemplates(db, 1, 'staff')
  selfTemplate = staff.find(template => template.starterKey === 'staff_self_assessment')!.id
  assessmentTemplate = staff.find(template => template.starterKey === 'staff_assessment')!.id
})

const header = { date: '2026-11-03', start: 600, participants: 'Lea Leitung, Anna Muster', period: '2025/26' }
const talkFor = (employeeId: number, templateIds = [selfTemplate, assessmentTemplate]) =>
  createTalk(db, leitung, 1, { ...header, employeeId, templateIds }, now)
const formsOf = (talkId: number, employeeId = annaId) => listTalks(db, 1, employeeId).find(talk => talk.id === talkId)!.forms
const firstText = (content: FormContent) =>
  content.sections.flatMap(section => section.items).find(item => item.kind === 'text')!
/** The form's last change as a client that just loaded it holds it (expectedUpdatedAt of a save). */
const at = (formId: number) => db.select({ value: forms.updatedAt }).from(forms).where(eq(forms.id, formId)).get()?.value ?? ''

describe('creating talks', () => {
  it('copies each template into a form: self-assessment templates make self forms, others assessments', () => {
    const id = talkFor(annaId)
    const [talk] = listTalks(db, 1, annaId)
    expect(talk).toMatchObject({ id, employeeId: annaId, ...header })
    expect(talk!.forms.map(form => [form.role, form.title, form.state, form.readReleased])).toEqual([
      ['self', 'Selbstbeurteilung', 'draft', false],
      ['assessment', 'Beurteilungsbogen pädagogische Fachkräfte', 'draft', false],
    ])
    expect(talk!.forms[0]!.content).toEqual(listTemplates(db, 1, 'staff').find(t => t.id === selfTemplate)!.content)
    expect(talk!.forms[0]!.answers).toEqual({})
    expect(talk!.forms[0]!.updatedBy).toBe('Lea Leitung')
  })

  it('checks the header fields and the templates', () => {
    expect(errorCode(() => createTalk(db, leitung, 1, { ...header, date: '2026-02-30', employeeId: annaId, templateIds: [selfTemplate] })))
      .toBe('staff_talk_date_invalid')
    expect(errorCode(() => createTalk(db, leitung, 1, { ...header, start: 1440, employeeId: annaId, templateIds: [selfTemplate] })))
      .toBe('staff_talk_start_invalid')
    expect(errorCode(() => createTalk(db, leitung, 1, { ...header, participants: 'x'.repeat(301), employeeId: annaId, templateIds: [selfTemplate] })))
      .toBe('staff_talk_participants_too_long')
    expect(errorCode(() => createTalk(db, leitung, 1, { ...header, period: 'x'.repeat(61), employeeId: annaId, templateIds: [selfTemplate] })))
      .toBe('staff_talk_period_too_long')
    expect(errorCode(() => createTalk(db, leitung, 1, { ...header, employeeId: annaId, templateIds: [] }))).toBe('staff_talk_forms_required')
    // Start 0 and 1439, no time at all, 300 / 60 characters are fine.
    expect(errorCode(() => createTalk(db, leitung, 1, {
      ...header, start: null, participants: 'x'.repeat(300), period: 'y'.repeat(60), employeeId: annaId, templateIds: [selfTemplate],
    }))).toBeNull()

    updateTemplate(db, leitung, 1, assessmentTemplate, { archived: true })
    expect(errorCode(() => talkFor(annaId))).toBe('form_template_archived')
    const childTemplate = createTemplate(db, leitung, 1, { kind: 'child', name: 'Beobachtung', selfAssessment: false }, now)
    expect(errorCode(() => talkFor(annaId, [childTemplate]))).toBe('form_template_not_found')
    // Nothing of a refused talk is left behind.
    expect(listTalks(db, 1, annaId)).toHaveLength(1)
  })

  it('refuses employees and templates of another facility', () => {
    const other = addFacility(db, 'Krippe')
    const stranger = addEmployee(db, 'Fremd', { facilityId: other })
    expect(errorCode(() => talkFor(stranger))).toBe('employee_not_found')
    const foreignTemplate = listTemplates(db, other, 'staff')[0]!.id
    expect(errorCode(() => talkFor(annaId, [foreignTemplate]))).toBe('form_template_not_found')
    const id = talkFor(annaId)
    const formId = formsOf(id)[0]!.id
    // The other facility's Leitung sees and changes nothing of it.
    expect(listTalks(db, other, annaId)).toEqual([])
    expect(errorCode(() => updateTalk(db, other, id, header))).toBe('staff_talk_not_found')
    expect(errorCode(() => deleteTalk(db, other, id))).toBe('staff_talk_not_found')
    expect(errorCode(() => saveTalkFormAnswers(db, leitung, other, formId, {}, at(formId)))).toBe('form_not_found')
    expect(errorCode(() => releaseTalkForm(db, other, formId, now))).toBe('form_not_found')
    expect(errorCode(() => withdrawTalkForm(db, other, formId))).toBe('form_not_found')
    expect(errorCode(() => reopenTalkForm(db, other, formId, now))).toBe('form_not_found')
    expect(errorCode(() => setTalkFormReadRelease(db, other, formsOf(id)[1]!.id, true, now))).toBe('form_not_found')
    expect(errorCode(() => deleteTalkForm(db, other, formId))).toBe('form_not_found')
    const otherLeitung = addUser(db, 'leitung2', 'admin', null, other)
    expect(errorCode(() => addTalkForm(db, otherLeitung, other, id, foreignTemplate, now))).toBe('staff_talk_not_found')
    expect(formsOf(id)).toHaveLength(2)
  })

  it('moving the employee to another facility takes the talks and their forms along', () => {
    const other = addFacility(db, 'Krippe')
    const id = talkFor(annaId)
    const [self] = formsOf(id)
    const benTalk = talkFor(benId)
    moveEmployeeToFacility(db, traeger, annaId, other, now)
    expect(listTalks(db, 1, annaId)).toEqual([])
    expect(errorCode(() => releaseTalkForm(db, 1, self!.id, now))).toBe('form_not_found')
    expect(listTalks(db, other, annaId).map(talk => talk.id)).toEqual([id])
    releaseTalkForm(db, other, self!.id, now)
    expect(db.select({ facilityId: forms.facilityId, templateId: forms.templateId }).from(forms).where(eq(forms.id, self!.id)).get())
      .toEqual({ facilityId: other, templateId: null })
    // Ben's talk and its forms stay.
    expect(listTalks(db, 1, benId).map(talk => talk.id)).toEqual([benTalk])
    expect(listTalks(db, 1, benId)[0]!.forms).toHaveLength(2)
    expect(db.select({ facilityId: forms.facilityId }).from(forms).where(eq(forms.id, formsOf(benTalk, benId)[0]!.id)).get()!.facilityId)
      .toBe(1)
  })

  it('lists the talks newest first; header changes, added and removed forms', () => {
    const older = talkFor(annaId, [assessmentTemplate])
    updateTalk(db, 1, older, { ...header, date: '2025-11-03', participants: '  Lea  ', period: ' 2024/25 ' })
    const newer = talkFor(annaId, [selfTemplate])
    expect(listTalks(db, 1, annaId).map(talk => talk.id)).toEqual([newer, older])
    expect(listTalks(db, 1, annaId)[1]).toMatchObject({ date: '2025-11-03', participants: 'Lea', period: '2024/25' })
    const added = addTalkForm(db, leitung, 1, newer, assessmentTemplate, now)
    expect(formsOf(newer).map(form => [form.id, form.role])).toEqual([[formsOf(newer)[0]!.id, 'self'], [added, 'assessment']])
    deleteTalkForm(db, 1, added)
    expect(formsOf(newer)).toHaveLength(1)
    expect(db.select().from(forms).where(eq(forms.id, added)).get()).toBeUndefined()
  })

  it('deleting a talk deletes its forms', () => {
    const id = talkFor(annaId)
    const formIds = formsOf(id).map(form => form.id)
    deleteTalk(db, 1, id)
    expect(listTalks(db, 1, annaId)).toEqual([])
    for (const formId of formIds) expect(db.select().from(forms).where(eq(forms.id, formId)).get()).toBeUndefined()
    expect(db.select().from(staffTalkForms).all()).toEqual([])
  })
})

describe('answers', () => {
  it('Review Focus 1: an item deleted from the template stays in the talk’s form and its answer is still accepted', () => {
    const id = talkFor(annaId)
    const self = formsOf(id)[0]!
    const item = firstText(self.content)
    saveTalkFormAnswers(db, leitung, 1, self.id, { [item.id]: 'Gut angekommen' }, at(self.id), now)
    const template = listTemplates(db, 1, 'staff').find(t => t.id === selfTemplate)!
    const content = {
      sections: template.content.sections.map(section => ({ ...section, items: section.items.filter(i => i.id !== item.id) })),
    }
    updateTemplate(db, leitung, 1, selfTemplate, { content })
    const after = formsOf(id)[0]!
    expect(firstText(after.content).id).toBe(item.id)
    expect(after.answers).toEqual({ [item.id]: 'Gut angekommen' })
    saveTalkFormAnswers(db, leitung, 1, self.id, { [item.id]: 'Noch besser' }, at(self.id), now)
    expect(formsOf(id)[0]!.answers).toEqual({ [item.id]: 'Noch besser' })
  })

  it('Leitung and Träger save in any state; invalid answers are refused and nothing is saved', () => {
    const id = talkFor(annaId)
    const self = formsOf(id)[0]!
    const item = firstText(self.content)
    const later = new Date('2026-10-27T10:00:00.000Z')
    for (const step of ['draft', 'released', 'submitted'] as const) {
      if (step === 'released') releaseTalkForm(db, 1, self.id, now)
      if (step === 'submitted') submitMyTalkForm(db, anna, self.id)
      saveTalkFormAnswers(db, traeger, 1, self.id, { [item.id]: step }, at(self.id), later)
      expect(formsOf(id)[0]).toMatchObject({ state: step, answers: { [item.id]: step }, updatedBy: 'traeger', updatedAt: later.toISOString() })
    }
    expect(errorCode(() => saveTalkFormAnswers(db, leitung, 1, self.id, { [item.id]: 'x'.repeat(4001) }, at(self.id)))).toBe('form_answer_invalid')
    expect(errorCode(() => saveTalkFormAnswers(db, leitung, 1, self.id, { unknown: 'x' }, at(self.id)))).toBe('form_answer_invalid')
    expect(formsOf(id)[0]!.answers).toEqual({ [item.id]: 'submitted' })
  })
})

describe('state machine', () => {
  it('release only from draft, withdraw only from released, reopen only from submitted, submit only from released', () => {
    const id = talkFor(annaId)
    const [self, assessment] = formsOf(id)
    const state = () => formsOf(id)[0]!.state
    expect(errorCode(() => withdrawTalkForm(db, 1, self!.id))).toBe('form_state_invalid')
    expect(errorCode(() => reopenTalkForm(db, 1, self!.id, now))).toBe('form_state_invalid')
    releaseTalkForm(db, 1, self!.id, now)
    expect(state()).toBe('released')
    expect(errorCode(() => releaseTalkForm(db, 1, self!.id, now))).toBe('form_state_invalid')
    expect(errorCode(() => reopenTalkForm(db, 1, self!.id, now))).toBe('form_state_invalid')
    withdrawTalkForm(db, 1, self!.id)
    expect(state()).toBe('draft')
    releaseTalkForm(db, 1, self!.id, now)
    submitMyTalkForm(db, anna, self!.id)
    expect(state()).toBe('submitted')
    expect(errorCode(() => submitMyTalkForm(db, anna, self!.id))).toBe('form_state_invalid')
    expect(errorCode(() => withdrawTalkForm(db, 1, self!.id))).toBe('form_state_invalid')
    expect(errorCode(() => releaseTalkForm(db, 1, self!.id, now))).toBe('form_state_invalid')
    reopenTalkForm(db, 1, self!.id, now)
    expect(state()).toBe('released')
    // Assessments are never released for filling in; self forms are never released to read.
    expect(errorCode(() => releaseTalkForm(db, 1, assessment!.id, now))).toBe('form_state_invalid')
    expect(errorCode(() => setTalkFormReadRelease(db, 1, self!.id, true, now))).toBe('form_state_invalid')
  })

  it('keeps when a form was released, submitted and released to read; taking back clears it', () => {
    const id = talkFor(annaId)
    const [self, assessment] = formsOf(id)
    const t1 = new Date('2026-10-26T10:00:00.000Z')
    const t2 = new Date('2026-10-26T11:00:00.000Z')
    const stamps = (index: number) => {
      const form = formsOf(id)[index]!
      return [form.releasedAt, form.submittedAt, form.readReleasedAt]
    }
    expect(stamps(0)).toEqual([null, null, null])
    releaseTalkForm(db, 1, self!.id, t1)
    expect(stamps(0)).toEqual([t1.toISOString(), null, null])
    withdrawTalkForm(db, 1, self!.id)
    expect(stamps(0)).toEqual([null, null, null])
    releaseTalkForm(db, 1, self!.id, t1)
    submitMyTalkForm(db, anna, self!.id, t2)
    expect(stamps(0)).toEqual([t1.toISOString(), t2.toISOString(), null])
    expect(getMyTalkForm(db, anna, self!.id).form.submittedAt).toBe(t2.toISOString())
    reopenTalkForm(db, 1, self!.id, t2)
    expect(stamps(0)).toEqual([t1.toISOString(), null, null])
    setTalkFormReadRelease(db, 1, assessment!.id, true, t2)
    expect(stamps(1)).toEqual([null, null, t2.toISOString()])
    setTalkFormReadRelease(db, 1, assessment!.id, false, t2)
    expect(stamps(1)).toEqual([null, null, null])
  })

  it('a save over someone else’s newer save is refused (409 form_changed), in both directions', () => {
    const id = talkFor(annaId)
    const self = formsOf(id)[0]!
    const item = firstText(self.content)
    releaseTalkForm(db, 1, self.id, now)
    // The employee and the Leitung both load the form …
    const loaded = at(self.id)
    // … the Leitung saves first; the employee's save on the old state is refused.
    saveTalkFormAnswers(db, leitung, 1, self.id, { [item.id]: 'Leitung' }, loaded, new Date('2026-10-26T10:00:00.000Z'))
    expect(errorCode(() => saveMyTalkFormAnswers(db, anna, self.id, { [item.id]: 'Anna' }, loaded, now))).toBe('form_changed')
    expect(formsOf(id)[0]!.answers).toEqual({ [item.id]: 'Leitung' })
    // The other way round: the employee saves first, the Leitung's save on the old state is refused.
    const reloaded = at(self.id)
    saveMyTalkFormAnswers(db, anna, self.id, { [item.id]: 'Anna' }, reloaded, new Date('2026-10-26T11:00:00.000Z'))
    expect(errorCode(() => saveTalkFormAnswers(db, leitung, 1, self.id, { [item.id]: 'Leitung 2' }, reloaded, now)))
      .toBe('form_changed')
    expect(formsOf(id)[0]).toMatchObject({ answers: { [item.id]: 'Anna' }, updatedBy: 'Anna Muster' })
    // With the fresh state the save goes through.
    saveTalkFormAnswers(db, leitung, 1, self.id, { [item.id]: 'Leitung 2' }, at(self.id), new Date('2026-10-26T12:00:00.000Z'))
    expect(formsOf(id)[0]!.answers).toEqual({ [item.id]: 'Leitung 2' })
  })

  it('answers a save with the new last change, so the next save can use it as its base', () => {
    const id = talkFor(annaId)
    const self = formsOf(id)[0]!
    const item = firstText(self.content)
    releaseTalkForm(db, 1, self.id, now)
    const first = saveMyTalkFormAnswers(db, anna, self.id, { [item.id]: 'Eins' }, at(self.id), new Date('2026-10-26T10:00:00.000Z'))
    expect(first).toEqual({
      updatedAt: '2026-10-26T10:00:00.000Z', updatedBy: 'Anna Muster', releasedAt: now.toISOString(), submittedAt: null, readReleasedAt: null,
    })
    const second = saveMyTalkFormAnswers(db, anna, self.id, { [item.id]: 'Zwei' }, first.updatedAt, new Date('2026-10-26T10:05:00.000Z'))
    const third = saveTalkFormAnswers(db, leitung, 1, self.id, { [item.id]: 'Drei' }, second.updatedAt, new Date('2026-10-26T10:10:00.000Z'))
    expect(third).toMatchObject({ updatedAt: '2026-10-26T10:10:00.000Z', updatedBy: 'Lea Leitung' })
    expect(formsOf(id)[0]).toMatchObject({ answers: { [item.id]: 'Drei' }, updatedAt: third.updatedAt })
  })

  it('an employee who has left can no longer save or submit (409 employee_inactive), but still reads', () => {
    const id = talkFor(annaId)
    const self = formsOf(id)[0]!
    const item = firstText(self.content)
    releaseTalkForm(db, 1, self.id, now)
    db.update(employees).set({ leftOn: '2026-10-25' }).where(eq(employees.id, annaId)).run()
    expect(errorCode(() => saveMyTalkFormAnswers(db, anna, self.id, { [item.id]: 'x' }, at(self.id), now))).toBe('employee_inactive')
    expect(errorCode(() => submitMyTalkForm(db, anna, self.id, now))).toBe('employee_inactive')
    expect(getMyTalkForm(db, anna, self.id).form).toMatchObject({ state: 'released', answers: {} })
    // Leaving today: still there today.
    db.update(employees).set({ leftOn: '2026-10-26' }).where(eq(employees.id, annaId)).run()
    submitMyTalkForm(db, anna, self.id, now)
    expect(formsOf(id)[0]!.state).toBe('submitted')
  })

  it('Review Focus 3: after submitting the employee cannot save; after reopening they save and submit again', () => {
    const id = talkFor(annaId)
    const self = formsOf(id)[0]!
    const item = firstText(self.content)
    expect(errorCode(() => saveMyTalkFormAnswers(db, anna, self.id, { [item.id]: 'x' }, at(self.id)))).toBe('form_not_found')
    releaseTalkForm(db, 1, self.id, now)
    saveMyTalkFormAnswers(db, anna, self.id, { [item.id]: 'Entwurf' }, at(self.id), now)
    expect(formsOf(id)[0]).toMatchObject({ answers: { [item.id]: 'Entwurf' }, updatedBy: 'Anna Muster' })
    submitMyTalkForm(db, anna, self.id)
    expect(errorCode(() => saveMyTalkFormAnswers(db, anna, self.id, { [item.id]: 'Nachtrag' }, at(self.id)))).toBe('form_not_editable')
    expect(formsOf(id)[0]!.answers).toEqual({ [item.id]: 'Entwurf' })
    reopenTalkForm(db, 1, self.id, now)
    saveMyTalkFormAnswers(db, anna, self.id, { [item.id]: 'Nachtrag' }, at(self.id), now)
    submitMyTalkForm(db, anna, self.id)
    expect(formsOf(id)[0]).toMatchObject({ state: 'submitted', answers: { [item.id]: 'Nachtrag' } })
  })

  it('no release to an employee who left or has no active account (409 employee_inactive); taking back always works', () => {
    const left = addEmployee(db, 'Weg', { leftOn: '2026-10-25' })
    addUser(db, 'weg', 'observer', left)
    const [self, assessment] = formsOf(talkFor(left), left)
    expect(errorCode(() => releaseTalkForm(db, 1, self!.id, now))).toBe('employee_inactive')
    expect(errorCode(() => setTalkFormReadRelease(db, 1, assessment!.id, true, now))).toBe('employee_inactive')

    // Leaving today: still there today.
    const today = addEmployee(db, 'Heute', { leftOn: '2026-10-26' })
    addUser(db, 'heute', 'observer', today)
    expect(errorCode(() => releaseTalkForm(db, 1, formsOf(talkFor(today), today)[0]!.id, now))).toBeNull()

    const noAccount = addEmployee(db, 'Ohne Zugang')
    expect(errorCode(() => releaseTalkForm(db, 1, formsOf(talkFor(noAccount), noAccount)[0]!.id, now))).toBe('employee_inactive')

    // Anna's account is deactivated after the release: no reopening, no read release, but taking back works.
    const id = talkFor(annaId)
    const [annaSelf, annaAssessment] = formsOf(id)
    releaseTalkForm(db, 1, annaSelf!.id, now)
    setTalkFormReadRelease(db, 1, annaAssessment!.id, true, now)
    submitMyTalkForm(db, anna, annaSelf!.id)
    db.update(users).set({ active: false }).where(eq(users.id, anna.id)).run()
    expect(errorCode(() => reopenTalkForm(db, 1, annaSelf!.id, now))).toBe('employee_inactive')
    setTalkFormReadRelease(db, 1, annaAssessment!.id, false, now)
    expect(errorCode(() => setTalkFormReadRelease(db, 1, annaAssessment!.id, true, now))).toBe('employee_inactive')
    expect(formsOf(id)[1]!.readReleased).toBe(false)
  })
})

describe('one form for the print page', () => {
  it('gives managers any form of their facility with the talk and the names, another facility 404', () => {
    const id = talkFor(annaId)
    const [self] = formsOf(id)
    const facilityName = getTalkForm(db, 1, self!.id).facilityName
    expect(getTalkForm(db, 1, self!.id)).toMatchObject({ talk: { id, ...header }, form: { id: self!.id, state: 'draft' }, employeeName: 'Anna Muster' })
    expect(facilityName).not.toBe('')
    const other = addFacility(db, 'Krippe')
    expect(errorCode(() => getTalkForm(db, other, self!.id))).toBe('form_not_found')
  })
})

describe('the employee’s own talks', () => {
  it('shows only released self forms and assessments released to read, without internal fields', () => {
    const id = talkFor(annaId)
    const [self, assessment] = formsOf(id)
    expect(listMyTalks(db, anna)).toEqual([])
    releaseTalkForm(db, 1, self!.id, now)
    const [talk] = listMyTalks(db, anna)
    expect(Object.keys(talk!).sort()).toEqual(['date', 'forms', 'id', 'participants', 'period', 'start'])
    expect(talk!.forms.map(form => form.id)).toEqual([self!.id])
    expect(getMyTalkForm(db, anna, self!.id)).toMatchObject({ talk: { id, ...header }, form: { id: self!.id, role: 'self' } })
    expect(Object.keys(getMyTalkForm(db, anna, self!.id).talk).sort()).toEqual(['date', 'id', 'participants', 'period', 'start'])
    expect(getMyTalkForm(db, anna, self!.id).employeeName).toBe('Anna Muster')
    expect(errorCode(() => getMyTalkForm(db, anna, assessment!.id))).toBe('form_not_found')
    setTalkFormReadRelease(db, 1, assessment!.id, true, now)
    expect(listMyTalks(db, anna)[0]!.forms.map(form => form.id)).toEqual([self!.id, assessment!.id])
    expect(getMyTalkForm(db, anna, assessment!.id).form.readReleased).toBe(true)
    // An assessment is only read, never written or submitted by the employee.
    expect(errorCode(() => saveMyTalkFormAnswers(db, anna, assessment!.id, {}, at(assessment!.id)))).toBe('form_not_editable')
    expect(errorCode(() => submitMyTalkForm(db, anna, assessment!.id))).toBe('form_state_invalid')
    // Withdrawn again: gone (404).
    withdrawTalkForm(db, 1, self!.id)
    setTalkFormReadRelease(db, 1, assessment!.id, false, now)
    expect(listMyTalks(db, anna)).toEqual([])
    expect(errorCode(() => getMyTalkForm(db, anna, self!.id))).toBe('form_not_found')
  })

  it('Review Focus 2: another employee’s forms and accounts without an employee get 404', () => {
    const id = talkFor(benId)
    const [self, assessment] = formsOf(id, benId)
    releaseTalkForm(db, 1, self!.id, now)
    setTalkFormReadRelease(db, 1, assessment!.id, true, now)
    expect(listMyTalks(db, anna)).toEqual([])
    for (const formId of [self!.id, assessment!.id]) {
      expect(errorCode(() => getMyTalkForm(db, anna, formId))).toBe('form_not_found')
      expect(errorCode(() => saveMyTalkFormAnswers(db, anna, formId, {}, at(formId)))).toBe('form_not_found')
      expect(errorCode(() => submitMyTalkForm(db, anna, formId))).toBe('form_not_found')
    }
    expect(listMyTalks(db, ben)[0]!.forms).toHaveLength(2)
    // The Träger has no employee: 404, also for forms that exist; so has the tablet.
    const tablet = addUser(db, 'tablet', 'terminal')
    for (const user of [traeger, tablet]) {
      expect(errorCode(() => listMyTalks(db, user))).toBe('no_employee')
      expect(errorCode(() => getMyTalkForm(db, user, self!.id))).toBe('form_not_found')
      expect(errorCode(() => saveMyTalkFormAnswers(db, user, self!.id, {}, at(self!.id)))).toBe('form_not_found')
    }
    // The Leitung with an employee of her own sees only her own talks there.
    expect(listMyTalks(db, leitung)).toEqual([])
  })

  it('a left employee can still read their talks', () => {
    const id = talkFor(annaId)
    const self = formsOf(id)[0]!
    releaseTalkForm(db, 1, self.id, now)
    submitMyTalkForm(db, anna, self.id)
    db.update(employees).set({ leftOn: '2026-10-01' }).where(eq(employees.id, annaId)).run()
    expect(listMyTalks(db, anna)[0]!.forms.map(form => form.id)).toEqual([self.id])
    expect(getMyTalkForm(db, anna, self.id).form.state).toBe('submitted')
  })
})
