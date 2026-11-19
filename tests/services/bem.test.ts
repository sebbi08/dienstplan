import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { bemProcesses, bemSteps, employeeHours, employees, entries, facilities, facilityContacts } from '../../server/db/schema'
import {
  addBemStep, answerBem, bemInvitation, clearBemNotes, bemReminders, completeBem, deleteBem, deleteBemStep, getBemSettings, getEmployeeBem,
  setBemSent, setBemSettings, startBem, updateBemStep, type BemScope,
} from '../../server/services/bem'
import { categoryHasData } from '../../server/services/employeeDeletion'
import { deleteLeftEmployee } from '../../server/services/employeeDeletion'
import { listReminders } from '../../server/services/reminders'
import { deleteRetentionItem, retentionOverview } from '../../server/services/retentionOverview'
import { setRetentionSettings } from '../../server/services/retentionSettings'
import { BEM_DEFAULT_INVITATION_TEXT } from '../../shared/domain/bem'
import { dateRange, weekday } from '../../shared/domain/dates'
import type { PermissionKey } from '../../shared/domain/permissions'
import { RETENTION_DEFAULTS } from '../../shared/domain/retention'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addUser, asChildViewer, codeId, createTestDb, errorCode, permissionsOf } from '../helpers/fixtures'

const TODAY = '2026-11-19'

let db: Db
let leitung: SessionUser
let traeger: SessionUser
let leaId: number
let anna: number
let ben: number
/** What the routes pass for the Leitung: the facility and her own employee. */
let scope: BemScope

/** „Krank“ (or another code) on every Monday to Friday from `from` to `to`. */
function enter(employeeId: number, from: string, to: string, key = 'sick') {
  for (const date of dateRange(from, to).filter(day => weekday(day) < 5)) {
    db.insert(entries).values({ employeeId, date, kind: 'code', absenceCodeId: codeId(db, key), updatedAt: '2026-11-01T00:00:00.000Z' }).run()
  }
}

/** 31 sick working days: 31.08.–09.10.2026 (6 weeks) and 12.10.2026. */
const sickOverSixWeeks = (employeeId: number) => {
  enter(employeeId, '2026-08-31', '2026-10-09')
  enter(employeeId, '2026-10-12', '2026-10-12')
}

const viewerOf = (user: SessionUser, extra: Partial<{ onTablet: boolean; permissions: ReadonlySet<PermissionKey> }> = {}) => ({
  facilityId: 1, permissions: user.permissions, onTablet: false, employeeId: user.employeeId, ...extra,
})
const remindedNames = (user: SessionUser, extra = {}) => bemReminders(db, viewerOf(user, extra), TODAY).map(item => item.name)

beforeEach(() => {
  db = createTestDb()
  leaId = addEmployee(db, 'Lea Leitung')
  leitung = addUser(db, 'leitung', 'admin', leaId)
  traeger = addUser(db, 'traeger', 'provider')
  anna = addEmployee(db, 'Anna Muster')
  ben = addEmployee(db, 'Ben Beispiel')
  scope = { facilityId: 1, ownEmployeeId: leaId }
})

