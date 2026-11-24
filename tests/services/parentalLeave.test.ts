import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { closures, employeeChildren, employees, entries, leaveEntitlements, maternityCases, parentalLeaveBirths, parentalLeaves } from '../../server/db/schema'
import { categoryHasData, deleteCategories } from '../../server/services/employeeDeletion'
import { listEmployeeListExtras } from '../../server/services/employeeListExtras'
import { getLeaveAccount } from '../../server/services/leave'
import { getLeaveForfeitList, getMyLeaveForfeitNotice, markLeaveForfeitRead } from '../../server/services/leaveForfeit'
import { getStaffYearCalendar, getYearCalendar } from '../../server/services/calendar'
import {
  checkParentalLeavePeriod, createParentalLeave, deleteParentalLeave, getEmployeeParentalLeave, getParentalLeaveSettings,
  parentalLeavePlanCells, parentalLeaveReminders, setParentalLeaveSettings, updateParentalLeave,
} from '../../server/services/parentalLeave'
import { getMonthPlan, getMyPlan } from '../../server/services/plan'
import { releaseMonth } from '../../server/services/release'
import { loadEmployee, loadEmployees } from '../../server/services/queries'
import { listReminders } from '../../server/services/reminders'
import { computeDay } from '../../shared/domain/balance'
import type { ParentalLeaveInput, SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, asChildViewer, codeId, createTestDb, errorCode } from '../helpers/fixtures'

let db: Db
let traeger: SessionUser
let leitung: SessionUser
let anna: number

const TODAY = '2026-11-23'

const input = (values: Partial<ParentalLeaveInput> = {}): ParentalLeaveInput => ({
  childId: null, childBirthDate: '2026-11-16', start: '2027-01-12', end: '2028-01-11', partTimeWeeklyMinutes: null, reduceLeave: false,
  note: '', ...values,
})
const create = (values: Partial<ParentalLeaveInput> = {}, employeeId = anna) => createParentalLeave(db, traeger, 1, employeeId, input(values))
const info = () => loadEmployee(db, anna)!.info

beforeEach(() => {
  db = createTestDb()
  traeger = addUser(db, 'traeger', 'provider')
  const lea = addEmployee(db, 'Lea Leitung')
  leitung = addUser(db, 'leitung', 'admin', lea)
  anna = addEmployee(db, 'Anna Muster')
})

