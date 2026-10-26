import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { childParentMeetings, children, formEditors, forms, formTemplates } from '../../server/db/schema'
import type { ChildViewer } from '../../server/lib/childViewer'
import { ServiceError } from '../../server/lib/errors'
import {
  createChildForm, deleteChildForm, getChildForm, listChildFormEditors, listChildForms, saveChildForm, setChildFormEditors,
} from '../../server/services/childForms'
import { moveChildToFacility, purgeExpiredChildren } from '../../server/services/children'
import { createTemplate, updateTemplate } from '../../server/services/formTemplates'
import { addMeeting, deleteMeeting, meetingsOf } from '../../server/services/parentMeetings'
import { resolveChildViewer } from '../../server/services/tabletUnlock'
import { addChild, addEmployee, addFacility, addGroup, addUser, asChildViewer, createTestDb, errorCode } from '../helpers/fixtures'

const NOW = new Date('2026-10-20T08:00:00Z')
const LATER = new Date('2026-10-20T09:00:00Z')

/** "<status> <code>" of the ServiceError fn throws, or null if it does not throw. */
function failure(fn: () => unknown): string | null {
  try {
    fn()
    return null
  }
  catch (error) {
    if (error instanceof ServiceError) return `${error.statusCode} ${error.code}`
    throw error
  }
}

