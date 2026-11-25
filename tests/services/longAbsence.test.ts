import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { closures, entries, longAbsences, maternityCases, parentalLeaves } from '../../server/db/schema'
import { bemReminders, getEmployeeBem } from '../../server/services/bem'
import { getSickYear, getStaffYearCalendar, getYearCalendar } from '../../server/services/calendar'
import { deleteCategories } from '../../server/services/employeeDeletion'
import {
  createLongAbsence, deleteLongAbsence, getEmployeeLongAbsences, longAbsenceReminders, removeLongAbsenceDuties, updateLongAbsence,
  type LongAbsenceScope,
} from '../../server/services/longAbsence'
import { bookMaternity, createMaternityCase } from '../../server/services/maternity'
import { getMonthPlan, getMyPlan } from '../../server/services/plan'
import { loadEntries } from '../../server/services/queries'
import { releaseMonth } from '../../server/services/release'
import { listReminders } from '../../server/services/reminders'
import { staffingMonth } from '../../server/services/staffingReport'
import { applyWeekTemplate, saveWeekTemplate } from '../../server/services/weekTemplates'
import type { LongAbsenceInput, SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addUser, asChildViewer, codeId, createTestDb, errorCode } from '../helpers/fixtures'

const TODAY = '2026-11-25'

let db: Db
let traeger: SessionUser
let leitung: SessionUser
let mitarbeiter: SessionUser
let lea: number
let anna: number
let ben: number
let scope: LongAbsenceScope

const input = (values: Partial<LongAbsenceInput> = {}): LongAbsenceInput => ({ reason: 'sick', start: '2026-11-16', end: null, ...values })
const create = (values: Partial<LongAbsenceInput> = {}, employeeId = anna, actor = leitung) =>
  createLongAbsence(db, actor, scope, employeeId, input(values))

function addEntry(employeeId: number, date: string, values: Partial<typeof entries.$inferInsert>) {
  return db.insert(entries).values({ employeeId, date, kind: 'special', updatedAt: '2026-11-01T00:00:00.000Z', ...values })
    .returning({ id: entries.id }).get().id
}
const shiftOn = (employeeId: number, date: string) => addEntry(employeeId, date, { kind: 'special', start: 465, end: 960, breakStart: 700, breakEnd: 730 })
const codeOn = (employeeId: number, date: string, key: string) => addEntry(employeeId, date, { kind: 'code', absenceCodeId: codeId(db, key) })

beforeEach(() => {
  db = createTestDb()
  traeger = addUser(db, 'traeger', 'provider')
  lea = addEmployee(db, 'Lea Leitung')
  leitung = addUser(db, 'leitung', 'admin', lea)
  anna = addEmployee(db, 'Anna Muster')
  ben = addEmployee(db, 'Ben Beispiel')
  mitarbeiter = addUser(db, 'ben', 'observer', ben)
  scope = { facilityId: 1, ownEmployeeId: lea }
})

