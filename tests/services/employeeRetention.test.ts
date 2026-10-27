import { and, eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import {
  balanceAdjustments, employees, forms, leavePlanners, releaseSnapshots, staffTalkForms, staffTalks, users, warningAcks,
} from '../../server/db/schema'
import { getActiveUser } from '../../server/services/auth'
import { runEmployeeRetention } from '../../server/services/employeeRetention'
import { setRetentionSettings } from '../../server/services/retentionSettings'
import { RETENTION_DEFAULTS } from '../../shared/domain/retention'
import type { SessionUser, SnapshotData } from '../../shared/types/api'
import { employeeColumns, employeeReferences, fillEmployeeData } from '../helpers/employeeData'
import { addEmployee, addFacility, addUser, createTestDb } from '../helpers/fixtures'

const LEFT_ON = '2026-03-15'

/** The columns referencing employees, by the category that clears them (spec Löschfristen §2). */
const IMMEDIATE = [
  'employee_hours.employee_id', 'employee_requirements.employee_id', 'leave_requests.employee_id', 'help_outs.employee_id',
  'notifications.employee_id', 'form_editors.employee_id', 'terminal_unlocks.employee_id', 'week_template_entries.employee_id',
  'children.key_educator_id', 'child_development_docs.done_by_employee_id', 'child_parent_meetings.created_by_employee_id',
  'child_attendance_changes.changed_by_employee_id', 'group_book_changes.changed_by_employee_id', 'users.employee_id',
]
const TIME = [
  'entries.employee_id', 'change_log.employee_id', 'time_records.employee_id', 'time_record_changes.employee_id',
  'time_day_notes.employee_id', 'early_sick_leaves.employee_id', 'leave_entitlements.employee_id',
]
const ASSESSMENT = ['staff_talks.employee_id', 'employee_trainings.employee_id']
/** Normal adjustments go with the time data, paid-out ones with the paid overtime. */
const ADJUSTMENTS = 'balance_adjustments.employee_id'

const ZERO = { immediate: 0, time: 0, assessment: 0, paidOvertime: 0, employees: 0 }

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
const silent = { info: () => {}, error: () => {} }
const run = (today: string) => runEmployeeRetention(db, today, silent)

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

describe('the nightly deletion of left employees', () => {
  it('seeds every column that references employees, and each one belongs to a category', () => {
    const columns = employeeColumns(db).map(({ table, column }) => `${table}.${column}`).sort()
    expect(columns).toEqual([...IMMEDIATE, ...TIME, ...ASSESSMENT, ADJUSTMENTS].sort())
    expect(nonZero(columns)).toEqual(columns)
    expect(adjustments(tina, true)).toBe(1)
    expect(adjustments(tina, false)).toBe(1)
  })

  it('deletes each category on its day with the defaults, the employee row last (left on 15.03.2026)', () => {
    // Still the leaving day: nothing.
    expect(run('2026-03-15')).toEqual(ZERO)
    expect(nonZero(IMMEDIATE)).toEqual(IMMEDIATE)
    expect(row(tina)!.birthday).toBe('04-12')

    // The day after: the immediate data.
    const immediate = run('2026-03-16')
    expect(immediate).toMatchObject({ time: 0, assessment: 0, paidOvertime: 0, employees: 0 })
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
    expectBenUntouched()
    // A second run the same day (and the next days) deletes nothing more.
    expect(run('2026-03-16')).toEqual(ZERO)
    expect(run('2027-06-01')).toEqual(ZERO)

    // Time data: still there on 31.12.2028, gone on 01.01.2029; paid-out adjustments stay.
    expect(run('2028-12-31')).toEqual(ZERO)
    expect(nonZero(TIME)).toEqual(TIME)
    const time = run('2029-01-01')
    expect(time).toMatchObject({ immediate: 0, assessment: 0, paidOvertime: 0, employees: 0 })
    expect(time.time).toBeGreaterThan(0)
    expect(nonZero(TIME)).toEqual([])
    expect(adjustments(tina, false)).toBe(0)
    expect(adjustments(tina, true)).toBe(1)
    expect(inSnapshots(tina)).toBe(false)
    expect(warningAcksOf(tina)).toBe(0)
    expect(warningAcksOf(ben)).toBe(1)
    expect(nonZero(ASSESSMENT)).toEqual(ASSESSMENT)
    expectBenUntouched()
    expect(run('2029-01-01')).toEqual(ZERO)

    // Staff talks with their forms and the trainings: still there on 31.12.2029, gone on 01.01.2030.
    expect(run('2029-12-31')).toEqual(ZERO)
    expect(talkForms(tina)).toBeGreaterThan(0)
    const formCount = db.select().from(forms).all().length
    const tinaForms = talkForms(tina)
    const assessment = run('2030-01-01')
    expect(assessment).toMatchObject({ immediate: 0, time: 0, paidOvertime: 0, employees: 0 })
    expect(assessment.assessment).toBeGreaterThan(0)
    expect(nonZero(ASSESSMENT)).toEqual([])
    expect(db.select().from(forms).all().length).toBe(formCount - tinaForms)
    expect(talkForms(ben)).toBe(tinaForms)
    expect(adjustments(tina, true)).toBe(1)
    expectBenUntouched()

    // The paid-out adjustment and then the employee row: still there on 31.12.2036, gone on 01.01.2037.
    expect(run('2036-12-31')).toEqual(ZERO)
    expect(adjustments(tina, true)).toBe(1)
    expect(row(tina)).toBeDefined()
    const last = run('2037-01-01')
    expect(last).toMatchObject({ immediate: 0, time: 0, assessment: 0, paidOvertime: 1, employees: 1 })
    expect(row(tina)).toBeUndefined()
    expect(Object.entries(refs(tina)).filter(([, n]) => n > 0)).toEqual([])
    expect(fkCheck()).toEqual([])
    expectBenUntouched()
    // Idempotent.
    expect(run('2037-01-01')).toEqual(ZERO)
    expect(run('2040-01-01')).toEqual(ZERO)
  })

  it('applies changed periods from the next run on, and restores nothing', () => {
    run('2026-03-16')
    expect(run('2028-06-01')).toEqual(ZERO)
    expect(nonZero(TIME)).toEqual(TIME)
    // One year for the time data: due on 01.01.2028, so this run deletes it.
    setRetentionSettings(db, 1, { ...RETENTION_DEFAULTS, timeYears: 1 })
    expect(run('2028-06-01').time).toBeGreaterThan(0)
    expect(nonZero(TIME)).toEqual([])
    expect(adjustments(tina, true)).toBe(1)
    // Back to two years: nothing comes back, nothing else goes.
    setRetentionSettings(db, 1, RETENTION_DEFAULTS)
    expect(run('2028-06-01')).toEqual(ZERO)
    expect(nonZero(TIME)).toEqual([])
    expect(nonZero(ASSESSMENT)).toEqual(ASSESSMENT)
    // A longer assessment period keeps the talks longer.
    setRetentionSettings(db, 1, { ...RETENTION_DEFAULTS, assessmentYears: 5 })
    expect(run('2030-01-01')).toEqual(ZERO)
    expect(nonZero(ASSESSMENT)).toEqual(ASSESSMENT)
    expect(run('2032-01-01').assessment).toBeGreaterThan(0)
    // With shorter paid-overtime period than the assessments, the row goes once the last category is due.
    setRetentionSettings(db, 1, { ...RETENTION_DEFAULTS, assessmentYears: 5, paidOvertimeYears: 4 })
    expect(run('2032-01-01')).toMatchObject({ paidOvertime: 1, employees: 1 })
    expect(row(tina)).toBeUndefined()
    expect(fkCheck()).toEqual([])
    expectBenUntouched()
  })

  it('stops deleting when the leaving is taken back or moved into the future', () => {
    run('2026-03-16')
    expect(nonZero(IMMEDIATE)).toEqual([])
    // Leaving taken back: nothing more goes, nothing comes back.
    db.update(employees).set({ leftOn: null }).where(eq(employees.id, tina)).run()
    for (const day of ['2029-01-01', '2030-01-01', '2037-01-01']) expect(run(day)).toEqual(ZERO)
    expect(nonZero(TIME)).toEqual(TIME)
    expect(nonZero(ASSESSMENT)).toEqual(ASSESSMENT)
    expect(adjustments(tina, true)).toBe(1)
    expect(row(tina)).toMatchObject({ name: 'Tina Test', birthday: null })
    // Moved into the future (seen from the run's day): not left yet.
    db.update(employees).set({ leftOn: '2037-06-30' }).where(eq(employees.id, tina)).run()
    expect(run('2037-01-01')).toEqual(ZERO)
    expect(run('2037-06-30')).toEqual(ZERO)
    expect(nonZero(TIME)).toEqual(TIME)
    expect(row(tina)).toBeDefined()
  })

  it('uses the settings of the employee\'s facility', () => {
    const hanna = addEmployee(db, 'Hanna Hort', { facilityId: hort, leftOn: LEFT_ON })
    db.insert(balanceAdjustments).values({ employeeId: hanna, date: '2026-01-01', minutes: 60, reason: 'Übertrag' }).run()
    setRetentionSettings(db, hort, { ...RETENTION_DEFAULTS, timeYears: 1 })
    run('2028-01-01')
    expect(adjustments(hanna, false)).toBe(0)
    expect(adjustments(tina, false)).toBe(1)
  })

  it('deletes a linked Leitung account and only unlinks a Träger account', () => {
    const lena = addEmployee(db, 'Lena Leitung', { leftOn: LEFT_ON })
    const lenaAccount = addUser(db, 'lena', 'admin', lena)
    const otto = addEmployee(db, 'Otto Träger', { leftOn: LEFT_ON })
    const provider = addUser(db, 'otto', 'provider', otto)
    run('2026-03-16')
    expect(getActiveUser(db, lenaAccount.id)).toBeNull()
    expect(db.select({ employeeId: users.employeeId, active: users.active }).from(users).where(eq(users.id, provider.id)).get())
      .toEqual({ employeeId: null, active: true })
    expect(getActiveUser(db, provider.id)).not.toBeNull()
    expect(getActiveUser(db, traeger.id)).not.toBeNull()
    expect(fkCheck()).toEqual([])
  })

  it('keeps the employee whose deletion would leave a reference behind, logs it without the name and goes on', () => {
    const errors: string[] = []
    const infoLog: string[] = []
    const log = { info: (...parts: unknown[]) => infoLog.push(parts.map(String).join(' ')), error: (...parts: unknown[]) => errors.push(parts.map(String).join(' ')) }
    db.run(sql.raw('CREATE TABLE extra_refs (id INTEGER PRIMARY KEY, employee_id INTEGER REFERENCES employees(id))'))
    db.run(sql.raw(`INSERT INTO extra_refs (employee_id) VALUES (${tina})`))
    const anna = addEmployee(db, 'Anna Alt', { leftOn: '2020-05-01' })
    const result = runEmployeeRetention(db, '2037-01-01', log)
    expect(result.employees).toBe(1)
    expect(row(anna)).toBeUndefined()
    // Tina's whole run of that day was rolled back: everything is still there.
    expect(row(tina)).toBeDefined()
    expect(nonZero(TIME)).toEqual(TIME)
    expect(nonZero(IMMEDIATE)).toEqual(IMMEDIATE)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain(String(tina))
    expect(errors.join(' ')).not.toContain('Tina')
    expect(infoLog.join(' ')).not.toMatch(/Tina|Anna/)
  })
})