describe('child observation forms', () => {
  let db: Db
  let groupA: number
  let groupB: number
  let anna: number
  let berta: number
  let kid: number
  let hiddenKid: number
  let template: number
  let leitung: ChildViewer
  /** Anna at the tablet: the child's key educator, a Mitarbeiter account without the permission to edit records. */
  let annaTablet: ChildViewer
  /** Berta at the tablet without an account. */
  let bertaTablet: ChildViewer

  const header = { date: '2026-10-15', start: 600, participants: 'Mutter, Anna' }
  const save = (viewer: ChildViewer, formId: number, answers: unknown, now = LATER) => {
    const loaded = getChildForm(db, leitung, formId, now).updatedAt
    return saveChildForm(db, viewer, formId, { ...header, answers, expectedUpdatedAt: loaded }, now)
  }
  /** The id of the first answerable item of a form (a choices item in the starter) and its first option. */
  const firstChoice = (formId: number) => {
    const item = getChildForm(db, leitung, formId, NOW).content.sections[0]!.items[0]!
    if (item.kind !== 'choices') throw new Error('expected choices')
    return { itemId: item.id, optionId: item.options[0]!.id }
  }

  beforeEach(() => {
    db = createTestDb()
    groupA = addGroup(db, 1, 'Bären')
    groupB = addGroup(db, 1, 'Füchse')
    anna = addEmployee(db, 'Anna', { groupId: groupA })
    berta = addEmployee(db, 'Berta', { groupId: groupA })
    const annaUser = addUser(db, 'anna', 'observer', anna).id
    leitung = asChildViewer(addUser(db, 'leitung', 'admin'))
    const tablet = {
      visibility: { waitlist: false, futureContracts: false }, onTablet: true, groups: { own: groupA, readable: [] },
      role: 'observer' as const, canEditChildren: false, facilityId: 1,
    }
    annaTablet = { id: annaUser, employeeId: anna, name: 'Anna', ...tablet }
    bertaTablet = { id: null, employeeId: berta, name: 'Berta', ...tablet }
    kid = addChild(db, 1, { firstName: 'Lena', groupId: groupA, keyEducatorId: anna })
    hiddenKid = addChild(db, 1, { firstName: 'Ida', groupId: groupB, keyEducatorId: anna })
    template = db.select({ id: formTemplates.id }).from(formTemplates)
      .where(and(eq(formTemplates.facilityId, 1), eq(formTemplates.starterKey, 'child_development'))).get()!.id
  })

  it('the key educator creates and edits; Berta reads until unlocked for that one form (Review Focus 1)', () => {
    const formA = createChildForm(db, annaTablet, kid, { templateId: template, ...header }, NOW)
    const formB = createChildForm(db, leitung, kid, { templateId: template, ...header, date: '2026-10-10' }, NOW)
    const { itemId, optionId } = firstChoice(formA)

    expect(save(annaTablet, formA, { [itemId]: [optionId] })).toEqual({ updatedAt: LATER.toISOString(), updatedBy: 'Anna' })
    expect(getChildForm(db, annaTablet, formA, NOW)).toMatchObject({
      right: 'edit', canManage: false, answers: { [itemId]: [optionId] }, title: 'Entwicklungsgespräch', updatedBy: 'Anna',
      child: { firstName: 'Lena', groupName: 'Bären' }, ...header,
    })

    // Berta: read only, may not start a form.
    expect(listChildForms(db, bertaTablet, kid, NOW)).toMatchObject({
      canCreate: false, forms: [{ id: formA, right: 'read' }, { id: formB, right: 'read' }],
    })
    expect(failure(() => save(bertaTablet, formA, {}))).toBe('403 forbidden')
    expect(failure(() => createChildForm(db, bertaTablet, kid, { templateId: template, ...header }, NOW))).toBe('403 forbidden')

    // A manager unlocks her for form A only.
    expect(setChildFormEditors(db, leitung, formA, [berta], NOW)).toEqual([
      { employeeId: berta, name: 'Berta', grantedAt: NOW.toISOString(), grantedBy: 'leitung' },
    ])
    expect(listChildForms(db, bertaTablet, kid, NOW).forms.map(form => [form.id, form.right]))
      .toEqual([[formA, 'edit'], [formB, 'read']])
    expect(save(bertaTablet, formA, {}).updatedBy).toBe('Berta')
    expect(failure(() => save(bertaTablet, formB, {}))).toBe('403 forbidden')

    // Revoking takes it back.
    setChildFormEditors(db, leitung, formA, [], LATER)
    expect(getChildForm(db, bertaTablet, formA, NOW).right).toBe('read')
    expect(listChildFormEditors(db, leitung, formA, NOW)).toEqual([])
  })

  it('managers edit and manage every form; the list is newest first', () => {
    const older = createChildForm(db, annaTablet, kid, { templateId: template, ...header, date: '2026-09-01' }, NOW)
    const newer = createChildForm(db, annaTablet, kid, { templateId: template, ...header, start: null }, NOW)
    expect(listChildForms(db, leitung, kid, NOW)).toMatchObject({
      canCreate: true, forms: [{ id: newer, right: 'edit', canManage: true, start: null }, { id: older, right: 'edit' }],
    })
    expect(listChildForms(db, annaTablet, kid, NOW).canCreate).toBe(true)
  })

  it('a tablet viewer who does not see the child gets 404 on every call (Review Focus 2)', () => {
    const formId = createChildForm(db, leitung, hiddenKid, { templateId: template, ...header }, NOW)
    expect(failure(() => listChildForms(db, annaTablet, hiddenKid, NOW))).toBe('404 child_not_found')
    expect(failure(() => createChildForm(db, annaTablet, hiddenKid, { templateId: template, ...header }, NOW))).toBe('404 child_not_found')
    expect(failure(() => getChildForm(db, annaTablet, formId, NOW))).toBe('404 child_not_found')
    expect(failure(() => save(annaTablet, formId, {}))).toBe('404 child_not_found')
    expect(failure(() => setChildFormEditors(db, annaTablet, formId, [], NOW))).toBe('404 child_not_found')
    expect(failure(() => listChildFormEditors(db, annaTablet, formId, NOW))).toBe('404 child_not_found')
    expect(failure(() => deleteChildForm(db, annaTablet, formId, NOW))).toBe('404 child_not_found')
    // Another facility's form or a staff form is no child form of the viewer's.
    expect(failure(() => getChildForm(db, leitung, 999, NOW))).toBe('404 form_not_found')
  })

  it('a Mitarbeiter account outside the tablet never gets a child viewer (Review Focus 2)', () => {
    const observer = addUser(db, 'berta', 'observer', berta)
    expect(errorCode(() => resolveChildViewer(db, observer, undefined, NOW))).toBe('children_tablet_only')
  })

  it('unlocking, revoking and deleting are for managers only', () => {
    const formId = createChildForm(db, annaTablet, kid, { templateId: template, ...header }, NOW)
    expect(failure(() => setChildFormEditors(db, annaTablet, formId, [berta], NOW))).toBe('403 forbidden')
    expect(failure(() => listChildFormEditors(db, annaTablet, formId, NOW))).toBe('403 forbidden')
    expect(failure(() => deleteChildForm(db, annaTablet, formId, NOW))).toBe('403 forbidden')
    const other = addEmployee(db, 'Fremd', { facilityId: addFacility(db, 'Krippe') })
    expect(failure(() => setChildFormEditors(db, leitung, formId, [other], NOW))).toBe('404 employee_not_found')

    setChildFormEditors(db, leitung, formId, [berta], NOW)
    // A grant that stays keeps its date.
    setChildFormEditors(db, leitung, formId, [berta, berta], LATER)
    expect(listChildFormEditors(db, leitung, formId, NOW).map(editor => editor.grantedAt)).toEqual([NOW.toISOString()])
    deleteChildForm(db, leitung, formId, NOW)
    expect(db.select().from(forms).where(eq(forms.id, formId)).all()).toEqual([])
    expect(db.select().from(formEditors).all()).toEqual([])
  })

  it('a form from a parent meeting copies its header and links it; a second one is 409', () => {
    const meeting = addMeeting(db, leitung, kid, {
      date: '2026-10-05', start: 840, end: 900, kind: 'development', participants: 'Vater, Anna',
    }, NOW)
    const formId = createChildForm(db, annaTablet, kid, { templateId: template, parentMeetingId: meeting }, NOW)
    expect(getChildForm(db, leitung, formId, NOW)).toMatchObject({
      date: '2026-10-05', start: 840, participants: 'Vater, Anna', parentMeetingId: meeting,
    })
    expect(meetingsOf(db, leitung, kid, NOW).map(entry => entry.formId)).toEqual([formId])
    expect(failure(() => createChildForm(db, leitung, kid, { templateId: template, parentMeetingId: meeting }, NOW)))
      .toBe('409 child_form_meeting_taken')
    // A meeting of another child is not found.
    expect(failure(() => createChildForm(db, leitung, hiddenKid, { templateId: template, parentMeetingId: meeting }, NOW)))
      .toBe('404 meeting_not_found')
  })

  it('the template must be an active child template of the facility', () => {
    const staffTemplate = db.select({ id: formTemplates.id }).from(formTemplates)
      .where(and(eq(formTemplates.facilityId, 1), eq(formTemplates.kind, 'staff'))).get()!.id
    const create = (templateId: number) => failure(() => createChildForm(db, leitung, kid, { templateId, ...header }, NOW))
    expect(create(staffTemplate)).toBe('404 form_template_not_found')
    const otherFacility = addFacility(db, 'Krippe')
    const foreign = db.select({ id: formTemplates.id }).from(formTemplates)
      .where(and(eq(formTemplates.facilityId, otherFacility), eq(formTemplates.kind, 'child'))).get()!.id
    expect(create(foreign)).toBe('404 form_template_not_found')
    const own = createTemplate(db, leitung, 1, { kind: 'child', name: 'Eingewöhnung', selfAssessment: false }, NOW)
    updateTemplate(db, leitung, 1, own, { archived: true }, NOW)
    expect(create(own)).toBe('409 form_template_archived')
  })

  it('checks the header and the answers, and refuses a save over a newer one (409 form_changed)', () => {
    const formId = createChildForm(db, leitung, kid, { templateId: template, ...header }, NOW)
    expect(failure(() => createChildForm(db, leitung, kid, { templateId: template, ...header, date: '2026-02-30' }, NOW)))
      .toBe('400 child_form_date_invalid')
    expect(failure(() => createChildForm(db, leitung, kid, { templateId: template, ...header, start: 1440 }, NOW)))
      .toBe('400 child_form_start_invalid')
    expect(failure(() => createChildForm(db, leitung, kid, { templateId: template, ...header, participants: 'x'.repeat(301) }, NOW)))
      .toBe('400 child_form_participants_too_long')

    const loaded = getChildForm(db, leitung, formId, NOW).updatedAt
    expect(failure(() => saveChildForm(db, leitung, formId, { ...header, answers: { nope: 'x' }, expectedUpdatedAt: loaded }, LATER)))
      .toBe('400 form_answer_invalid')
    saveChildForm(db, annaTablet, formId, { ...header, participants: ' Mutter ', answers: {}, expectedUpdatedAt: loaded }, LATER)
    expect(getChildForm(db, leitung, formId, NOW).participants).toBe('Mutter')
    expect(failure(() => saveChildForm(db, leitung, formId, { ...header, answers: {}, expectedUpdatedAt: loaded }, LATER)))
      .toBe('409 form_changed')
  })

  it('deleting the meeting keeps the form; purging the child deletes its forms and grants (Review Focus 4)', () => {
    const meeting = addMeeting(db, leitung, kid, {
      date: '2026-10-05', start: 840, end: null, kind: 'development', participants: '',
    }, NOW)
    const formId = createChildForm(db, leitung, kid, { templateId: template, parentMeetingId: meeting }, NOW)
    setChildFormEditors(db, leitung, formId, [berta], NOW)
    deleteMeeting(db, leitung, meeting, NOW)
    expect(getChildForm(db, leitung, formId, NOW)).toMatchObject({ parentMeetingId: null, date: '2026-10-05' })

    const otherForm = createChildForm(db, leitung, hiddenKid, { templateId: template, ...header }, NOW)
    db.update(children).set({ leftOn: '2010-01-01' }).where(eq(children.id, kid)).run()
    expect(purgeExpiredChildren(db, '2026-10-20')).toBe(1)
    expect(db.select({ id: forms.id }).from(forms).where(eq(forms.kind, 'child')).all()).toEqual([{ id: otherForm }])
    expect(db.select().from(formEditors).all()).toEqual([])
    expect(db.select().from(childParentMeetings).all()).toEqual([])
  })

  it('an archived record stays readable for managers only, and is not changed any more', () => {
    const formId = createChildForm(db, leitung, kid, { templateId: template, ...header }, NOW)
    db.update(children).set({ leftOn: '2026-07-31' }).where(eq(children.id, kid)).run()
    expect(listChildForms(db, leitung, kid, NOW)).toMatchObject({ canCreate: false, forms: [{ id: formId, right: 'read' }] })
    expect(failure(() => save(leitung, formId, {}))).toBe('409 child_archived')
    expect(failure(() => createChildForm(db, leitung, kid, { templateId: template, ...header }, NOW))).toBe('409 child_archived')
    expect(failure(() => listChildForms(db, annaTablet, kid, NOW))).toBe('404 child_not_found')
  })

  it('a record moved to another facility takes its forms along, without template link or grants', () => {
    const formId = createChildForm(db, leitung, kid, { templateId: template, ...header }, NOW)
    setChildFormEditors(db, leitung, formId, [berta], NOW)
    const target = addFacility(db, 'Krippe')
    moveChildToFacility(db, kid, target, NOW)
    expect(db.select({ facilityId: forms.facilityId, templateId: forms.templateId }).from(forms).where(eq(forms.id, formId)).get())
      .toEqual({ facilityId: target, templateId: null })
    expect(db.select().from(formEditors).all()).toEqual([])
    expect(failure(() => getChildForm(db, leitung, formId, NOW))).toBe('404 form_not_found')
    expect(getChildForm(db, asChildViewer(addUser(db, 'leitung2', 'admin', null, target)), formId, NOW).id).toBe(formId)
  })
})
