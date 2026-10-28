import { and, eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import {
  balanceAdjustments, employees, forms, leavePlanners, releaseSnapshots, staffTalkForms, staffTalks, users, warningAcks,
} from '../../server/db/schema'
import { getActiveUser } from '../../server/services/auth'
import { getBalanceOverview } from '../../server/services/balances'
import {
  deleteCategories, deleteEmployeeRow, hasPaidOut, type RetentionCategory,
} from '../../server/services/employeeDeletion'
import { getMonthPlan } from '../../server/services/plan'
import type { SessionUser, SnapshotData } from '../../shared/types/api'
import { employeeColumns, employeeReferences, fillEmployeeData } from '../helpers/employeeData'
import { addEmployee, addFacility, addUser, createTestDb } from '../helpers/fixtures'

const LEFT_ON = '2026-03-15'

/** The columns referencing employees, by the category that clears them (spec Löschfristen §2). */
const IMMEDIATE = [
  'employee_emergency_contacts.employee_id', 'employee_requirements.employee_id', 'leave_requests.employee_id', 'notifications.employee_id', 'form_editors.employee_id', 'terminal_unlocks.employee_id', 'week_template_entries.employee_id',
  'children.key_educator_id', 'child_development_docs.done_by_employee_id', 'child_parent_meetings.created_by_employee_id',
  'child_attendance_changes.changed_by_employee_id', 'group_book_changes.changed_by_employee_id', 'users.employee_id',
]
/** The weekly hours and help-outs too: without them the person is in no month's plan or Stundenkonto any more. */
const TIME = [
  'employee_hours.employee_id', 'help_outs.employee_id', 'entries.employee_id', 'change_log.employee_id', 'time_records.employee_id', 'time_record_changes.employee_id',
  'time_day_notes.employee_id', 'early_sick_leaves.employee_id', 'leave_entitlements.employee_id',
]
const ASSESSMENT = ['staff_talks.employee_id', 'employee_trainings.employee_id']
/** Normal adjustments go with the time data, paid-out ones with the paid overtime. */
const ADJUSTMENTS = 'balance_adjustments.employee_id'

const ZERO = { immediate: 0, time: 0, assessment: 0, paidOvertime: 0 }

let db: Db
let leitung: SessionUser
let traeger: SessionUser
let tina: number
let ben: number
let hort: number
let tinaAccount: SessionUser
let benAccount: SessionUser
let benBefore: Record<string, number>
let benRowBefore: unknown

const refs = (employeeId: number) => employeeReferences(db, employeeId)
const nonZero = (columns: string[], employeeId = tina) => {
  const all = refs(employeeId)
  return columns.filter(column => (all[column] ?? 0) > 0)
}
const adjustments = (employeeId: number, paidOut: boolean) => db.select().from(balanceAdjustments)
  .where(and(eq(balanceAdjustments.employeeId, employeeId), eq(balanceAdjustments.paidOut, paidOut))).all().length
const row = (employeeId: number) => db.select().from(employees).where(eq(employees.id, employeeId)).get()
const inSnapshots = (employeeId: number) => db.select({ data: releaseSnapshots.data }).from(releaseSnapshots).all().some((snapshot) => {
  const data = JSON.parse(snapshot.data) as SnapshotData
  return data.employees.some(employee => employee.id === employeeId) || data.entries.some(entry => entry.employeeId === employeeId)
})
const warningAcksOf = (employeeId: number) => db.select({ key: warningAcks.key }).from(warningAcks).all()
  .filter(ack => ack.key.endsWith(`|${employeeId}`)).length
const talkForms = (employeeId: number) => db.select({ id: staffTalkForms.formId }).from(staffTalkForms)
  .innerJoin(staffTalks, eq(staffTalks.id, staffTalkForms.talkId)).where(eq(staffTalks.employeeId, employeeId)).all().length
const fkCheck = () => db.all(sql`PRAGMA foreign_key_check`)
/** Deletes the categories of the employee in a transaction of their own; answers the changed rows per category. */
const remove = (categories: RetentionCategory[], employeeId = tina) =>
  db.transaction(tx => deleteCategories(tx, employeeId, categories))

/** Ben (active) still has everything, unchanged. */
function expectBenUntouched(): void {
  expect(refs(ben)).toEqual(benBefore)
  expect(row(ben)).toEqual(benRowBefore)
  expect(adjustments(ben, true)).toBe(1)
  expect(getActiveUser(db, benAccount.id)).not.toBeNull()
}

beforeEach(() => {
  db = createTestDb()
  leitung = addUser(db, 'leitung', 'admin', addEmployee(db, 'Lea Leitung'))
  traeger = addUser(db, 'traeger', 'provider')
  tina = addEmployee(db, 'Tina Test')
  ben = addEmployee(db, 'Ben Beispiel')
  hort = addFacility(db, 'Hort')
  // The data is entered while Tina still works there; she leaves afterwards.
  fillEmployeeData(db, leitung, [tina, ben], tina, hort)
  for (const id of [tina, ben]) {
    db.insert(balanceAdjustments).values({ employeeId: id, date: '2026-02-28', minutes: -600, reason: 'Ausgezahlt', paidOut: true }).run()
    db.update(employees).set({
      birthday: '04-12', qualification: 'fachkraft', staffingShare: 80, personnelNumber: `P-${id}`, employedSince: '2020-08-01',
      jobKey: 'educator', jobOther: 'Sprachkita', payGroup: 'S8a', payLevel: 3,
    }).where(eq(employees.id, id)).run()
  }
  tinaAccount = addUser(db, 'tina', 'observer', tina)
  benAccount = addUser(db, 'ben', 'observer', ben)
  db.insert(leavePlanners).values({ userId: tinaAccount.id }).run()
  db.update(employees).set({ leftOn: LEFT_ON }).where(eq(employees.id, tina)).run()
  benBefore = refs(ben)
  benRowBefore = row(ben)
})

describe('the deletion categories of a left employee', () => {
  it('seeds every column that references employees, and each one belongs to a category', () => {
    const columns = employeeColumns(db).map(({ table, column }) => `${table}.${column}`).sort()
    expect(columns).toEqual([...IMMEDIATE, ...TIME, ...ASSESSMENT, ADJUSTMENTS].sort())
    expect(nonZero(columns)).toEqual(columns)
    expect(adjustments(tina, true)).toBe(1)
    expect(adjustments(tina, false)).toBe(1)
  })

  it('deletes exactly the data of each category, and the employee row last', () => {
    // The immediate data.
    const immediate = remove(['immediate'])
    expect(immediate).toMatchObject({ time: 0, assessment: 0, paidOvertime: 0 })
    expect(immediate.immediate).toBeGreaterThan(0)
    expect(nonZero(IMMEDIATE)).toEqual([])
    expect(nonZero(TIME)).toEqual(TIME)
    expect(nonZero(ASSESSMENT)).toEqual(ASSESSMENT)
    expect(row(tina)).toMatchObject({
      name: 'Tina Test', leftOn: LEFT_ON, birthday: null, pinHash: null, pinFailed: 0, pinLockedUntil: null, pinLockLevel: 0,
      qualification: null, staffingShare: null, personnelNumber: null, employedSince: null, jobKey: null, jobOther: null,
      payGroup: null, payLevel: null,
    })
    // The Mitarbeiter account is gone; the child keeps the name in the logs, without the id.
    expect(getActiveUser(db, tinaAccount.id)).toBeNull()
    expect(db.select().from(users).where(eq(users.id, tinaAccount.id)).get()).toBeUndefined()
    expect(db.select().from(leavePlanners).all()).toEqual([])
    expect(inSnapshots(tina)).toBe(true)
    expect(warningAcksOf(tina)).toBe(1)
    // She is still in the plan and the Stundenkonto of her leaving month, and in the Hort's plan she helped out in.
    expect(getBalanceOverview(db, 1, 2026, 3, '2026-03-16').map(balance => balance.employeeId)).toContain(tina)
    expect(getMonthPlan(db, leitung, 1, 2026, 3, '2026-03-16').employees.map(employee => employee.id)).toContain(tina)
    expect(getMonthPlan(db, traeger, hort, 2026, 9, '2026-03-16').employees.map(employee => employee.id)).toContain(tina)
    expectBenUntouched()
    // Run again it changes nothing.
    expect(remove(['immediate'])).toEqual(ZERO)

    // The time data; the paid-out adjustments stay.
    const time = remove(['time'])
    expect(time).toMatchObject({ immediate: 0, assessment: 0, paidOvertime: 0 })
    expect(time.time).toBeGreaterThan(0)
    expect(nonZero(TIME)).toEqual([])
    expect(adjustments(tina, false)).toBe(0)
    expect(adjustments(tina, true)).toBe(1)
    expect(inSnapshots(tina)).toBe(false)
    expect(warningAcksOf(tina)).toBe(0)
    expect(warningAcksOf(ben)).toBe(1)
    expect(nonZero(ASSESSMENT)).toEqual(ASSESSMENT)
    expectBenUntouched()
    expect(remove(['time'])).toEqual(ZERO)

    // Staff talks with their forms and the trainings.
    expect(talkForms(tina)).toBeGreaterThan(0)
    const formCount = db.select().from(forms).all().length
    const tinaForms = talkForms(tina)
    const assessment = remove(['assessment'])
    expect(assessment).toMatchObject({ immediate: 0, time: 0, paidOvertime: 0 })
    expect(assessment.assessment).toBeGreaterThan(0)
    expect(nonZero(ASSESSMENT)).toEqual([])
    expect(db.select().from(forms).all().length).toBe(formCount - tinaForms)
    expect(talkForms(ben)).toBe(tinaForms)
    expect(adjustments(tina, true)).toBe(1)
    expectBenUntouched()

    // The paid-out adjustment, then the employee row.
    expect(hasPaidOut(db, tina)).toBe(true)
    expect(remove(['paidOvertime'])).toEqual({ ...ZERO, paidOvertime: 1 })
    expect(hasPaidOut(db, tina)).toBe(false)
    expect(row(tina)).toBeDefined()
    expect(db.transaction(tx => deleteEmployeeRow(tx, tina))).toBe(1)
    expect(row(tina)).toBeUndefined()
    expect(Object.entries(refs(tina)).filter(([, n]) => n > 0)).toEqual([])
    expect(fkCheck()).toEqual([])
    expectBenUntouched()
    expect(remove(['immediate', 'time', 'assessment', 'paidOvertime'])).toEqual(ZERO)
  })

  it('deletes a linked Leitung account and only unlinks a Träger account', () => {
    const lena = addEmployee(db, 'Lena Leitung', { leftOn: LEFT_ON })
    const lenaAccount = addUser(db, 'lena', 'admin', lena)
    const otto = addEmployee(db, 'Otto Träger', { leftOn: LEFT_ON })
    const provider = addUser(db, 'otto', 'provider', otto)
    remove(['immediate'], lena)
    remove(['immediate'], otto)
    expect(getActiveUser(db, lenaAccount.id)).toBeNull()
    expect(db.select({ employeeId: users.employeeId, active: users.active }).from(users).where(eq(users.id, provider.id)).get())
      .toEqual({ employeeId: null, active: true })
    expect(getActiveUser(db, provider.id)).not.toBeNull()
    expect(getActiveUser(db, traeger.id)).not.toBeNull()
    expect(fkCheck()).toEqual([])
  })

  it('tells whether the employee has paid-out adjustments', () => {
    const hanna = addEmployee(db, 'Hanna Hort', { facilityId: hort, leftOn: LEFT_ON })
    expect(hasPaidOut(db, hanna)).toBe(false)
    db.insert(balanceAdjustments).values({ employeeId: hanna, date: '2026-01-01', minutes: 60, reason: 'Übertrag' }).run()
    expect(hasPaidOut(db, hanna)).toBe(false)
    expect([hasPaidOut(db, tina), hasPaidOut(db, ben)]).toEqual([true, true])
  })
})