describe('entering a long absence', () => {
  it('stores reason and period („bis auf Weiteres“ without an end) and lists it with who entered it', () => {
    const { id, duties } = create()
    expect(duties).toEqual([])
    const section = getEmployeeLongAbsences(db, leitung, scope, anna)
    expect(section.items).toEqual([{
      id, source: 'entry', reason: 'sick', start: '2026-11-16', end: null, returnDay: null, createdBy: 'Lea Leitung',
      createdOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    }])
    expect(section.canRemoveDuties).toBe(true)
    // Ending it: the person works again from the next working day (Friday 11.12. → Monday 14.12.).
    updateLongAbsence(db, scope, id, input({ end: '2026-12-11' }))
    expect(getEmployeeLongAbsences(db, leitung, scope, anna).items[0]).toMatchObject({ end: '2026-12-11', returnDay: '2026-12-14' })
    deleteLongAbsence(db, scope, id)
    expect(db.select().from(longAbsences).all()).toEqual([])
  })

  it('checks the period and keeps it to the facility, never about the viewer themselves', () => {
    expect(errorCode(() => create({ start: '2026-11-16', end: '2026-11-15' }))).toBe('long_absence_end_before_start')
    const { id } = create({ start: '2026-11-16', end: '2026-12-31' })
    expect(errorCode(() => create({ start: '2026-12-31', end: null, reason: 'rehab' }))).toBe('long_absence_overlap')
    expect(create({ start: '2027-01-01', end: null, reason: 'other' }).id).toBeGreaterThan(id)
    // A Leitung's own long absence is entered by the Träger.
    expect(errorCode(() => create({}, lea))).toBe('long_absence_own')
    expect(createLongAbsence(db, traeger, { facilityId: 1, ownEmployeeId: null }, lea, input()).id).toBeGreaterThan(0)
    expect(errorCode(() => getEmployeeLongAbsences(db, leitung, scope, lea))).toBe('long_absence_own')
    const other = addEmployee(db, 'Fremd', { facilityId: addFacility(db, 'Krippe') })
    expect(errorCode(() => create({}, other))).toBe('employee_not_found')
    const foreignScope = { facilityId: 2, ownEmployeeId: null }
    expect(errorCode(() => updateLongAbsence(db, foreignScope, id, input()))).toBe('long_absence_not_found')
    expect(errorCode(() => deleteLongAbsence(db, foreignScope, id))).toBe('long_absence_not_found')
  })

  it('shows the Mutterschutz booked in the plan and the full Elternzeit as taken over, not stored twice', () => {
    db.insert(parentalLeaves).values({
      employeeId: anna, childBirthDate: '2026-06-01', start: '2027-01-12', end: '2028-01-11', createdAt: 'x', updatedAt: 'x',
    }).run()
    const caseId = createMaternityCase(db, leitung, { facilityId: 1, ownEmployeeId: lea }, anna, {
      notifiedOn: '2026-05-04', expectedBirth: '2026-11-16', actualBirth: null, extendedAfter: false, breastfeedingUntil: null,
      authorityNotifiedOn: null, riskAssessmentOn: null, employmentBan: 'none', banFrom: null, banTo: null, banNote: '', endedOn: null,
    }, TODAY)
    // Not booked yet: nothing taken over from the Mutterschutz.
    expect(getEmployeeLongAbsences(db, traeger, { facilityId: 1, ownEmployeeId: null }, anna).items.map(item => item.source)).toEqual(['parentalLeave'])
    bookMaternity(db, leitung, { facilityId: 1, ownEmployeeId: lea }, caseId, 'protection', true)
    const items = getEmployeeLongAbsences(db, traeger, { facilityId: 1, ownEmployeeId: null }, anna).items
    expect(items).toEqual([
      expect.objectContaining({ id: null, source: 'parentalLeave', reason: 'parental_leave', start: '2027-01-12', end: '2028-01-11' }),
      expect.objectContaining({ id: null, source: 'maternity', reason: 'maternity', start: '2026-10-05', end: '2027-01-11', returnDay: '2028-01-12' }),
    ])
    // The Elternzeit only for viewers of the contract data (the Leitung by default does not see it).
    expect(getEmployeeLongAbsences(db, leitung, scope, anna).items.map(item => item.source)).toEqual(['maternity'])
    expect(db.select().from(longAbsences).all()).toEqual([])
  })
})

describe('duties already planned in the period', () => {
  it('are named on saving and removed only on request, with plan.edit, never the absences', () => {
    const kept = codeOn(anna, '2026-11-10', 'vacation')
    shiftOn(anna, '2026-11-26')
    addEntry(anna, '2026-11-26', { kind: 'break', start: 800, end: 815 })
    const sick = codeOn(anna, '2026-11-27', 'sick')
    shiftOn(anna, '2026-12-02')
    const before = shiftOn(anna, '2026-11-13')
    releaseMonth(db, leitung, 1, 2026, 11)
    const { id, duties } = create({ start: '2026-11-16', end: null })
    expect(duties.map(duty => duty.date)).toEqual(['2026-11-26', '2026-12-02'])
    // Nothing is deleted by saving.
    expect(loadEntries(db, { employeeId: anna })).toHaveLength(6)
    const noPlan = { ...leitung, permissions: new Set([...leitung.permissions].filter(key => key !== 'plan.edit')) }
    expect(errorCode(() => removeLongAbsenceDuties(db, noPlan, scope, id))).toBe('forbidden')
    expect(removeLongAbsenceDuties(db, leitung, scope, id)).toEqual({ removed: 2 })
    expect(loadEntries(db, { employeeId: anna }).map(entry => entry.id).sort()).toEqual([kept, sick, before].sort())
    // Each removal is a plan change like any other (shown until released).
    expect(getMonthPlan(db, leitung, 1, 2026, 11, TODAY).admin!.pendingChanges[`${anna}|2026-11-26`]).toBeDefined()
  })
})