describe('counting sick working days', () => {
  it('counts „Krank“ on working days of the last 12 months against 6 weeks of working days', () => {
    sickOverSixWeeks(anna)
    expect(getEmployeeBem(db, scope, anna, TODAY).sickDays).toEqual({
      days: 31, limit: 30, workdaysPerWeek: 5, from: '2025-11-20', to: TODAY, restartAfter: null,
    })
  })

  it('leaves out „Kind krank“', () => {
    enter(anna, '2026-08-31', '2026-10-30', 'child_sick')
    expect(getEmployeeBem(db, scope, anna, TODAY).sickDays.days).toBe(0)
  })

  it('takes the limit and the working days from the hours period valid today (part time)', () => {
    // Monday to Wednesday: 18 working days are the limit, Thursdays and Fridays are no sick working days.
    db.update(employeeHours).set({ workdays: 0b0000111 }).where(eq(employeeHours.employeeId, anna)).run()
    sickOverSixWeeks(anna)
    expect(getEmployeeBem(db, scope, anna, TODAY).sickDays).toMatchObject({ days: 19, limit: 18, workdaysPerWeek: 3 })
  })

  it('starts afresh after a declined or completed BEM', () => {
    sickOverSixWeeks(anna)
    const id = startBem(db, leitung, scope, anna)
    setBemSent(db, scope, id, '2026-10-01', TODAY)
    answerBem(db, scope, id, 'declined', '2026-10-09', TODAY)
    expect(getEmployeeBem(db, scope, anna, TODAY).sickDays).toMatchObject({ days: 1, from: '2026-10-10', restartAfter: '2026-10-09' })
  })
})

describe('the reminder „BEM anbieten“', () => {
  it('appears for an employee above the limit without a running BEM, and goes once one is started', () => {
    sickOverSixWeeks(anna)
    enter(ben, '2026-08-31', '2026-10-09')
    expect(bemReminders(db, viewerOf(leitung), TODAY)).toEqual([{
      kind: 'bem', date: TODAY, state: 'today', name: 'Anna Muster', childId: null, age: null, ownChild: false, canDone: false,
      time: null, meetingKind: null, count: 31, bem: { employeeId: anna, days: 31, limit: 30, stage: 'offer' },
    }])
    const id = startBem(db, leitung, scope, anna)
    expect(remindedNames(leitung)).toEqual([])
    // Declined: counting starts afresh after it, so the reminder stays away until the days are above the limit again.
    setBemSent(db, scope, id, '2026-10-01', TODAY)
    answerBem(db, scope, id, 'declined', '2026-10-12', TODAY)
    expect(remindedNames(leitung)).toEqual([])
  })

  it('is part of the box „Erinnerungen“ for Leitung and Träger', () => {
    sickOverSixWeeks(anna)
    expect(listReminders(db, asChildViewer(leitung), TODAY).filter(item => item.kind === 'bem').map(item => item.name)).toEqual(['Anna Muster'])
    expect(listReminders(db, asChildViewer(traeger), TODAY).filter(item => item.kind === 'bem').map(item => item.name)).toEqual(['Anna Muster'])
  })

  it('needs employees.sickness, never at the tablet, never about the viewer themselves', () => {
    sickOverSixWeeks(anna)
    sickOverSixWeeks(leaId)
    const annaUser = addUser(db, 'anna', 'observer', anna)
    expect(remindedNames(annaUser)).toEqual([])
    expect(remindedNames(leitung, { permissions: permissionsOf('group_lead') })).toEqual([])
    expect(remindedNames(leitung, { onTablet: true })).toEqual([])
    // The Leitung's own BEM is the Träger's.
    expect(remindedNames(leitung)).toEqual(['Anna Muster'])
    expect(remindedNames(traeger)).toEqual(['Lea Leitung', 'Anna Muster'])
  })

  it('leaves out employees who left', () => {
    sickOverSixWeeks(anna)
    db.update(employees).set({ leftOn: '2026-11-01' }).where(eq(employees.id, anna)).run()
    expect(remindedNames(leitung)).toEqual([])
  })

  it('follows up a waiting BEM: invitation not sent after 7 days, then the answer date passed', () => {
    const stages = (today: string) => bemReminders(db, viewerOf(leitung), today)
      .map(item => [item.name, item.bem?.stage, item.date, item.state])
    const id = startBem(db, leitung, scope, anna, new Date('2026-11-05T09:00:00Z'))
    expect(stages('2026-11-11')).toEqual([])
    expect(stages('2026-11-12')).toEqual([['Anna Muster', 'notSent', '2026-11-12', 'today']])
    expect(stages(TODAY)).toEqual([['Anna Muster', 'notSent', '2026-11-12', 'overdue']])
    setBemSent(db, scope, id, '2026-11-13', TODAY)
    // Answer asked by 27.11.: reminded from 28.11. on.
    expect(stages('2026-11-27')).toEqual([])
    expect(stages('2026-11-28')).toEqual([['Anna Muster', 'answerDue', '2026-11-28', 'today']])
    answerBem(db, scope, id, 'no_answer', '2026-11-27', '2026-11-28')
    expect(stages('2026-11-28')).toEqual([])
    // An accepted BEM is not waiting.
    const next = startBem(db, leitung, scope, anna, new Date('2026-11-01T09:00:00Z'))
    answerBem(db, scope, next, 'accepted', '2026-11-02', TODAY)
    expect(stages(TODAY)).toEqual([])
  })
})