describe('entering an Elternzeit', () => {
  it('stores the period with the child\'s birth date and lists it with the first working day after', () => {
    const { id } = create({ note: '  Antrag vom 01.12.2026 ' })
    const section = getEmployeeParentalLeave(db, traeger, 1, anna, TODAY)
    // Tuesday 11.01.2028 → Wednesday 12.01.2028.
    expect(section.periods).toEqual([expect.objectContaining({
      id, childId: null, childBirthDate: '2026-11-16', start: '2027-01-12', end: '2028-01-11', partTimeWeeklyMinutes: null,
      reduceLeave: false, note: 'Antrag vom 01.12.2026', firstWorkingDay: '2028-01-12', createdBy: 'traeger',
    })])
    expect(section.canEdit).toBe(true)
    expect(getEmployeeParentalLeave(db, leitung, 1, anna, TODAY).canEdit).toBe(false)
  })

  it('copies the birth date of a chosen child and names it only for viewers of the personal data', () => {
    const child = db.insert(employeeChildren).values({ employeeId: anna, firstName: 'Mia', birthDate: '2026-10-01' }).returning().get()
    create({ childId: child.id, childBirthDate: '2026-11-16', start: '2026-12-01', end: '2027-05-31' })
    const row = db.select().from(parentalLeaves).get()!
    expect(row.childBirthDate).toBe('2026-10-01')
    expect(getEmployeeParentalLeave(db, traeger, 1, anna, TODAY)).toMatchObject({ children: [{ id: child.id, firstName: 'Mia' }], periods: [{ childName: 'Mia' }] })
    const noPersonal = { role: 'admin' as const, permissions: new Set(['employees.contractView'] as const) }
    expect(getEmployeeParentalLeave(db, noPersonal, 1, anna, TODAY)).toMatchObject({ children: [], periods: [{ childName: null, childBirthDate: '2026-10-01' }] })
    // Removing the child keeps the period and its birth date.
    db.delete(employeeChildren).run()
    expect(db.select().from(parentalLeaves).get()).toMatchObject({ childId: null, childBirthDate: '2026-10-01' })
    const other = addEmployee(db, 'Ben')
    const foreign = db.insert(employeeChildren).values({ employeeId: other, birthDate: '2026-01-01' }).returning().get()
    expect(errorCode(() => create({ childId: foreign.id }))).toBe('employee_child_not_found')
  })

  it('refuses invalid periods, part time over 32 hours and a long note; a fourth section is only a hint', () => {
    expect(errorCode(() => create({ end: '2027-01-11' }))).toBe('parental_leave_end_before_start')
    expect(errorCode(() => create({ start: '2026-11-15' }))).toBe('parental_leave_before_birth')
    expect(errorCode(() => create({ start: '2034-01-01', end: '2034-11-16' }))).toBe('parental_leave_after_eighth_birthday')
    expect(errorCode(() => create({ partTimeWeeklyMinutes: 1921 }))).toBe('parental_leave_part_time_invalid')
    expect(errorCode(() => create({ partTimeWeeklyMinutes: 0 }))).toBe('parental_leave_part_time_invalid')
    expect(errorCode(() => create({ note: 'x'.repeat(2001) }))).toBe('parental_leave_note_too_long')
    create({ partTimeWeeklyMinutes: 1920 })
    expect(errorCode(() => create({ start: '2028-01-11', end: '2028-02-11' }))).toBe('parental_leave_overlap')
    for (const year of [2029, 2030]) create({ start: `${year}-01-01`, end: `${year}-01-31` })
    const check = checkParentalLeavePeriod(db, traeger, 1, anna, input({ start: '2031-01-01', end: '2031-01-31' }), null)
    expect(check).toMatchObject({ error: null, hints: ['sections'], sections: 4 })
    expect(create({ start: '2031-01-01', end: '2031-01-31' }).id).toBeGreaterThan(0)
    expect(errorCode(() => create({}, 999))).toBe('employee_not_found')
  })

  it('changes and deletes a period of the facility only', () => {
    const { id } = create()
    updateParentalLeave(db, traeger, 1, id, input({ end: '2027-06-30', reduceLeave: true }))
    expect(db.select().from(parentalLeaves).get()).toMatchObject({ end: '2027-06-30', reduceLeave: true })
    // Its own old days are no overlap.
    updateParentalLeave(db, traeger, 1, id, input({ end: '2027-07-31' }))
    expect(errorCode(() => updateParentalLeave(db, traeger, 2, id, input()))).toBe('parental_leave_not_found')
    expect(errorCode(() => deleteParentalLeave(db, 2, id))).toBe('parental_leave_not_found')
    deleteParentalLeave(db, 1, id)
    expect(db.select().from(parentalLeaves).all()).toEqual([])
  })
})