describe('the roster', () => {
  it('takes a person away for the whole month out of the plan and names them in the line below it', () => {
    create({ start: '2026-11-02', end: null })
    const plan = getMonthPlan(db, leitung, 1, 2026, 12, TODAY)
    expect(plan.employees.map(employee => employee.id)).not.toContain(anna)
    expect(plan.entries.filter(entry => entry.employeeId === anna)).toEqual([])
    expect(plan.longAbsence.hidden).toEqual([anna])
    expect(plan.longAbsence.people).toEqual([{ employeeId: anna, name: 'Anna Muster', from: '2026-11-02', to: null, reason: 'sick' }])
    expect(plan.admin!.warnings.filter(warning => 'employeeId' in warning && warning.employeeId === anna)).toEqual([])
    // Her hours account stands still: each working day counts as sick (credited like „Krank“).
    const balance = plan.admin!.balances.find(item => item.employeeId === anna)!
    expect(balance.monthEnd - balance.previousMonthEnd).toBe(0)
    const benBalance = plan.admin!.balances.find(item => item.employeeId === ben)!
    expect(benBalance.monthEnd - benBalance.previousMonthEnd).toBeLessThan(0)
  })

  it('marks the days of a period that begins in the month and needs no entry on them', () => {
    create({ start: '2026-11-16', end: null })
    const plan = getMonthPlan(db, leitung, 1, 2026, 11, TODAY)
    expect(plan.employees.map(employee => employee.id)).toContain(anna)
    expect(plan.longAbsence.hidden).toEqual([])
    expect(plan.longAbsence.cells[`${anna}|2026-11-16`]).toBe('sick')
    expect(plan.longAbsence.cells[`${anna}|2026-11-21`]).toBeUndefined() // Saturday: no working day
    expect(plan.longAbsence.cells[`${anna}|2026-11-13`]).toBeUndefined()
    const missing = plan.admin!.warnings.filter(warning => warning.type === 'missing_entry' && warning.employeeId === anna).map(warning => warning.date)
    expect(missing).toContain('2026-11-13')
    expect(missing.filter(date => date >= '2026-11-16')).toEqual([])
  })

  it('keeps a person with a duty in the period in the plan and warns about the duty, which does not count as present', () => {
    const { id } = create({ start: '2026-11-02', end: null })
    shiftOn(anna, '2026-12-03')
    const plan = getMonthPlan(db, leitung, 1, 2026, 12, TODAY)
    expect(plan.longAbsence.hidden).toEqual([])
    expect(plan.employees.map(employee => employee.id)).toContain(anna)
    expect(plan.admin!.warnings).toContainEqual({ type: 'long_absence_duty', date: '2026-12-03', employeeId: anna })
    expect(plan.admin!.warnings.filter(warning => warning.type === 'missing_entry' && warning.employeeId === anna)).toEqual([])
    // The Personalschlüssel does not count it either (without the long absence it does).
    expect(staffingMonth(db, 1, 2026, 12).total.planned.fte).toBe(0)
    deleteLongAbsence(db, scope, id)
    expect(staffingMonth(db, 1, 2026, 12).total.planned.fte).toBeGreaterThan(0)
  })

  it('tells the reason only to viewers of the health data, everybody else sees „abwesend“ (null) in the plan\'s data', () => {
    create({ start: '2026-11-02', end: null, reason: 'rehab' })
    releaseMonth(db, leitung, 1, 2026, 12)
    const staffPlan = getMonthPlan(db, mitarbeiter, 1, 2026, 12, TODAY)
    expect(staffPlan.employees.map(employee => employee.id)).not.toContain(anna)
    expect(staffPlan.longAbsence.people).toEqual([{ employeeId: anna, name: 'Anna Muster', from: '2026-11-02', to: null, reason: null }])
    expect(JSON.stringify(staffPlan)).not.toMatch(/rehab|"sick"/)
    const noHealth = { ...leitung, permissions: new Set([...leitung.permissions].filter(key => key !== 'employees.sickness')) }
    expect(getMonthPlan(db, noHealth, 1, 2026, 12, TODAY).longAbsence.people[0]!.reason).toBeNull()
    expect(getMonthPlan(db, { ...leitung, role: 'terminal' }, 1, 2026, 12, TODAY).longAbsence.people[0]!.reason).toBeNull()
    expect(getMonthPlan(db, traeger, 1, 2026, 12, TODAY).longAbsence.people[0]!.reason).toBe('rehab')
  })

  it('takes over a booked Mutterschutz and a full Elternzeit; adjoining ones join for whoever sees only „abwesend“', () => {
    const maternityScope = { facilityId: 1, ownEmployeeId: lea }
    const caseId = createMaternityCase(db, leitung, maternityScope, anna, {
      notifiedOn: '2026-05-04', expectedBirth: '2026-11-16', actualBirth: null, extendedAfter: false, breastfeedingUntil: null,
      authorityNotifiedOn: null, riskAssessmentOn: null, employmentBan: 'none', banFrom: null, banTo: null, banNote: '', endedOn: null,
    }, TODAY)
    // Protected 05.10.2026–11.01.2027; not booked: Anna stays in the plan.
    expect(getMonthPlan(db, leitung, 1, 2026, 12, TODAY).longAbsence.people).toEqual([])
    bookMaternity(db, leitung, maternityScope, caseId, 'protection', true)
    db.insert(parentalLeaves).values({
      employeeId: anna, childBirthDate: '2026-11-16', start: '2027-01-12', end: '2028-01-11', createdAt: 'x', updatedAt: 'x',
    }).run()
    const plan = getMonthPlan(db, leitung, 1, 2026, 12, TODAY)
    expect(plan.longAbsence.hidden).toEqual([anna])
    expect(plan.longAbsence.people).toEqual([{ employeeId: anna, name: 'Anna Muster', from: '2026-10-05', to: '2027-01-11', reason: 'maternity' }])
    expect(plan.admin!.warnings.filter(warning => 'employeeId' in warning && warning.employeeId === anna)).toEqual([])
    const january = getMonthPlan(db, leitung, 1, 2027, 1, TODAY)
    expect(january.longAbsence.hidden).toEqual([anna])
    expect(january.longAbsence.people.map(item => item.reason)).toEqual(['maternity', 'parental_leave'])
    releaseMonth(db, leitung, 1, 2027, 1)
    // Elternzeit shows as „abwesend“ to staff (the facility's switch is off): one period, the change of reason not told.
    expect(getMonthPlan(db, mitarbeiter, 1, 2027, 1, TODAY).longAbsence.people)
      .toEqual([{ employeeId: anna, name: 'Anna Muster', from: '2026-10-05', to: '2028-01-11', reason: null }])
  })

  it('is not filled by a week template', () => {
    for (const date of ['2026-11-02', '2026-11-03']) {
      shiftOn(anna, date)
      shiftOn(ben, date)
    }
    const template = saveWeekTemplate(db, 1, { name: 'Woche A', weekStart: '2026-11-02' })
    create({ start: '2026-11-09', end: '2026-11-13' })
    applyWeekTemplate(db, leitung, 1, template.id, '2026-11-09')
    expect(loadEntries(db, { employeeId: anna, from: '2026-11-09', to: '2026-11-15' })).toEqual([])
    expect(loadEntries(db, { employeeId: ben, from: '2026-11-09', to: '2026-11-15' })).toHaveLength(2)
  })

  it('shows the person\'s own days as „Längere Abwesenheit“ in „Mein Dienstplan“', () => {
    create({ start: '2026-12-07', end: '2026-12-18' })
    releaseMonth(db, leitung, 1, 2026, 12)
    const account = addUser(db, 'anna', 'observer', anna)
    const days = getMyPlan(db, account, 2026, 12, TODAY).days
    expect(days.filter(day => day.longAbsence).map(day => day.date)).toEqual([
      '2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11', '2026-12-14', '2026-12-15', '2026-12-16', '2026-12-17', '2026-12-18',
    ])
  })
})