describe('the BEM process', () => {
  it('runs from „BEM einleiten“ over the answer and the steps to „Abschließen“', () => {
    const id = startBem(db, leitung, scope, anna, new Date('2026-10-30T09:00:00Z'))
    expect(errorCode(() => startBem(db, leitung, scope, anna))).toBe('bem_open_exists')
    expect(getEmployeeBem(db, scope, anna, TODAY).open).toEqual({
      id, status: 'invited', createdOn: '2026-10-30', createdBy: 'Lea Leitung', invitedOn: null, answeredOn: null,
      completedOn: null, steps: [],
    })
    expect(errorCode(() => setBemSent(db, scope, id, '2026-11-20', TODAY))).toBe('bem_date_future')
    setBemSent(db, scope, id, '2026-11-02', TODAY)
    expect(errorCode(() => completeBem(db, scope, id, TODAY, TODAY))).toBe('bem_state_invalid')
    expect(errorCode(() => answerBem(db, scope, id, 'accepted', '2026-11-01', TODAY))).toBe('bem_date_order')
    answerBem(db, scope, id, 'accepted', '2026-11-05', TODAY)
    expect(errorCode(() => setBemSent(db, scope, id, '2026-11-03', TODAY))).toBe('bem_state_invalid')
    expect(errorCode(() => answerBem(db, scope, id, 'no_answer', '2026-11-06', TODAY))).toBe('bem_state_invalid')

    const meeting = addBemStep(db, scope, id, 'meeting', { date: '2026-11-10', participants: ' Lea Leitung, Betriebsarzt ', text: 'Erstgespräch', status: 'done' })
    const measure = addBemStep(db, scope, id, 'measure', { date: '2026-12-01', participants: 'x', text: 'Stehpult', status: null })
    addBemStep(db, scope, id, 'note', { date: '2026-11-12', participants: '', text: 'Rückruf vereinbart', status: null })
    expect(errorCode(() => addBemStep(db, scope, id, 'note', { date: TODAY, participants: '', text: '  ', status: null }))).toBe('bem_text_required')
    expect(errorCode(() => addBemStep(db, scope, id, 'meeting', { date: TODAY, participants: 'x'.repeat(301), text: '', status: null })))
      .toBe('bem_participants_too_long')
    updateBemStep(db, scope, measure, { date: '2026-12-01', participants: '', text: 'Stehpult', status: 'done' })
    expect(getEmployeeBem(db, scope, anna, TODAY).open!.steps).toEqual([
      { id: meeting, kind: 'meeting', date: '2026-11-10', participants: 'Lea Leitung, Betriebsarzt', text: 'Erstgespräch', status: null },
      expect.objectContaining({ kind: 'note', text: 'Rückruf vereinbart', status: null }),
      { id: measure, kind: 'measure', date: '2026-12-01', participants: '', text: 'Stehpult', status: 'done' },
    ])

    expect(errorCode(() => completeBem(db, scope, id, '2026-11-04', TODAY))).toBe('bem_date_order')
    completeBem(db, scope, id, '2026-11-18', TODAY)
    const bem = getEmployeeBem(db, scope, anna, TODAY)
    expect(bem.open).toBeNull()
    expect(bem.history).toEqual([expect.objectContaining({ id, status: 'completed', answeredOn: '2026-11-05', completedOn: '2026-11-18' })])
    // The history is read-only.
    expect(errorCode(() => addBemStep(db, scope, id, 'note', { date: TODAY, participants: '', text: 'Nachtrag', status: null }))).toBe('bem_closed')
    expect(errorCode(() => updateBemStep(db, scope, meeting, { date: TODAY, participants: '', text: '', status: null }))).toBe('bem_closed')
    expect(errorCode(() => deleteBemStep(db, scope, meeting))).toBe('bem_closed')
    expect(errorCode(() => deleteBem(db, scope, id))).toBe('bem_state_invalid')
    // A new one can start, and the earlier one stays in the history.
    const next = startBem(db, leitung, scope, anna)
    expect(getEmployeeBem(db, scope, anna, TODAY)).toMatchObject({ open: { id: next }, history: [{ id }] })
  })

  it('ends with „abgelehnt“ or „keine Antwort“, and with a withdrawn consent', () => {
    const declined = startBem(db, leitung, scope, anna)
    // Declined and no answer end the BEM and restart the counting: only after a documented offer.
    expect(errorCode(() => answerBem(db, scope, declined, 'declined', '2026-11-03', TODAY))).toBe('bem_not_sent')
    expect(errorCode(() => answerBem(db, scope, declined, 'no_answer', '2026-11-03', TODAY))).toBe('bem_not_sent')
    setBemSent(db, scope, declined, '2026-11-01', TODAY)
    answerBem(db, scope, declined, 'declined', '2026-11-03', TODAY)
    const silent = startBem(db, leitung, scope, anna)
    setBemSent(db, scope, silent, '2026-10-27', TODAY)
    // „Keine Antwort“ only from the day the answer was asked by (27.10. + 14 days).
    expect(errorCode(() => answerBem(db, scope, silent, 'no_answer', '2026-11-09', TODAY))).toBe('bem_answer_too_early')
    answerBem(db, scope, silent, 'no_answer', '2026-11-10', TODAY)
    // An oral acceptance before the letter is fine.
    const withdrawn = startBem(db, leitung, scope, anna)
    answerBem(db, scope, withdrawn, 'accepted', '2026-11-12', TODAY)
    expect(errorCode(() => answerBem(db, scope, withdrawn, 'declined', '2026-11-11', TODAY))).toBe('bem_date_order')
    answerBem(db, scope, withdrawn, 'declined', '2026-11-16', TODAY)
    const { open, history } = getEmployeeBem(db, scope, anna, TODAY)
    expect(open).toBeNull()
    expect(history.map(process => [process.id, process.status, process.answeredOn, process.completedOn])).toEqual([
      [withdrawn, 'declined', '2026-11-12', '2026-11-16'],
      [silent, 'no_answer', '2026-11-10', '2026-11-10'],
      [declined, 'declined', '2026-11-03', '2026-11-03'],
    ])
  })

  it('deletes a BEM started by mistake with its steps, only while nothing is answered', () => {
    const id = startBem(db, leitung, scope, anna)
    const step = addBemStep(db, scope, id, 'note', { date: TODAY, participants: '', text: 'Versehen', status: null })
    deleteBemStep(db, scope, step)
    addBemStep(db, scope, id, 'note', { date: TODAY, participants: '', text: 'Versehen', status: null })
    deleteBem(db, scope, id)
    expect(db.select().from(bemProcesses).all()).toEqual([])
    expect(db.select().from(bemSteps).all()).toEqual([])
    // Once the invitation is sent, the offer is the evidence: no deleting.
    const sent = startBem(db, leitung, scope, anna)
    setBemSent(db, scope, sent, '2026-11-16', TODAY)
    expect(errorCode(() => deleteBem(db, scope, sent))).toBe('bem_already_sent')
  })

  it('takes talks and measures only after „angenommen“; a note also before', () => {
    const id = startBem(db, leitung, scope, anna)
    const input = { date: TODAY, participants: '', text: 'Inhalt', status: null }
    expect(errorCode(() => addBemStep(db, scope, id, 'meeting', input))).toBe('bem_not_accepted')
    expect(errorCode(() => addBemStep(db, scope, id, 'measure', input))).toBe('bem_not_accepted')
    expect(errorCode(() => addBemStep(db, scope, id, 'note', input))).toBeNull()
    answerBem(db, scope, id, 'accepted', TODAY, TODAY)
    expect(errorCode(() => addBemStep(db, scope, id, 'meeting', input))).toBeNull()
  })

  it('clears the texts of talks and measures after a withdrawn consent, keeping dates and status', () => {
    const id = startBem(db, leitung, scope, anna)
    answerBem(db, scope, id, 'accepted', '2026-11-02', TODAY)
    const meeting = addBemStep(db, scope, id, 'meeting', { date: '2026-11-05', participants: 'Betriebsarzt', text: 'Rücken', status: null })
    const measure = addBemStep(db, scope, id, 'measure', { date: '2026-11-06', participants: '', text: 'Stehpult', status: 'done' })
    const note = addBemStep(db, scope, id, 'note', { date: '2026-11-07', participants: '', text: 'Termin verschoben', status: null })
    expect(errorCode(() => clearBemNotes(db, scope, id))).toBe('bem_state_invalid')
    answerBem(db, scope, id, 'declined', '2026-11-10', TODAY)
    expect(clearBemNotes(db, scope, id)).toBe(2)
    expect(clearBemNotes(db, scope, id)).toBe(0)
    const [process] = getEmployeeBem(db, scope, anna, TODAY).history
    expect(process).toMatchObject({ status: 'declined', answeredOn: '2026-11-02', completedOn: '2026-11-10' })
    expect(process!.steps).toEqual([
      { id: meeting, kind: 'meeting', date: '2026-11-05', participants: '', text: '', status: null },
      { id: measure, kind: 'measure', date: '2026-11-06', participants: '', text: '', status: 'done' },
      { id: note, kind: 'note', date: '2026-11-07', participants: '', text: 'Termin verschoben', status: null },
    ])
    const hort = addFacility(db, 'Hort')
    expect(errorCode(() => clearBemNotes(db, { facilityId: hort, ownEmployeeId: null }, id))).toBe('bem_not_found')
  })
})