describe('the dialog\'s check', () => {
  it('suggests the day after the Mutterschutz period of that birth, else the birth date', () => {
    expect(checkParentalLeavePeriod(db, traeger, 1, anna, input(), null).suggestedStart).toBe('2026-11-16')
    db.insert(maternityCases).values({
      employeeId: anna, notifiedOn: '2026-05-04', expectedBirth: '2026-11-20', actualBirth: '2026-11-16', createdAt: 'x', updatedAt: 'x',
    }).run()
    // Born 4 days early: 8 weeks after the birth plus the 4 days not taken before → last day 15.01.2027.
    expect(checkParentalLeavePeriod(db, traeger, 1, anna, input(), null).suggestedStart).toBe('2027-01-16')
  })

  it('lists the entries already planned in a full Elternzeit, none with part time', () => {
    db.insert(entries).values({ employeeId: anna, date: '2027-02-03', kind: 'code', absenceCodeId: codeId(db, 'vacation'), updatedAt: 'x' }).run()
    expect(checkParentalLeavePeriod(db, traeger, 1, anna, input(), null).entries).toEqual([{ date: '2027-02-03', label: 'Urlaub' }])
    expect(checkParentalLeavePeriod(db, traeger, 1, anna, input({ partTimeWeeklyMinutes: 600 }), null).entries).toEqual([])
    expect(create().entries).toEqual([{ date: '2027-02-03', label: 'Urlaub' }])
  })

  it('finds the first working day after weekends, holidays and closures, and after an adjoining Elternzeit', () => {
    // Friday 31.12.2027 → Monday 03.01.2028.
    expect(checkParentalLeavePeriod(db, traeger, 1, anna, input({ end: '2027-12-31' }), null).firstWorkingDay).toBe('2028-01-03')
    db.insert(closures).values({ facilityId: 1, startDate: '2028-01-03', endDate: '2028-01-05', label: 'Winter', mode: 'vacation' }).run()
    // 06.01. Heilige Drei Könige (BW) → Friday 07.01.2028.
    expect(checkParentalLeavePeriod(db, traeger, 1, anna, input({ end: '2027-12-31' }), null).firstWorkingDay).toBe('2028-01-07')
    create({ start: '2028-01-01', end: '2028-03-31' })
    expect(checkParentalLeavePeriod(db, traeger, 1, anna, input({ end: '2027-12-31' }), null).firstWorkingDay).toBe('2028-04-03')
  })
})

describe('target hours', () => {
  it('has no target in a full Elternzeit and the part-time hours with part time; before and after as usual', () => {
    create({ start: '2027-01-12', end: '2027-03-31' })
    create({ start: '2027-04-01', end: '2027-06-30', partTimeWeeklyMinutes: 1200 })
    expect(computeDay(info(), '2027-02-03', []).target).toBe(0)
    // A duty entered anyway counts in full: no minus hours, but plus hours.
    expect(computeDay(info(), '2027-04-07', []).target).toBe(240)
    expect(computeDay(info(), '2027-07-07', []).target).toBe(468)
    expect(computeDay(info(), '2027-01-11', []).target).toBe(468)
  })
})

describe('the plan', () => {
  it('marks the working days of a full Elternzeit „Elternzeit“ for employees.view, „abwesend“ for staff and the tablet', () => {
    create({ start: '2027-01-12', end: '2027-03-31' })
    create({ start: '2027-04-01', end: '2027-06-30', partTimeWeeklyMinutes: 1200 }, addEmployee(db, 'Ben Teilzeit'))
    const staff = loadEmployees(db, 1)
    const january = parentalLeavePlanCells(db, leitung, 1, staff, 2027, 1)
    expect(january.label).toBe('parental_leave')
    // 12.–29.01.2027 Monday to Friday: 14 days; no weekend.
    expect(january.cells.filter(cell => cell.startsWith(`${anna}|`))).toHaveLength(14)
    expect(january.cells).not.toContain(`${anna}|2027-01-16`)
    expect(january.cells).not.toContain(`${anna}|2027-01-11`)
    // Part time: the person works, no mark.
    expect(parentalLeavePlanCells(db, leitung, 1, staff, 2027, 4).cells).toEqual([])
    const tablet = addUser(db, 'tablet', 'terminal')
    const mitarbeiter = addUser(db, 'mia', 'observer', addEmployee(db, 'Mia'))
    expect(parentalLeavePlanCells(db, tablet, 1, staff, 2027, 1).label).toBe('absent')
    expect(parentalLeavePlanCells(db, mitarbeiter, 1, staff, 2027, 1).label).toBe('absent')
    expect(getParentalLeaveSettings(db, traeger, 1)).toEqual({ visibleToAll: false, canEdit: true })
    setParentalLeaveSettings(db, traeger, 1, true)
    expect(parentalLeavePlanCells(db, tablet, 1, staff, 2027, 1).label).toBe('parental_leave')
    expect(parentalLeavePlanCells(db, mitarbeiter, 1, staff, 2027, 1).label).toBe('parental_leave')
    expect(getMonthPlan(db, leitung, 1, 2027, 2, '2026-11-23').parentalLeave.cells).toContain(`${anna}|2027-02-01`)
  })
})