describe('sick days without daily entries', () => {
  it('counts Langzeitkrank on the working days up to today in the Krankheitstage, a „Krank“ entry inside once, no closure days', () => {
    create({ start: '2026-11-16', end: null })
    const row = () => getSickYear(db, 1, 2026, TODAY).find(item => item.employeeId === anna)!
    // Mon 16.11. – Wed 25.11.: 8 working days.
    expect(row().total).toBe(8)
    codeOn(anna, '2026-11-18', 'sick')
    expect(row().total).toBe(8)
    codeOn(anna, '2026-11-10', 'sick')
    expect(row().total).toBe(9)
    db.insert(closures).values({ facilityId: 1, startDate: '2026-11-24', endDate: '2026-11-24', label: 'Teamtag', mode: 'closure_day' }).run()
    expect(row().total).toBe(8)
    // Sonstiges is no sickness.
    const benAbsence = create({ start: '2026-11-02', end: null, reason: 'other' }, ben)
    expect(getSickYear(db, 1, 2026, TODAY).find(item => item.employeeId === ben)!.total).toBe(0)
    deleteLongAbsence(db, scope, benAbsence.id)
  })

  it('counts them for the BEM (more than 6 weeks within 12 months) and reminds to offer it', () => {
    create({ start: '2026-09-01', end: null })
    const bemScope = { facilityId: 1, ownEmployeeId: lea }
    const { days, limit } = getEmployeeBem(db, bemScope, anna, TODAY).sickDays
    expect(limit).toBe(30)
    expect(days).toBeGreaterThan(limit)
    const viewer = { facilityId: 1, permissions: leitung.permissions, onTablet: false, employeeId: lea }
    expect(bemReminders(db, viewer, TODAY).map(item => item.bem?.employeeId)).toContain(anna)
    // Ended early: only its working days count.
    const id = db.select().from(longAbsences).get()!.id
    updateLongAbsence(db, scope, id, input({ start: '2026-09-01', end: '2026-09-04' }))
    expect(getEmployeeBem(db, bemScope, anna, TODAY).sickDays.days).toBe(4)
  })

  it('shows them in the year calendar as Krank for viewers of the health data and as „abwesend“ for everybody else', () => {
    create({ start: '2026-11-16', end: '2026-11-20', reason: 'rehab' })
    create({ start: '2026-11-23', end: '2026-11-27', reason: 'other' }, ben)
    expect(getYearCalendar(db, 1, 2026).days[anna]!['2026-11-17']).toBe('sick')
    expect(getYearCalendar(db, 1, 2026).days[ben]!['2026-11-24']).toBe('absent')
    expect(getYearCalendar(db, 1, 2026, { showsProtected: false }).days[anna]!['2026-11-17']).toBe('absent')
    expect(getStaffYearCalendar(db, 1, 2026, ben).days[anna]!['2026-11-17']).toBe('absent')
    expect(getStaffYearCalendar(db, 1, 2026, anna).days[anna]!['2026-11-17']).toBe('sick')
    // Sonstiges has no working days, yet its days are no free days of a part-timer.
    expect(getYearCalendar(db, 1, 2026).freeDays[ben]).not.toContain('2026-11-24')
  })
})