describe('who may', () => {
  it('refuses the viewer\'s own BEM (a Leitung\'s is run by the Träger)', () => {
    expect(errorCode(() => getEmployeeBem(db, scope, leaId, TODAY))).toBe('bem_own')
    expect(errorCode(() => startBem(db, leitung, scope, leaId))).toBe('bem_own')
    const id = startBem(db, traeger, { facilityId: 1, ownEmployeeId: null }, leaId)
    expect(errorCode(() => setBemSent(db, scope, id, TODAY, TODAY))).toBe('bem_not_found')
    expect(errorCode(() => bemInvitation(db, leitung, scope, id, TODAY))).toBe('bem_not_found')
    expect(getEmployeeBem(db, { facilityId: 1, ownEmployeeId: null }, leaId, TODAY).open?.id).toBe(id)
  })

  it('answers 404 for another facility\'s employee, process and step', () => {
    const hort = addFacility(db, 'Hort')
    const otto = addEmployee(db, 'Otto Hort', { facilityId: hort })
    const ottoScope = { facilityId: hort, ownEmployeeId: null }
    const id = startBem(db, traeger, ottoScope, otto)
    const step = addBemStep(db, ottoScope, id, 'note', { date: TODAY, participants: '', text: 'Hort', status: null })
    expect(errorCode(() => getEmployeeBem(db, scope, otto, TODAY))).toBe('employee_not_found')
    expect(errorCode(() => startBem(db, leitung, scope, otto))).toBe('employee_not_found')
    expect(errorCode(() => answerBem(db, scope, id, 'accepted', TODAY, TODAY))).toBe('bem_not_found')
    expect(errorCode(() => deleteBem(db, scope, id))).toBe('bem_not_found')
    expect(errorCode(() => bemInvitation(db, leitung, scope, id, TODAY))).toBe('bem_not_found')
    expect(errorCode(() => updateBemStep(db, scope, step, { date: TODAY, participants: '', text: 'x', status: null }))).toBe('bem_step_not_found')
    expect(errorCode(() => deleteBemStep(db, scope, step))).toBe('bem_step_not_found')
  })
})