describe('the leave', () => {
  beforeEach(() => {
    db.insert(leaveEntitlements).values({ employeeId: anna, year: 2027, days: 30 }).run()
  })

  it('is cut by 1/12 per full calendar month only when declared (§ 17 Abs. 1 BEEG), shown in the account', () => {
    const { id } = create({ start: '2027-01-12', end: '2027-07-31' })
    expect(getLeaveAccount(db, anna, 2027, '2026-11-23')).toMatchObject({ account: { entitlement: 30 }, parentalLeaveCut: 0 })
    updateParentalLeave(db, traeger, 1, id, input({ start: '2027-01-12', end: '2027-07-31', reduceLeave: true }))
    // February to July: 6 months → 15 days left.
    expect(getLeaveAccount(db, anna, 2027, '2026-11-23')).toMatchObject({ account: { entitlement: 15, available: 15 }, parentalLeaveCut: 15 })
    // The year after carries the reduced rest over.
    expect(getLeaveAccount(db, anna, 2028, '2026-11-23').account.carriedOver).toBe(15)
  })

  it('keeps the remaining leave from lapsing while an Elternzeit protects it, and gives no notice then (§ 17 Abs. 2 BEEG)', () => {
    db.insert(leaveEntitlements).values({ employeeId: anna, year: 2026, days: 30 }).run()
    create({ start: '2027-02-01', end: '2028-01-31' })
    expect(getLeaveAccount(db, anna, 2026, '2026-11-23').parentalLeaveProtectedUntil).toBe('2029-12-31')
    expect(getLeaveForfeitList(db, 1, 2026, '2026-11-23').rows.map(row => row.employeeId)).not.toContain(anna)
    db.delete(parentalLeaves).run()
    expect(getLeaveAccount(db, anna, 2026, '2026-11-23').parentalLeaveProtectedUntil).toBeNull()
    expect(getLeaveForfeitList(db, 1, 2026, '2026-11-23').rows.map(row => row.employeeId)).toContain(anna)
  })
})

describe('the TVöD level step', () => {
  it('moves by the days of full Elternzeit, shown in „Nächste Stufe“ and on the employee page', () => {
    db.update(employees).set({ employedSince: '2024-01-01', payLevel: 2 }).where(eq(employees.id, anna)).run()
    // Level 3 after 3 years: 01.01.2027.
    const level = () => listEmployeeListExtras(db, 1, '2026-11-23', traeger.permissions).find(row => row.employeeId === anna)!.level
    expect(level()).toMatchObject({ level: 3, on: '2027-01-01', shiftDays: 0 })
    create({ start: '2026-11-16', end: '2026-12-15' })
    expect(level()).toMatchObject({ level: 3, on: '2027-01-31', shiftDays: 30 })
    expect(getEmployeeParentalLeave(db, traeger, 1, anna, TODAY).levelShift).toEqual({ level: 3, on: '2027-01-31', days: 30, hints: [] })
  })
})

describe('the reminder', () => {
  it('names the return from 4 weeks before the first working day, for whoever sees the contract data, never at the tablet', () => {
    create({ start: '2027-01-12', end: '2027-03-31' })
    // Back on Thursday 01.04.2027.
    const viewer = { facilityId: 1, permissions: traeger.permissions, onTablet: false }
    expect(parentalLeaveReminders(db, viewer, '2027-03-03')).toEqual([])
    expect(parentalLeaveReminders(db, viewer, '2027-03-04')).toEqual([expect.objectContaining({
      kind: 'parentalLeave', date: '2027-04-01', state: 'upcoming', name: 'Anna Muster', parentalLeave: { employeeId: anna, toPartTime: false },
    })])
    expect(parentalLeaveReminders(db, { ...viewer, onTablet: true }, '2027-03-04')).toEqual([])
    expect(parentalLeaveReminders(db, { ...viewer, permissions: leitung.permissions }, '2027-03-04')).toEqual([])
    expect(listReminders(db, asChildViewer(traeger), '2027-04-01').filter(item => item.kind === 'parentalLeave')).toHaveLength(1)
  })
})