describe('the reminder of the return', () => {
  it('reminds Leitung and Träger 2 weeks before the first working day after a known end, never naming the reason', () => {
    create({ start: '2026-11-02', end: '2026-12-04' })
    const reminders = (user: SessionUser, today = TODAY) => listReminders(db, asChildViewer(user), today).filter(item => item.kind === 'longAbsence')
    // Friday 04.12. → back on Monday 07.12.; from 23.11. on.
    expect(reminders(leitung)).toEqual([expect.objectContaining({
      kind: 'longAbsence', date: '2026-12-07', state: 'upcoming', name: 'Anna Muster', longAbsence: { employeeId: anna },
    })])
    expect(JSON.stringify(reminders(leitung))).not.toMatch(/sick|krank/i)
    expect(reminders(leitung, '2026-11-22')).toEqual([])
    expect(reminders(leitung, '2026-12-07')[0]!.state).toBe('today')
    expect(reminders(leitung, '2026-12-08')).toEqual([])
    expect(reminders(mitarbeiter)).toEqual([])
    expect(longAbsenceReminders(db, { facilityId: 1, permissions: leitung.permissions, onTablet: true, employeeId: lea }, TODAY)).toEqual([])
    // „bis auf Weiteres“: no end, no reminder.
    const id = db.select().from(longAbsences).get()!.id
    updateLongAbsence(db, scope, id, input({ start: '2026-11-02', end: null }))
    expect(reminders(leitung)).toEqual([])
  })

  it('skips a second period that follows directly and names the day after the last one', () => {
    create({ start: '2026-11-02', end: '2026-11-30' })
    create({ start: '2026-12-01', end: '2026-12-04', reason: 'rehab' })
    expect(listReminders(db, asChildViewer(leitung), TODAY).filter(item => item.kind === 'longAbsence').map(item => item.date))
      .toEqual(['2026-12-07'])
  })
})

describe('retention', () => {
  it('goes with the plan entries and the Krankheitstage („Sonstige Überstunden- und Zeitdaten“) and with the employee', () => {
    create()
    db.transaction(tx => deleteCategories(tx, anna, ['bem', 'maternity', 'assessment']))
    expect(db.select().from(longAbsences).all()).toHaveLength(1)
    db.transaction(tx => deleteCategories(tx, anna, ['time']))
    expect(db.select().from(longAbsences).all()).toEqual([])
    create({}, ben)
    db.delete(maternityCases).run()
    db.delete(entries).where(eq(entries.employeeId, ben)).run()
    expect(db.select().from(longAbsences).where(eq(longAbsences.employeeId, ben)).all()).toHaveLength(1)
  })
})