describe('the invitation', () => {
  beforeEach(() => {
    db.update(employees).set({ street: 'Lindenweg 3', postalCode: '69115', city: 'Heidelberg' }).where(eq(employees.id, anna)).run()
  })

  it('carries the letterhead, the employee\'s address, the date and the answer date (+14 days) in the text', () => {
    db.update(facilities).set({ operatorName: 'Gemeinde Musterstadt', managerName: 'Maria Leitner', street: 'Kitaweg 1', postalCode: '69117', city: 'Heidelberg' })
      .where(eq(facilities.id, 1)).run()
    db.insert(facilityContacts).values([
      { facilityId: 1, kind: 'phone', value: '06221 100', belongsTo: 'facility', sortOrder: 0 },
      { facilityId: 1, kind: 'phone', value: '0171 200', belongsTo: 'leitung', sortOrder: 1 },
    ]).run()
    const id = startBem(db, leitung, scope, anna)
    const invitation = bemInvitation(db, leitung, scope, id, TODAY)
    expect(invitation).toMatchObject({
      facility: { name: 'Kindergarten', operator: 'Gemeinde Musterstadt', street: 'Kitaweg 1', postalCode: '69117', city: 'Heidelberg', phone: '06221 100' },
      contact: { name: 'Maria Leitner', phone: '0171 200' },
      employee: { name: 'Anna Muster', street: 'Lindenweg 3', postalCode: '69115', city: 'Heidelberg' },
      date: TODAY, answerBy: '2026-12-03',
    })
    expect(invitation.text).toContain('Guten Tag Anna Muster,')
    expect(invitation.text).toContain('bis zum 03.12.2026')
    expect(invitation.text).toContain('3 Jahre nach Abschluss')
    // Once sent, the letter keeps its date.
    setBemSent(db, scope, id, '2026-11-16', TODAY)
    expect(bemInvitation(db, leitung, scope, id, TODAY)).toMatchObject({ date: '2026-11-16', answerBy: '2026-11-30' })
  })

  it('names whoever prints as the contact person while Kontakt has no Leitung', () => {
    const id = startBem(db, leitung, scope, anna)
    expect(bemInvitation(db, leitung, scope, id, TODAY)).toMatchObject({
      facility: { operator: '', phone: '' }, contact: { name: 'Lea Leitung', phone: '' },
    })
  })

  it('leaves the address blank without the right to read personal data', () => {
    const id = startBem(db, leitung, scope, anna)
    const permissions = new Set([...leitung.permissions].filter(key => key !== 'employees.personal'))
    expect(bemInvitation(db, { ...leitung, permissions }, scope, id, TODAY).employee).toEqual({ name: 'Anna Muster', street: '', postalCode: '', city: '' })
  })

  it('uses the facility\'s own text and the BEM years of the retention settings', () => {
    expect(getBemSettings(db, 1)).toEqual({ text: BEM_DEFAULT_INVITATION_TEXT, isDefaultText: true })
    expect(setBemSettings(db, 1, { text: ' Hallo ‹Name›, Antwort bis ‹Antwort bis›, Löschung nach ‹Jahre› Jahren. ' }))
      .toEqual({ text: 'Hallo ‹Name›, Antwort bis ‹Antwort bis›, Löschung nach ‹Jahre› Jahren.', isDefaultText: false })
    setRetentionSettings(db, 1, { ...RETENTION_DEFAULTS, bemYears: 5 })
    const id = startBem(db, leitung, scope, anna)
    expect(bemInvitation(db, leitung, scope, id, TODAY).text).toBe('Hallo Anna Muster, Antwort bis 03.12.2026, Löschung nach 5 Jahren.')
    expect(setBemSettings(db, 1, { text: '' })).toEqual({ text: BEM_DEFAULT_INVITATION_TEXT, isDefaultText: true })
    expect(errorCode(() => setBemSettings(db, 1, { text: 'x'.repeat(6001) }))).toBe('bem_text_too_long')
  })
})

