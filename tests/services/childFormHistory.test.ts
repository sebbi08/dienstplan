import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { children, formReads, formRevisions, formTemplates } from '../../server/db/schema'
import type { ChildViewer } from '../../server/lib/childViewer'
import { ServiceError } from '../../server/lib/errors'
import {
  createChildForm, deleteChildForm, getChildForm, saveChildForm,
} from '../../server/services/childForms'
import { getChildFormRevision, listChildFormRevisions, markChildFormOpened } from '../../server/services/childFormHistory'
import { deleteChild, moveChildToFacility } from '../../server/services/children'
import { REVISION_PAGE_SIZE } from '../../server/services/formRevisions'
import { compareForms, formDiff } from '../../shared/domain/formHistory'
import type { AnswerableItem, FormAnswers, FormContent } from '../../shared/domain/forms'
import { addChild, addEmployee, addFacility, addGroup, addUser, asChildViewer, createTestDb, permissionsOf } from '../helpers/fixtures'

const NOW = new Date('2026-10-20T08:00:00Z')
const at = (hour: number) => new Date(`2026-10-20T${String(hour).padStart(2, '0')}:00:00Z`)

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

describe('history of child forms („Verlauf“)', () => {
  let db: Db
  let kid: number
  let hiddenKid: number
  let template: number
  let leitung: ChildViewer
  /** Anna at the tablet: the child's key educator (edits). */
  let annaTablet: ChildViewer
  /** Berta at the tablet, of another group that may read the child's group: reads only. */
  let bertaTablet: ChildViewer
  let anna: number

  const header = { date: '2026-10-15', start: 600, participants: 'Mutter, Anna' }
  const save = (viewer: ChildViewer, formId: number, answers: FormAnswers, now: Date) => {
    const loaded = getChildForm(db, leitung, formId, now).updatedAt
    return saveChildForm(db, viewer, formId, { ...header, answers, expectedUpdatedAt: loaded }, now)
  }
  const items = (formId: number) => getChildForm(db, leitung, formId, NOW).content.sections.flatMap(section => section.items)
  const itemOf = <K extends AnswerableItem['kind']>(formId: number, kind: K) =>
    items(formId).find(item => item.kind === kind) as Extract<AnswerableItem, { kind: K }>
  const revisionRows = (formId: number) => db.select().from(formRevisions).where(eq(formRevisions.formId, formId)).all()

  beforeEach(() => {
    db = createTestDb()
    const groupA = addGroup(db, 1, 'Bären')
    const groupB = addGroup(db, 1, 'Füchse')
    anna = addEmployee(db, 'Anna', { groupId: groupA })
    const berta = addEmployee(db, 'Berta', { groupId: groupB })
    const annaUser = addUser(db, 'anna', 'observer', anna).id
    leitung = asChildViewer(addUser(db, 'leitung', 'admin'))
    const tablet = {
      visibility: { waitlist: false, futureContracts: false }, onTablet: true, groups: { own: groupA, readable: [] },
      role: 'observer' as const, permissions: permissionsOf('observer'), facilityId: 1,
    }
    annaTablet = { id: annaUser, employeeId: anna, name: 'Anna', ...tablet }
    bertaTablet = { id: null, employeeId: berta, name: 'Berta', ...tablet, groups: { own: groupB, readable: [groupA] } }
    kid = addChild(db, 1, { firstName: 'Lena', groupId: groupA, keyEducatorId: anna })
    hiddenKid = addChild(db, 1, { firstName: 'Ida', groupId: groupB, keyEducatorId: anna })
    // The starter, with a rating section added (it has none of its own).
    const starter = db.select().from(formTemplates)
      .where(and(eq(formTemplates.facilityId, 1), eq(formTemplates.starterKey, 'child_development'))).get()!
    template = starter.id
    const content = JSON.parse(starter.content) as FormContent
    content.sections.push({ id: 'sr', title: 'Sozialverhalten', hint: '', items: [{ id: 'r1', kind: 'rating', criterion: 'Teilt mit anderen' }] })
    db.update(formTemplates).set({ content: JSON.stringify(content) }).where(eq(formTemplates.id, template)).run()
  })

  it('writes a revision on every save that changes answers, none when only the header or nothing changed', () => {
    const formId = createChildForm(db, leitung, kid, { templateId: template, ...header }, NOW)
    const text = itemOf(formId, 'text')
    const choice = itemOf(formId, 'choices')
    // The untouched form saved with every empty answer (as the panel sends it): no revision.
    const empty = Object.fromEntries(items(formId).filter(item => item.kind === 'text').map(item => [item.id, '']))
    save(leitung, formId, empty, at(9))
    expect(revisionRows(formId)).toEqual([])

    save(annaTablet, formId, { [text.id]: '<p>Baut gern</p>', [choice.id]: [choice.options[0]!.id] }, at(10))
    // The changed items in the form's order.
    const changed = items(formId).filter(item => item.id === text.id || item.id === choice.id).map(item => item.id)
    expect(revisionRows(formId)).toEqual([expect.objectContaining({
      savedAt: at(10).toISOString(), savedBy: 'Anna', initial: false, changedItemIds: JSON.stringify(changed),
      answers: JSON.stringify({ [text.id]: '<p>Baut gern</p>', [choice.id]: [choice.options[0]!.id] }),
    })])
    // Same answers again, only the header changes: still one revision.
    saveChildForm(db, leitung, formId, {
      ...header, participants: 'Vater', answers: { [text.id]: 'Baut gern', [choice.id]: [choice.options[0]!.id] },
      expectedUpdatedAt: at(10).toISOString(),
    }, at(11))
    expect(revisionRows(formId)).toHaveLength(1)
    // A refused save (409) writes nothing.
    expect(failure(() => saveChildForm(db, leitung, formId, { ...header, answers: { [text.id]: 'anders' }, expectedUpdatedAt: 'alt' }, at(12))))
      .toBe('409 form_changed')
    expect(revisionRows(formId)).toHaveLength(1)
  })

  it('shows per item the last change, and the items changed since the viewer last opened the form', () => {
    const formId = createChildForm(db, leitung, kid, { templateId: template, ...header }, NOW)
    const text = itemOf(formId, 'text')
    const rating = itemOf(formId, 'rating')
    const milestone = itemOf(formId, 'milestone')
    expect(getChildForm(db, leitung, formId, NOW)).toMatchObject({ itemChanges: {}, changedSinceSeen: [] })

    save(annaTablet, formId, { [text.id]: 'Baut gern', [rating.id]: { value: '~', remark: '' } }, at(9))
    // Leitung never opened it: nothing is marked, the info lines are there.
    expect(getChildForm(db, leitung, formId, at(9))).toMatchObject({
      itemChanges: {
        [text.id]: { changedAt: at(9).toISOString(), changedBy: 'Anna' },
        [rating.id]: { changedAt: at(9).toISOString(), changedBy: 'Anna' },
      },
      changedSinceSeen: [],
    })
    markChildFormOpened(db, leitung, formId, at(10).toISOString(), at(10))
    save(annaTablet, formId, {
      [text.id]: 'Baut gern', [rating.id]: { value: '+', remark: '' }, [milestone.id]: { reached: true, remark: '' },
    }, at(11))
    const seen = getChildForm(db, leitung, formId, at(11))
    expect(seen.itemChanges[rating.id]).toEqual({ changedAt: at(11).toISOString(), changedBy: 'Anna' })
    expect(seen.itemChanges[text.id]).toEqual({ changedAt: at(9).toISOString(), changedBy: 'Anna' })
    expect(seen.changedSinceSeen.sort()).toEqual([rating.id, milestone.id].sort())
    // The saver has seen her own save; the opening is recorded per person (at the tablet: the unlocking employee).
    expect(getChildForm(db, annaTablet, formId, at(11)).changedSinceSeen).toEqual([])
    expect(db.select({ userId: formReads.userId, employeeId: formReads.employeeId }).from(formReads).all())
      .toEqual(expect.arrayContaining([{ userId: leitung.id, employeeId: null }, { userId: null, employeeId: anna }]))
    markChildFormOpened(db, leitung, formId, at(12).toISOString(), at(12))
    expect(getChildForm(db, leitung, formId, at(12)).changedSinceSeen).toEqual([])
    // An earlier opening never moves the time back.
    markChildFormOpened(db, leitung, formId, at(8).toISOString(), at(8))
    expect(getChildForm(db, leitung, formId, at(12)).changedSinceSeen).toEqual([])
  })

  it('records the opening up to the state the viewer loaded, not the time the opening arrived', () => {
    const formId = createChildForm(db, leitung, kid, { templateId: template, ...header }, NOW)
    const text = itemOf(formId, 'text')
    const rating = itemOf(formId, 'rating')
    save(annaTablet, formId, { [text.id]: 'a' }, at(9))
    markChildFormOpened(db, leitung, formId, at(9).toISOString(), at(9))
    // Leitung loads the form (state of 10:00) …
    save(annaTablet, formId, { [text.id]: 'b' }, at(10))
    const loaded = getChildForm(db, leitung, formId, at(10))
    expect(loaded.changedSinceSeen).toEqual([text.id])
    // … Anna saves again before the opening arrives at 12:00: that change was never seen and stays marked.
    save(annaTablet, formId, { [text.id]: 'b', [rating.id]: { value: '+', remark: '' } }, at(11))
    markChildFormOpened(db, leitung, formId, loaded.updatedAt, at(12))
    expect(getChildForm(db, leitung, formId, at(12)).changedSinceSeen).toEqual([rating.id])
    // A state from the future counts as now.
    markChildFormOpened(db, leitung, formId, '2099-01-01T00:00:00.000Z', at(13))
    expect(db.select({ openedAt: formReads.openedAt }).from(formReads).where(eq(formReads.userId, leitung.id!)).get())
      .toEqual({ openedAt: at(13).toISOString() })
  })

  it('lists the revisions newest first, paged, and opens one; the diff against today shows what changed', () => {
    const formId = createChildForm(db, leitung, kid, { templateId: template, ...header }, NOW)
    const text = itemOf(formId, 'text')
    const rating = itemOf(formId, 'rating')
    for (let hour = 1; hour <= REVISION_PAGE_SIZE + 2; hour++) {
      save(annaTablet, formId, { [text.id]: `<p>Stand ${hour}</p>`, [rating.id]: { value: hour % 2 ? '-' : '+', remark: '' } },
        new Date(NOW.getTime() + hour * 60_000))
    }
    const first = listChildFormRevisions(db, leitung, formId, 0, NOW)
    expect(first).toMatchObject({ total: REVISION_PAGE_SIZE + 2, offset: 0, pageSize: REVISION_PAGE_SIZE })
    expect(first.revisions).toHaveLength(REVISION_PAGE_SIZE)
    expect(first.revisions[0]).toMatchObject({ savedBy: 'Anna', changedCount: 2, initial: false })
    expect(first.revisions[0]!.savedAt > first.revisions[1]!.savedAt).toBe(true)
    const second = listChildFormRevisions(db, leitung, formId, REVISION_PAGE_SIZE, NOW)
    expect(second.revisions.map(revision => revision.changedCount)).toEqual([2, 2])

    const oldest = second.revisions.at(-1)!
    const revision = getChildFormRevision(db, leitung, formId, oldest.id, NOW)
    expect(revision).toMatchObject({ id: oldest.id, answers: { [text.id]: '<p>Stand 1</p>' }, changedItemIds: [text.id, rating.id] })
    const current = getChildForm(db, leitung, formId, NOW)
    expect(formDiff(current.content, revision.answers, current.answers)).toEqual({
      [text.id]: { status: 'changed', detail: { kind: 'text', segments: [{ op: 'same', text: 'Stand ' }, { op: 'del', text: '1' }, { op: 'add', text: '22' }] } },
      [rating.id]: { status: 'changed', detail: { kind: 'rating', from: '-', to: '+', remarkFrom: '', remarkTo: '' } },
    })
    // A revision of another form is not found here.
    const other = createChildForm(db, leitung, kid, { templateId: template, ...header }, NOW)
    expect(failure(() => getChildFormRevision(db, leitung, other, oldest.id, NOW))).toBe('404 form_revision_not_found')
  })

  it('whoever reads the form reads its history (another group\'s reader too); without access it is 404', () => {
    const formId = createChildForm(db, leitung, kid, { templateId: template, ...header }, NOW)
    const text = itemOf(formId, 'text')
    save(annaTablet, formId, { [text.id]: 'Baut gern' }, at(9))
    const [revision] = listChildFormRevisions(db, bertaTablet, formId, 0, NOW).revisions
    expect(getChildForm(db, bertaTablet, formId, NOW).right).toBe('read')
    expect(getChildFormRevision(db, bertaTablet, formId, revision!.id, NOW).answers).toEqual({ [text.id]: 'Baut gern' })
    markChildFormOpened(db, bertaTablet, formId, at(10).toISOString(), at(10))

    const hiddenForm = createChildForm(db, leitung, hiddenKid, { templateId: template, ...header }, NOW)
    save(leitung, hiddenForm, { [text.id]: 'geheim' }, at(9))
    const hiddenRevision = listChildFormRevisions(db, leitung, hiddenForm, 0, NOW).revisions[0]!.id
    expect(failure(() => listChildFormRevisions(db, annaTablet, hiddenForm, 0, NOW))).toBe('404 child_not_found')
    expect(failure(() => getChildFormRevision(db, annaTablet, hiddenForm, hiddenRevision, NOW))).toBe('404 child_not_found')
    expect(failure(() => markChildFormOpened(db, annaTablet, hiddenForm, NOW.toISOString(), NOW))).toBe('404 child_not_found')
    // Another facility's Leitung does not find the form at all.
    const other = asChildViewer(addUser(db, 'leitung2', 'admin', null, addFacility(db, 'Krippe')))
    expect(failure(() => listChildFormRevisions(db, other, formId, 0, NOW))).toBe('404 form_not_found')
  })

  it('compares two forms of the same template with trend arrows', () => {
    const older = createChildForm(db, leitung, kid, { templateId: template, ...header, date: '2026-03-01' }, NOW)
    const newer = createChildForm(db, leitung, kid, { templateId: template, ...header }, NOW)
    const rating = itemOf(newer, 'rating')
    const milestone = itemOf(newer, 'milestone')
    save(leitung, older, { [rating.id]: { value: '-', remark: '' } }, at(9))
    save(leitung, newer, { [rating.id]: { value: '+', remark: '' }, [milestone.id]: { reached: true, remark: '' } }, at(9))
    const rows = compareForms(getChildForm(db, leitung, newer, NOW), getChildForm(db, leitung, older, NOW)).flatMap(section => section.rows)
    expect(rows.find(row => row.id === rating.id)).toMatchObject({ trend: 'up', older: { value: '-' }, newer: { value: '+' } })
    expect(rows.find(row => row.id === milestone.id)).toMatchObject({ trend: 'up' })
    expect(rows.every(row => row.olderItem && row.newerItem)).toBe(true)
  })

  it('revisions and openings go with the form, the child, and openings with a move to another facility', () => {
    const formId = createChildForm(db, leitung, kid, { templateId: template, ...header }, NOW)
    const text = itemOf(formId, 'text')
    save(leitung, formId, { [text.id]: 'a' }, at(9))
    markChildFormOpened(db, annaTablet, formId, at(10).toISOString(), at(10))
    deleteChildForm(db, leitung, formId, NOW)
    expect(db.select().from(formRevisions).all()).toEqual([])
    expect(db.select().from(formReads).all()).toEqual([])

    const second = createChildForm(db, leitung, kid, { templateId: template, ...header }, NOW)
    save(leitung, second, { [text.id]: 'b' }, at(9))
    markChildFormOpened(db, annaTablet, second, at(10).toISOString(), at(10))
    moveChildToFacility(db, kid, addFacility(db, 'Krippe'), NOW)
    expect(db.select().from(formReads).all()).toEqual([])
    expect(revisionRows(second)).toHaveLength(1)

    db.update(children).set({ leftOn: '2010-01-01' }).where(eq(children.id, kid)).run()
    deleteChild(db, (db.select({ facilityId: children.facilityId }).from(children).where(eq(children.id, kid)).get()!).facilityId, kid)
    expect(db.select().from(formRevisions).all()).toEqual([])
  })
})