describe('retention', () => {
  it('goes with the time data (target hours and leave follow it) and with the employee', () => {
    create()
    expect(categoryHasData(db, anna).time).toBe(true)
    deleteCategories(db, anna, ['immediate'])
    expect(db.select().from(parentalLeaves).all()).toHaveLength(1)
    deleteCategories(db, anna, ['time'])
    expect(db.select().from(parentalLeaves).all()).toEqual([])
  })
})

describe('fix round 1', () => {
  /** Whoever edits the contract data but has no health data right (possible on the rights page). */
  const contractOnly = () => ({ ...traeger, role: 'admin' as const, permissions: new Set(['employees.view', 'employees.contractView', 'employees.contractEdit'] as const) })

  it('lists health codes in the period as „abwesend“ without employees.sickness', () => {
    db.insert(entries).values({ employeeId: anna, date: '2027-02-03', kind: 'code', absenceCodeId: codeId(db, 'sick'), updatedAt: 'x' }).run()
    expect(checkParentalLeavePeriod(db, traeger, 1, anna, input(), null).entries).toEqual([{ date: '2027-02-03', label: 'Krank' }])
    expect(checkParentalLeavePeriod(db, contractOnly(), 1, anna, input(), null).entries).toEqual([{ date: '2027-02-03', label: 'abwesend' }])
    expect(createParentalLeave(db, contractOnly(), 1, anna, input()).entries).toEqual([{ date: '2027-02-03', label: 'abwesend' }])
  })

  it('reads the Mutterschutz for the suggested start only with employees.sickness', () => {
    db.insert(maternityCases).values({
      employeeId: anna, notifiedOn: '2026-05-04', expectedBirth: '2026-11-20', actualBirth: '2026-11-16', createdAt: 'x', updatedAt: 'x',
    }).run()
    expect(checkParentalLeavePeriod(db, traeger, 1, anna, input(), null).suggestedStart).toBe('2027-01-16')
    expect(checkParentalLeavePeriod(db, contractOnly(), 1, anna, input(), null).suggestedStart).toBe('2026-11-16')
  })

  it('stores the working days of part time (default: the contract\'s) and counts target and leave on them only', () => {
    const { id } = create({ start: '2027-04-01', end: '2027-06-30', partTimeWeeklyMinutes: 1200 })
    expect(db.select().from(parentalLeaves).get()).toMatchObject({ partTimeWorkdays: 0b0011111 })
    expect(getEmployeeParentalLeave(db, traeger, 1, anna, TODAY).contractWorkdays).toBe(0b0011111)
    updateParentalLeave(db, traeger, 1, id, input({ start: '2027-04-01', end: '2027-06-30', partTimeWeeklyMinutes: 1200, partTimeWorkdays: 0b0000111 }))
    expect(computeDay(info(), '2027-04-12', []).target).toBe(400)
    expect(computeDay(info(), '2027-04-15', []).target).toBe(0)
    // A week of leave Monday to Friday uses three leave days.
    db.insert(leaveEntitlements).values({ employeeId: anna, year: 2027, days: 30 }).run()
    for (const date of ['2027-04-12', '2027-04-13', '2027-04-14', '2027-04-15', '2027-04-16']) {
      db.insert(entries).values({ employeeId: anna, date, kind: 'code', absenceCodeId: codeId(db, 'vacation'), updatedAt: 'x' }).run()
    }
    expect(getLeaveAccount(db, anna, 2027, TODAY).account.planned).toBe(3)
    expect(errorCode(() => updateParentalLeave(db, traeger, 1, id, input({ partTimeWeeklyMinutes: 1200, partTimeWorkdays: 0 }))))
      .toBe('parental_leave_workdays_invalid')
    // Without part time no working days are stored.
    updateParentalLeave(db, traeger, 1, id, input({ partTimeWorkdays: 0b0000111 }))
    expect(db.select().from(parentalLeaves).get()).toMatchObject({ partTimeWorkdays: null })
  })

  it('moves the notice on remaining leave to the protected date: none before, the notice in the run-up (§ 17 Abs. 2 BEEG)', () => {
    db.insert(leaveEntitlements).values({ employeeId: anna, year: 2026, days: 30 }).run()
    const account = addUser(db, 'anna', 'observer', anna)
    create({ start: '2027-02-01', end: '2028-01-31' })
    expect(getMyLeaveForfeitNotice(db, account, '2027-02-15')).toBeNull()
    expect(getMyLeaveForfeitNotice(db, account, '2029-06-30')).toBeNull()
    // 2026, 2027 and 2028 share the date: one notice of 2028 with everything that lapses then (30 + 30 + 30 days).
    expect(getMyLeaveForfeitNotice(db, account, '2029-07-01')).toMatchObject({ year: 2028, days: 90, forfeitDate: '2029-12-31' })
    for (const year of [2026, 2027, 2028]) {
      expect(getLeaveForfeitList(db, 1, year, '2029-07-01').rows, String(year))
        .toEqual([expect.objectContaining({ employeeId: anna, days: 90, protectedUntil: '2029-12-31', status: 'open' })])
    }
  })

  it('shows the usual notice of the year after the return once the protected one is read, with the right days', () => {
    db.insert(leaveEntitlements).values({ employeeId: anna, year: 2026, days: 30 }).run()
    const account = addUser(db, 'anna', 'observer', anna)
    create({ start: '2027-02-01', end: '2028-01-31' })
    markLeaveForfeitRead(db, account, 2028, '2029-07-02')
    expect(getMyLeaveForfeitNotice(db, account, '2029-09-30')).toBeNull()
    // From 1 October both windows are open: the protected one is read, so the usual one of 2029 shows – its own 30 days,
    // not the 90 that lapse on 31.12.2029 already.
    expect(getMyLeaveForfeitNotice(db, account, '2029-10-01')).toMatchObject({ year: 2029, days: 30, forfeitDate: '2030-03-31' })
    expect(markLeaveForfeitRead(db, account, 2029, '2029-10-01').readAt).toBeTruthy()
    expect(getMyLeaveForfeitNotice(db, account, '2029-10-02')).toBeNull()
    // „Gelesen“ is taken for any open year; a year without an open notice is refused.
    expect(errorCode(() => markLeaveForfeitRead(db, account, 2027, '2029-10-02'))).toBe('leave_forfeit_no_notice')
    expect(getLeaveForfeitList(db, 1, 2026, '2029-10-02').rows).toEqual([expect.objectContaining({ employeeId: anna, status: 'read' })])
    expect(getLeaveForfeitList(db, 1, 2029, '2029-10-02').rows).toEqual([expect.objectContaining({ employeeId: anna, days: 30, status: 'read' })])
    // Before its window the protected leave is not listed, also with a receipt from before the Elternzeit was entered.
    expect(getLeaveForfeitList(db, 1, 2026, '2028-06-01').rows).toEqual([])
  })

  it('names the protected notice in the employee list beside the year it has to be taken in', () => {
    db.insert(leaveEntitlements).values({ employeeId: anna, year: 2026, days: 30 }).run()
    create({ start: '2027-02-01', end: '2028-01-31' })
    const forfeit = () => listEmployeeListExtras(db, 1, '2029-07-01', traeger.permissions).find(row => row.employeeId === anna)!.forfeit
    expect(forfeit()).toEqual({ year: 2028, status: 'no_account', readAt: null, protectedUntil: '2029-12-31' })
  })

  it('shows the own full Elternzeit in „Mein Dienstplan“, not a part-time one', () => {
    const account = addUser(db, 'anna', 'observer', anna)
    create({ start: '2027-01-12', end: '2027-01-20' })
    create({ start: '2027-01-21', end: '2027-03-31', partTimeWeeklyMinutes: 1200 })
    releaseMonth(db, leitung, 1, 2027, 1)
    const days = getMyPlan(db, account, 2027, 1, '2027-01-01').days
    expect(days.filter(day => day.parentalLeave).map(day => day.date))
      .toEqual(['2027-01-12', '2027-01-13', '2027-01-14', '2027-01-15', '2027-01-18', '2027-01-19', '2027-01-20'])
  })

  it('says „wechselt in Teilzeit-Elternzeit“ when a part-time section follows directly', () => {
    create({ start: '2027-01-12', end: '2027-03-31' })
    create({ start: '2027-04-01', end: '2027-06-30', partTimeWeeklyMinutes: 1200 })
    const viewer = { facilityId: 1, permissions: traeger.permissions, onTablet: false }
    expect(parentalLeaveReminders(db, viewer, '2027-03-20').map(item => [item.date, item.parentalLeave])).toEqual([
      ['2027-04-01', { employeeId: anna, toPartTime: true }],
    ])
    expect(parentalLeaveReminders(db, viewer, '2027-06-20').map(item => [item.date, item.parentalLeave])).toEqual([
      ['2027-07-01', { employeeId: anna, toPartTime: false }],
    ])
  })

  it('marks a full Elternzeit in the year calendar and the leave planning, „abwesend“ for other staff, never as a free day', () => {
    create({ start: '2027-01-12', end: '2027-03-31' })
    const calendar = getYearCalendar(db, 1, 2027)
    expect(calendar.days[anna]!['2027-02-01']).toBe('parental_leave')
    expect(calendar.days[anna]!['2027-02-06']).toBeUndefined()
    expect(calendar.freeDays[anna]).not.toContain('2027-02-01')
    const ben = addEmployee(db, 'Ben')
    expect(getStaffYearCalendar(db, 1, 2027, ben).days[anna]!['2027-02-01']).toBe('absent')
    expect(getStaffYearCalendar(db, 1, 2027, anna).days[anna]!['2027-02-01']).toBe('parental_leave')
    expect(getYearCalendar(db, 1, 2027, { parentalLeaveViewer: addUser(db, 'mia', 'observer', ben) }).days[anna]!['2027-02-01']).toBe('absent')
  })

  it('names more than five years of Elternzeit in a row on the moved level step', () => {
    db.update(employees).set({ employedSince: '2018-01-01', payLevel: 3 }).where(eq(employees.id, anna)).run()
    db.insert(parentalLeaves).values([
      { employeeId: anna, childBirthDate: '2019-12-01', start: '2020-01-01', end: '2022-12-31', createdAt: 'x', updatedAt: 'x' },
      { employeeId: anna, childBirthDate: '2022-12-01', start: '2023-01-01', end: '2025-06-30', createdAt: 'x', updatedAt: 'x' },
    ]).run()
    expect(getEmployeeParentalLeave(db, traeger, 1, anna, TODAY).levelShift).toMatchObject({ level: 4, hints: ['longBreak'] })
  })
})