describe('retention „BEM-Unterlagen“', () => {
  const bemItems = (today: string) => retentionOverview(db, today).filter(item => item.category === 'bem')

  it('lists an ended BEM of an employee still there from 3 years after its end; deleting it keeps the running one', () => {
    const done = startBem(db, leitung, scope, anna)
    setBemSent(db, scope, done, '2026-11-02', TODAY)
    answerBem(db, scope, done, 'declined', '2026-11-03', TODAY)
    const running = startBem(db, leitung, scope, anna)
    expect(bemItems(TODAY)).toEqual([{
      key: `employee:${anna}:bem`, kind: 'employee', category: 'bem', facilityId: 1, facilityName: 'Kindergarten', name: 'Anna Muster',
      deletableFrom: '2029-11-03', bem: { endedOn: '2026-11-03', employed: true }, due: false,
    }])
    expect(errorCode(() => deleteRetentionItem(db, traeger, `employee:${anna}:bem`, TODAY))).toBe('retention_not_due')
    expect(bemItems('2029-11-03')).toMatchObject([{ due: true }])
    expect(deleteRetentionItem(db, traeger, `employee:${anna}:bem`, '2029-11-03')).toBe(1)
    expect(db.select({ id: bemProcesses.id }).from(bemProcesses).all()).toEqual([{ id: running }])
    expect(bemItems('2029-11-03')).toEqual([])
  })

  it('follows the BEM years of the facility', () => {
    const done = startBem(db, leitung, scope, anna)
    setBemSent(db, scope, done, '2026-10-20', TODAY)
    answerBem(db, scope, done, 'no_answer', '2026-11-03', TODAY)
    setRetentionSettings(db, 1, { ...RETENTION_DEFAULTS, bemYears: 1 })
    expect(bemItems(TODAY)).toMatchObject([{ deletableFrom: '2027-11-03' }])
  })

  it('counts a running BEM of someone who left from the leaving day; the record waits for it', () => {
    startBem(db, leitung, scope, anna)
    db.update(employees).set({ leftOn: '2026-11-10' }).where(eq(employees.id, anna)).run()
    expect(categoryHasData(db, anna).bem).toBe(true)
    const items = retentionOverview(db, TODAY).filter(item => item.name === 'Anna Muster')
    expect(items.find(item => item.category === 'bem')).toMatchObject({ deletableFrom: '2029-11-10', bem: { endedOn: '2026-11-10', employed: false }, due: false })
    expect(items.find(item => item.category === 'record')).toMatchObject({ due: false })
  })

  it('goes with „Endgültig löschen“', () => {
    const id = startBem(db, leitung, scope, anna)
    addBemStep(db, scope, id, 'note', { date: TODAY, participants: '', text: 'Notiz', status: null })
    db.update(employees).set({ leftOn: '2026-11-10' }).where(eq(employees.id, anna)).run()
    deleteLeftEmployee(db, leitung, 1, anna, 'Anna Muster', TODAY)
    expect(db.select().from(bemProcesses).all()).toEqual([])
    expect(db.select().from(bemSteps).all()).toEqual([])
  })
})
