import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { childGroupChanges, childParentMeetings, children, formEditors, forms, formTemplates } from '../../server/db/schema'
import type { ChildViewer } from '../../server/lib/childViewer'
import { ServiceError } from '../../server/lib/errors'
import {
  createChildForm, deleteChildForm, getChildForm, listChildFormEditors, listChildForms, saveChildForm, setChildFormEditors,
} from '../../server/services/childForms'
import { deleteChild, moveChildToFacility } from '../../server/services/children'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { createTemplate, updateTemplate } from '../../server/services/formTemplates'
import { setReadAccess } from '../../server/services/groupReadAccess'
import { addMeeting, deleteMeeting, meetingsOf } from '../../server/services/parentMeetings'
import { roleBundleRows } from '../../server/services/permissions'
import { saveRoleRights } from '../../server/services/rights'
import { resolveChildViewer, unlockChildren } from '../../server/services/tabletUnlock'
import { setPin } from '../../server/services/terminal'
import { effectiveRights } from '../../shared/domain/permissionBundles'
import {
  addChild, addEmployee, addFacility, addGroup, addUser, asChildViewer, createTestDb, errorCode, permissionsOf,
} from '../helpers/fixtures'

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
  /** Berta at the tablet without an account, an employee of another group (the Füchse) who may read the Bären. */
  let bertaTablet: ChildViewer
  /** Emil at the tablet without an account, an employee of the child's group (not its key educator). */
  let emil: number
  let emilTablet: ChildViewer
  let tablet: Omit<ChildViewer, 'id' | 'employeeId' | 'name'>

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
    berta = addEmployee(db, 'Berta', { groupId: groupB })
    emil = addEmployee(db, 'Emil', { groupId: groupA })
    const annaUser = addUser(db, 'anna', 'observer', anna).id
    leitung = asChildViewer(addUser(db, 'leitung', 'admin'))
    tablet = {
      visibility: { waitlist: false, futureContracts: false }, onTablet: true, groups: { own: groupA, readable: [] },
      role: 'observer' as const, permissions: permissionsOf('observer'), facilityId: 1,
    }
    annaTablet = { id: annaUser, employeeId: anna, name: 'Anna', ...tablet }
    // Berta works in the Füchse, whose staff may read the Bären.
    bertaTablet = { id: null, employeeId: berta, name: 'Berta', ...tablet, groups: { own: groupB, readable: [groupA] } }
    emilTablet = { id: null, employeeId: emil, name: 'Emil', ...tablet }
    kid = addChild(db, 1, { firstName: 'Lena', groupId: groupA, keyEducatorId: anna })
    hiddenKid = addChild(db, 1, { firstName: 'Ida', groupId: groupB, keyEducatorId: anna })
    template = db.select({ id: formTemplates.id }).from(formTemplates)
      .where(and(eq(formTemplates.facilityId, 1), eq(formTemplates.starterKey, 'child_development'))).get()!.id
  })

  it('the key educator creates and edits; Berta of another group reads until unlocked for that one form (Review Focus 1)', () => {
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

  describe('„Bögen der eigenen Gruppe“ (childForms.group)', () => {
    it('an employee of the child\'s group creates and edits at the tablet, also the Entwicklungsgespräch of a parent meeting', () => {
      expect(listChildForms(db, emilTablet, kid, NOW)).toMatchObject({ canCreate: true, templates: [{ id: template }] })
      const own = createChildForm(db, emilTablet, kid, { templateId: template, ...header }, NOW)
      const byLeitung = createChildForm(db, leitung, kid, { templateId: template, ...header, date: '2026-10-01' }, NOW)
      expect(listChildForms(db, emilTablet, kid, NOW).forms.map(form => [form.id, form.right, form.canManage]))
        .toEqual([[own, 'edit', false], [byLeitung, 'edit', false]])
      expect(save(emilTablet, byLeitung, {})).toEqual({ updatedAt: LATER.toISOString(), updatedBy: 'Emil' })
      expect(getChildForm(db, leitung, byLeitung, NOW).updatedBy).toBe('Emil')

      const meeting = addMeeting(db, leitung, kid, {
        date: '2026-10-05', start: 840, end: 900, kind: 'development', participants: 'Vater, Emil',
      }, NOW)
      const meetingForm = createChildForm(db, emilTablet, kid, { templateId: template, parentMeetingId: meeting }, NOW)
      expect(save(emilTablet, meetingForm, {}).updatedBy).toBe('Emil')

      // Deleting and unlocking stay with Leitung and Träger.
      expect(failure(() => deleteChildForm(db, emilTablet, own, NOW))).toBe('403 forbidden')
      expect(failure(() => setChildFormEditors(db, emilTablet, own, [berta], NOW))).toBe('403 forbidden')
      expect(failure(() => listChildFormEditors(db, emilTablet, own, NOW))).toBe('403 forbidden')
    })

    it('an employee of another group only reads (403 on create and save); a hidden group stays 404', () => {
      const formId = createChildForm(db, emilTablet, kid, { templateId: template, ...header }, NOW)
      expect(listChildForms(db, bertaTablet, kid, NOW)).toMatchObject({ canCreate: false, templates: [], forms: [{ id: formId, right: 'read' }] })
      expect(failure(() => createChildForm(db, bertaTablet, kid, { templateId: template, ...header }, NOW))).toBe('403 forbidden')
      expect(failure(() => save(bertaTablet, formId, {}))).toBe('403 forbidden')
      // Emil does not see the Füchse at all.
      const foxForm = createChildForm(db, bertaTablet, hiddenKid, { templateId: template, ...header }, NOW)
      expect(failure(() => getChildForm(db, emilTablet, foxForm, NOW))).toBe('404 child_not_found')
      expect(failure(() => createChildForm(db, emilTablet, hiddenKid, { templateId: template, ...header }, NOW))).toBe('404 child_not_found')
    })

    it('works with the own account where children.ownAccount lets the person see the child', () => {
      const emilAccount = () => resolveChildViewer(db, emilUser, undefined, NOW)
      const emilUser = addUser(db, 'emil', 'group_lead', emil)
      const formId = createChildForm(db, emilAccount(), kid, { templateId: template, ...header }, NOW)
      expect(save(emilAccount(), formId, {}).updatedBy).toBe('Emil')
      expect(listChildForms(db, emilAccount(), kid, NOW)).toMatchObject({ canCreate: true, forms: [{ id: formId, right: 'edit' }] })

      // Berta's account (Füchse) sees the Bären once her group may read them, and then only reads.
      const bertaUser = addUser(db, 'berta', 'group_lead', berta)
      expect(failure(() => listChildForms(db, resolveChildViewer(db, bertaUser, undefined, NOW), kid, NOW))).toBe('404 child_not_found')
      setReadAccess(db, 1, groupB, [groupA])
      const bertaAccount = resolveChildViewer(db, bertaUser, undefined, NOW)
      expect(listChildForms(db, bertaAccount, kid, NOW)).toMatchObject({ canCreate: false, forms: [{ id: formId, right: 'read' }] })
      expect(failure(() => createChildForm(db, bertaAccount, kid, { templateId: template, ...header }, NOW))).toBe('403 forbidden')
      expect(failure(() => save(bertaAccount, formId, {}))).toBe('403 forbidden')
      expect(failure(() => deleteChildForm(db, emilAccount(), formId, NOW))).toBe('403 forbidden')
    })

    it('switched off for the role, the rule of before applies again (key educator and unlocked employees at the tablet)', () => {
      saveRoleRights(db, 'group_lead', [{ id: 'formsGroup', enabled: false }])
      saveRoleRights(db, 'observer', [{ id: 'formsGroup', enabled: false }])
      const observerNow = effectiveRights({ role: 'observer', roleBundles: roleBundleRows(db, 'observer') }).permissions
      expect(observerNow.has('childForms.group')).toBe(false)
      const emilOff = { ...emilTablet, permissions: observerNow }
      const annaOff = { ...annaTablet, permissions: observerNow }

      const formId = createChildForm(db, annaOff, kid, { templateId: template, ...header }, NOW)
      expect(listChildForms(db, emilOff, kid, NOW)).toMatchObject({ canCreate: false, forms: [{ id: formId, right: 'read' }] })
      expect(failure(() => createChildForm(db, emilOff, kid, { templateId: template, ...header }, NOW))).toBe('403 forbidden')
      expect(failure(() => save(emilOff, formId, {}))).toBe('403 forbidden')
      setChildFormEditors(db, leitung, formId, [emil], NOW)
      expect(save(emilOff, formId, {}).updatedBy).toBe('Emil')
      expect(save(annaOff, formId, {}, new Date('2026-10-20T10:00:00Z')).updatedBy).toBe('Anna')

      // With the own account (the session user is loaded per request with the role's rights): read only (key educator
      // and unlocks count at the tablet).
      const emilAccount = resolveChildViewer(db, addUser(db, 'emil', 'group_lead', emil), undefined, NOW)
      expect(emilAccount.permissions.has('childForms.group')).toBe(false)
      expect(listChildForms(db, emilAccount, kid, NOW)).toMatchObject({ canCreate: false, forms: [{ id: formId, right: 'read' }] })
      expect(failure(() => createChildForm(db, emilAccount, kid, { templateId: template, ...header }, NOW))).toBe('403 forbidden')
    })

    it('judges the group of today: a due group change counts before the daily run', () => {
      db.insert(childGroupChanges).values({ childId: kid, groupId: groupB, fromDate: '2026-10-20', createdAt: NOW.toISOString() }).run()
      // Emil (Bären) no longer reaches the child, Berta (Füchse) now keeps it.
      expect(failure(() => createChildForm(db, emilTablet, kid, { templateId: template, ...header }, NOW))).toBe('404 child_not_found')
      expect(createChildForm(db, bertaTablet, kid, { templateId: template, ...header }, NOW)).toBeGreaterThan(0)
    })

    it('reads judge the group of today without applying the change; a save applies it first', () => {
      const formId = createChildForm(db, leitung, kid, { templateId: template, ...header }, NOW)
      db.insert(childGroupChanges).values({ childId: kid, groupId: groupB, fromDate: '2026-10-20', createdAt: NOW.toISOString() }).run()
      // Emil (Bären) still sees the record until the change is applied, but the child is no longer of his group.
      expect(listChildForms(db, emilTablet, kid, NOW)).toMatchObject({ canCreate: false, forms: [{ id: formId, right: 'read' }] })
      expect(getChildForm(db, emilTablet, formId, NOW).right).toBe('read')
      // Berta (Füchse) keeps the child from today on.
      expect(listChildForms(db, bertaTablet, kid, NOW)).toMatchObject({ canCreate: true, forms: [{ id: formId, right: 'edit' }] })
      expect(getChildForm(db, bertaTablet, formId, NOW).right).toBe('edit')
      // Reading changed nothing.
      expect(db.select({ groupId: children.groupId }).from(children).where(eq(children.id, kid)).get()!.groupId).toBe(groupA)
      // Saving applies the change: Emil no longer reaches the child, Berta saves.
      expect(failure(() => save(emilTablet, formId, {}))).toBe('404 child_not_found')
      expect(save(bertaTablet, formId, {}).updatedBy).toBe('Berta')
      expect(db.select({ groupId: children.groupId }).from(children).where(eq(children.id, kid)).get()!.groupId).toBe(groupB)
    })

    it('end to end through the tablet unlock: an employee without account gets the switch from the Mitarbeiter role', () => {
      setTimeTrackingFrom(db, 1, '2026-10-01')
      const terminal = addUser(db, 'tablet', 'terminal')
      const unlockedBy = (employeeId: number) => {
        setPin(db, 1, employeeId, '123456')
        const { token } = unlockChildren(db, { id: terminal.id, facilityId: 1 }, employeeId, '123456', NOW)
        return resolveChildViewer(db, terminal, token, NOW)
      }
      const emilUnlocked = unlockedBy(emil)
      expect(emilUnlocked).toMatchObject({ id: null, employeeId: emil, onTablet: true })
      expect(emilUnlocked.permissions.has('childForms.group')).toBe(true)
      const formId = createChildForm(db, emilUnlocked, kid, { templateId: template, ...header }, NOW)
      expect(save(unlockedBy(emil), formId, {}).updatedBy).toBe('Emil')

      saveRoleRights(db, 'observer', [{ id: 'formsGroup', enabled: false }])
      const off = unlockedBy(emil)
      expect(off.permissions.has('childForms.group')).toBe(false)
      expect(listChildForms(db, off, kid, NOW)).toMatchObject({ canCreate: false, forms: [{ id: formId, right: 'read' }] })
      expect(failure(() => save(off, formId, {}))).toBe('403 forbidden')
      expect(failure(() => createChildForm(db, off, kid, { templateId: template, ...header }, NOW))).toBe('403 forbidden')
    })

    it('only the home group counts: staff without a home group and helpers from another facility read only', () => {
      const formId = createChildForm(db, leitung, kid, { templateId: template, ...header }, NOW)
      // Without a home group the viewer sees every group (groups null), but no group is its own for the forms.
      const floater = addEmployee(db, 'Frieda')
      const helper = addEmployee(db, 'Hanna', { facilityId: addFacility(db, 'Krippe') })
      for (const [employeeId, name] of [[floater, 'Frieda'], [helper, 'Hanna']] as const) {
        const viewer: ChildViewer = { id: null, employeeId, name, ...tablet, groups: null }
        expect(listChildForms(db, viewer, kid, NOW), name).toMatchObject({ canCreate: false, forms: [{ id: formId, right: 'read' }] })
        expect(failure(() => createChildForm(db, viewer, kid, { templateId: template, ...header }, NOW)), name).toBe('403 forbidden')
        expect(failure(() => save(viewer, formId, {})), name).toBe('403 forbidden')
      }
      // Unlocked for the form, the person without home group edits it (as before; a helper from another facility cannot be
      // unlocked, see 'unlocking, revoking and deleting are for managers only').
      setChildFormEditors(db, leitung, formId, [floater], NOW)
      expect(save({ id: null, employeeId: floater, name: 'Frieda', ...tablet, groups: null }, formId, {}).updatedBy).toBe('Frieda')
      // A wider attendance scope does not widen it either: Berta (Füchse) keeps the attendance of every group.
      const bertaWide: ChildViewer = { ...bertaTablet, groups: null, writeGroups: { attendance: null, edit: null } }
      expect(listChildForms(db, bertaWide, kid, NOW).canCreate).toBe(false)
    })

    it('a child without group: only Leitung, the key educator and the unlocked employees', () => {
      db.update(children).set({ groupId: null }).where(eq(children.id, kid)).run()
      expect(listChildForms(db, emilTablet, kid, NOW).canCreate).toBe(false)
      expect(failure(() => createChildForm(db, emilTablet, kid, { templateId: template, ...header }, NOW))).toBe('403 forbidden')
      const formId = createChildForm(db, annaTablet, kid, { templateId: template, ...header }, NOW)
      expect(getChildForm(db, emilTablet, formId, NOW).right).toBe('read')
      expect(failure(() => save(emilTablet, formId, {}))).toBe('403 forbidden')
      expect(save(leitung, formId, {}).updatedBy).toBe('leitung')
      setChildFormEditors(db, leitung, formId, [emil], NOW)
      expect(save(emilTablet, formId, {}, new Date('2026-10-20T10:00:00Z')).updatedBy).toBe('Emil')
    })

    it('an archived record is read-only for everybody (others do not see it)', () => {
      const formId = createChildForm(db, emilTablet, kid, { templateId: template, ...header }, NOW)
      db.update(children).set({ leftOn: '2026-07-31' }).where(eq(children.id, kid)).run()
      expect(failure(() => save(emilTablet, formId, {}))).toBe('404 child_not_found')
      expect(failure(() => createChildForm(db, emilTablet, kid, { templateId: template, ...header }, NOW))).toBe('404 child_not_found')
    })
  })

  it('unlocking, revoking and deleting are for managers only', () => {
    const formId = createChildForm(db, annaTablet, kid, { templateId: template, ...header }, NOW)
    expect(failure(() => setChildFormEditors(db, annaTablet, formId, [berta], NOW))).toBe('403 forbidden')
    expect(failure(() => listChildFormEditors(db, annaTablet, formId, NOW))).toBe('403 forbidden')
    expect(failure(() => deleteChildForm(db, annaTablet, formId, NOW))).toBe('403 forbidden')
    const other = addEmployee(db, 'Fremd', { facilityId: addFacility(db, 'Krippe') })
    expect(failure(() => setChildFormEditors(db, leitung, formId, [other], NOW))).toBe('404 employee_not_found')
    const left = addEmployee(db, 'Carla', { groupId: groupA, leftOn: '2026-10-19' })
    expect(failure(() => setChildFormEditors(db, leitung, formId, [left], NOW))).toBe('409 employee_inactive')
    // Leaving today still counts as there.
    const leavingToday = addEmployee(db, 'Dora', { groupId: groupA, leftOn: '2026-10-20' })
    expect(setChildFormEditors(db, leitung, formId, [leavingToday], NOW).map(editor => editor.name)).toEqual(['Dora'])
    expect(listChildFormEditors(db, leitung, formId, NOW).map(editor => editor.name)).toEqual(['Dora'])

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
    // A new facility starts without the child starter: its own child template.
    const foreign = createTemplate(db, leitung, otherFacility, { kind: 'child', name: 'Fremd', selfAssessment: false }, NOW)
    expect(create(foreign)).toBe('404 form_template_not_found')
    const own = createTemplate(db, leitung, 1, { kind: 'child', name: 'Eingewöhnung', selfAssessment: false }, NOW)
    updateTemplate(db, leitung, 1, own, { archived: true }, NOW)
    expect(create(own)).toBe('409 form_template_archived')
    // The choice to start from: the facility's active child templates, only for whoever may start a form.
    expect(listChildForms(db, annaTablet, kid, NOW).templates).toEqual([{ id: template, name: 'Entwicklungsgespräch', category: 'Kinder' }])
    expect(listChildForms(db, bertaTablet, kid, NOW).templates).toEqual([])
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

  it('formatted answers are sanitized on save and read back as stored', () => {
    const formId = createChildForm(db, leitung, kid, { templateId: template, ...header }, NOW)
    const text = getChildForm(db, leitung, formId, NOW).content.sections.flatMap(section => section.items).find(item => item.kind === 'text')!
    save(annaTablet, formId, { [text.id]: '<p><i>spielt</i> gern<style>p{}</style></p><ul><li>Bauecke<ul><li>Lego</li></ul></li></ul>' })
    const stored = '<p><em>spielt</em> gern</p><ul><li><p>Bauecke</p><ul><li><p>Lego</p></li></ul></li></ul>'
    expect(getChildForm(db, leitung, formId, NOW).answers[text.id]).toBe(stored)
    save(leitung, formId, { [text.id]: stored }, new Date('2026-10-20T10:00:00Z'))
    expect(getChildForm(db, annaTablet, formId, NOW).answers[text.id]).toBe(stored)
  })

  it('deleting the meeting keeps the form; deleting the child deletes its forms and grants (Review Focus 4)', () => {
    const meeting = addMeeting(db, leitung, kid, {
      date: '2026-10-05', start: 840, end: null, kind: 'development', participants: '',
    }, NOW)
    const formId = createChildForm(db, leitung, kid, { templateId: template, parentMeetingId: meeting }, NOW)
    setChildFormEditors(db, leitung, formId, [berta], NOW)
    deleteMeeting(db, leitung, meeting, NOW)
    expect(getChildForm(db, leitung, formId, NOW)).toMatchObject({ parentMeetingId: null, date: '2026-10-05' })

    const otherForm = createChildForm(db, leitung, hiddenKid, { templateId: template, ...header }, NOW)
    db.update(children).set({ leftOn: '2010-01-01' }).where(eq(children.id, kid)).run()
    deleteChild(db, 1, kid)
    expect(db.select({ id: forms.id }).from(forms).where(eq(forms.kind, 'child')).all()).toEqual([{ id: otherForm }])
    expect(db.select().from(formEditors).all()).toEqual([])
    expect(db.select().from(childParentMeetings).all()).toEqual([])
  })

  it('an archived record stays readable for managers only, and is not changed any more', () => {
    const formId = createChildForm(db, leitung, kid, { templateId: template, ...header }, NOW)
    db.update(children).set({ leftOn: '2026-07-31' }).where(eq(children.id, kid)).run()
    expect(listChildForms(db, leitung, kid, NOW)).toMatchObject({
      canCreate: false, forms: [{ id: formId, right: 'read', canManage: false }],
    })
    expect(getChildForm(db, leitung, formId, NOW).canManage).toBe(false)
    expect(failure(() => setChildFormEditors(db, leitung, formId, [berta], NOW))).toBe('409 child_archived')
    expect(failure(() => deleteChildForm(db, leitung, formId, NOW))).toBe('409 child_archived')
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