describe('the Mutterschutz after the birth in the 36 months (§ 15 Abs. 2 BEEG)', () => {
  /** Whoever edits the contract data without the health data right. */
  const contractOnly = () => ({ ...traeger, role: 'admin' as const, permissions: new Set(['employees.view', 'employees.contractView', 'employees.contractEdit'] as const) })
  const addCase = () => db.insert(maternityCases).values({
    employeeId: anna, notifiedOn: '2026-05-04', expectedBirth: '2026-11-16', actualBirth: '2026-11-16', createdAt: 'x', updatedAt: 'x',
  }).run()
  const summary = (viewer: Parameters<typeof getEmployeeParentalLeave>[1] = traeger) => getEmployeeParentalLeave(db, viewer, 1, anna, TODAY).summaries

  it('sums the child\'s months without a Mutterschutz', () => {
    // 12 months from the birth: 365 of 1096 days.
    create({ start: '2026-11-16', end: '2027-11-15' })
    expect(summary()).toEqual([{
      childId: null, childName: null, childBirthDate: '2026-11-16', protection: null, protectionCounted: false, totalMonths: 36,
      protectionMonths: null, plannedMonths: 12, remainingMonths: 24, remainingExact: true,
    }])
    expect(summary(contractOnly())).toEqual(summary())
  })

  it('deducts the Mutterschutz of the case, with dates and months only for viewers of the health data', () => {
    addCase()
    // Born on the expected day: 8 weeks after it, 16.11.2026–11.01.2027 (57 days with the birth day).
    create({ start: '2027-01-12', end: '2028-01-11' })
    expect(summary()).toEqual([expect.objectContaining({
      protection: { from: '2026-11-16', to: '2027-01-11', source: 'case' }, protectionCounted: true,
      protectionMonths: 1.9, plannedMonths: 12, remainingMonths: 22.1, remainingExact: true,
    })])
    // Without employees.sickness: that one counts, the months entered, at most 36 minus them – no length to work out.
    const masked = summary(contractOnly())[0]!
    expect(masked).toEqual(expect.objectContaining({
      protection: null, protectionCounted: true, protectionMonths: null, plannedMonths: 12, remainingMonths: 24, remainingExact: false,
    }))
    expect(JSON.stringify(getEmployeeParentalLeave(db, contractOnly(), 1, anna, TODAY))).not.toContain('2027-01-11')
    const check = checkParentalLeavePeriod(db, contractOnly(), 1, anna, input({ start: '2028-01-12', end: '2028-03-31' }), null)
    expect(check).toMatchObject({ protection: null, remainingExact: false, remainingMonths: 24, suggestedStart: '2026-11-16' })
    expect(JSON.stringify(check)).not.toContain('2027-01-1')
  })

  it('takes a hand-entered end for a birth without a case, only from viewers of the health data', () => {
    const { id } = create({ start: '2027-01-12', end: '2028-01-11', protectionAfterBirthUntil: '2027-01-11' })
    expect(db.select().from(parentalLeaveBirths).all()).toEqual([expect.objectContaining({ employeeId: anna, childBirthDate: '2026-11-16', protectionUntil: '2027-01-11' })])
    expect(summary()[0]).toMatchObject({ protection: { from: '2026-11-16', to: '2027-01-11', source: 'manual' }, remainingMonths: 22.1 })
    // The suggested start follows it.
    expect(checkParentalLeavePeriod(db, traeger, 1, anna, input(), id).suggestedStart).toBe('2027-01-12')
    // Changing the period without the field keeps it; without the right it cannot be set (nor read).
    updateParentalLeave(db, traeger, 1, id, input({ start: '2027-01-12', end: '2027-12-31' }))
    expect(db.select().from(parentalLeaveBirths).all()).toHaveLength(1)
    expect(errorCode(() => updateParentalLeave(db, contractOnly(), 1, id, input({ protectionAfterBirthUntil: '2027-02-01' })))).toBe('forbidden')
    expect(updateParentalLeave(db, contractOnly(), 1, id, input({ start: '2027-01-12', end: '2027-12-31' })).id).toBe(id)
    expect(errorCode(() => updateParentalLeave(db, traeger, 1, id, input({ protectionAfterBirthUntil: '2026-11-15' })))).toBe('parental_leave_protection_invalid')
    expect(errorCode(() => updateParentalLeave(db, traeger, 1, id, input({ protectionAfterBirthUntil: '2027-04-06' })))).toBe('parental_leave_protection_invalid')
    // A case for the birth wins; null removes the hand-entered end.
    addCase()
    expect(summary()[0]).toMatchObject({ protection: { to: '2027-01-11', source: 'case' } })
    updateParentalLeave(db, traeger, 1, id, input({ start: '2027-01-12', end: '2027-12-31', protectionAfterBirthUntil: null }))
    expect(db.select().from(parentalLeaveBirths).all()).toEqual([])
  })

  it('warns when the planned Elternzeit exceeds what is still possible, counting a typed end at once', () => {
    create({ start: '2027-01-12', end: '2029-01-11' })
    // 1096 days; 731 taken: 365 left. 365 more days fit, the Mutterschutz typed in the dialog (57 days) makes it too much.
    const next = input({ start: '2029-01-12', end: '2030-01-11' })
    expect(checkParentalLeavePeriod(db, traeger, 1, anna, next, null)).toMatchObject({ hints: [], remainingMonths: 12 })
    expect(checkParentalLeavePeriod(db, traeger, 1, anna, { ...next, protectionAfterBirthUntil: '2027-01-11' }, null))
      .toMatchObject({ hints: ['total'], remainingMonths: 10.1, protection: { source: 'manual' } })
    // Without the right a typed end is not taken (and nothing tells its length).
    expect(checkParentalLeavePeriod(db, contractOnly(), 1, anna, { ...next, protectionAfterBirthUntil: '2027-01-11' }, null))
      .toMatchObject({ hints: [], protection: null })
  })
})
