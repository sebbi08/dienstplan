import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { employeeHours, entries, facilities } from '../../server/db/schema'
import { getYearCalendar } from '../../server/services/calendar'
import { applyToCells } from '../../server/services/entries'
import { facilityHolidayRules } from '../../server/services/holidayRules'
import { getLeaveAccount } from '../../server/services/leave'
import { previewLeaveRequest, setLeaveModule } from '../../server/services/leaveRequests'
import { getMonthPlan } from '../../server/services/plan'
import { loadEmployee, loadEntries } from '../../server/services/queries'
import { getTimeMonth } from '../../server/services/timeTracking'
import { dateRange } from '../../shared/domain/dates'
import { dailyTarget } from '../../shared/domain/targets'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addHelpOut, addUser, codeId, createTestDb, errorCode, templateId } from '../helpers/fixtures'

// 2027-03-08 is a Monday (Women's Day in Berlin), 2026-01-06 a Tuesday (Epiphany in Baden-Württemberg).
const womensDay = '2027-03-08'
const epiphany = '2026-01-06'
const today = '2026-10-15'

describe('holidays follow the facility', () => {
  let db: Db
  /** A facility in Berlin (facility 1 stays in Baden-Württemberg). */
  let berlin: number
  /** Home facility 1 (BW). */
  let anna: number
  /** Home facility Berlin, same contract as Anna. */
  let bea: number

  beforeEach(() => {
    db = createTestDb()
    berlin = addFacility(db, 'Kita Berlin')
    db.update(facilities).set({ state: 'BE' }).where(eq(facilities.id, berlin)).run()
    anna = addEmployee(db, 'Anna')
    bea = addEmployee(db, 'Bea', { facilityId: berlin })
  })

  const infoOf = (employeeId: number) => loadEmployee(db, employeeId)!.info
  const addVacation = (employeeId: number, from: string, to: string) => {
    db.insert(entries).values(dateRange(from, to).map(date => ({
      employeeId, date, kind: 'code' as const, absenceCodeId: codeId(db, 'vacation'), updatedAt: '2026-10-15T08:00:00.000Z',
    }))).run()
  }

  it('a facility defaults to Baden-Württemberg', () => {
    expect(facilityHolidayRules(db, 1)).toEqual({ state: 'BW', assumptionDay: true })
    expect(facilityHolidayRules(db, berlin)).toEqual({ state: 'BE', assumptionDay: true })
    expect(errorCode(() => facilityHolidayRules(db, 999))).toBe('facility_not_found')
  })

  it('targets follow the home facility', () => {
    expect(infoOf(anna).holidays).toEqual({ state: 'BW', assumptionDay: true })
    expect(infoOf(bea).holidays).toEqual({ state: 'BE', assumptionDay: true })
    expect(dailyTarget(infoOf(bea), womensDay)).toBe(0)
    expect(dailyTarget(infoOf(anna), womensDay)).toBe(468)
    expect(dailyTarget(infoOf(anna), epiphany)).toBe(0)
    expect(dailyTarget(infoOf(bea), epiphany)).toBe(468)
  })

  it('leave days follow the home facility', () => {
    addVacation(anna, '2027-03-08', '2027-03-12')
    addVacation(bea, '2027-03-08', '2027-03-12')
    expect(getLeaveAccount(db, bea, 2027, today)).toMatchObject({
      account: { planned: 4 }, ranges: [{ from: '2027-03-09', to: '2027-03-12', days: 4 }],
    })
    expect(getLeaveAccount(db, anna, 2027, today)).toMatchObject({
      account: { planned: 5 }, ranges: [{ from: '2027-03-08', to: '2027-03-12', days: 5 }],
    })
  })

  it('a leave request counts the working days of the home facility', () => {
    setLeaveModule(db, { enabled: true, plannerIds: [] })
    const annaUser = addUser(db, 'anna', 'observer', anna)
    const beaUser = addUser(db, 'bea', 'observer', bea)
    expect(previewLeaveRequest(db, beaUser, '2027-03-08', '2027-03-12', today).workdays).toBe(4)
    expect(previewLeaveRequest(db, annaUser, '2027-03-08', '2027-03-12', today).workdays).toBe(5)
  })

  it('a helper keeps the home facility\'s holidays, the plan shows the helping facility\'s', () => {
    addHelpOut(db, anna, berlin, 2027, 3)
    const leitungBerlin: SessionUser = addUser(db, 'leitung-berlin', 'admin', null, berlin)
    const leitungHome: SessionUser = addUser(db, 'leitung', 'admin')
    // Anna (home BW) works in the Berlin plan on Women's Day.
    applyToCells(db, leitungBerlin, berlin, [{ employeeId: anna, date: womensDay }], 'replace', { kind: 'shift', templateId: templateId(db, 'M', berlin) })
    const berlinPlan = getMonthPlan(db, leitungBerlin, berlin, 2027, 3, today)
    expect(berlinPlan.admin!.helpers.map(helper => helper.employeeId)).toEqual([anna])
    expect(berlinPlan.days.find(day => day.date === womensDay)!.holidayKey).toBe('womens_day')
    expect(loadEntries(db, { planFacilityId: berlin, employeeId: anna }).map(entry => entry.date)).toEqual([womensDay])
    expect(getMonthPlan(db, leitungHome, 1, 2027, 3, today).days.find(day => day.date === womensDay)!.holidayKey).toBeNull()
    expect(dailyTarget(infoOf(anna), womensDay)).toBeGreaterThan(0)
    // Her own time sheet keeps the home facility's target for that day, with the help-out duty in it.
    const sheetDay = getTimeMonth(db, 1, anna, 2027, 3, today).days.find(row => row.date === womensDay)!
    expect(sheetDay).toMatchObject({ holidayKey: null })
    expect(sheetDay.target).toBe(468)
    expect(sheetDay.plannedMinutes).toBeGreaterThan(0)
  })

  it('coverage warnings skip the plan facility\'s holidays', () => {
    const leitungBerlin = addUser(db, 'leitung-berlin', 'admin', null, berlin)
    const leitungHome = addUser(db, 'leitung', 'admin')
    const warningsOn = (plan: ReturnType<typeof getMonthPlan>, date: string) => plan.admin!.warnings.filter(warning => warning.date === date)
    expect(warningsOn(getMonthPlan(db, leitungBerlin, berlin, 2027, 3, today), womensDay)).toEqual([])
    expect(warningsOn(getMonthPlan(db, leitungHome, 1, 2027, 3, today), womensDay).map(warning => warning.type)).toContain('coverage')
    expect(warningsOn(getMonthPlan(db, leitungBerlin, berlin, 2026, 1, today), epiphany).map(warning => warning.type)).toContain('coverage')
    expect(warningsOn(getMonthPlan(db, leitungHome, 1, 2026, 1, today), epiphany)).toEqual([])
  })

  it('time sheets and the year calendar use the employee\'s home facility', () => {
    const day = (date: string) => getTimeMonth(db, berlin, bea, 2027, 3, today).days.find(row => row.date === date)!
    expect(day(womensDay)).toMatchObject({ holidayKey: 'womens_day', target: 0 })
    expect(getTimeMonth(db, 1, anna, 2027, 3, today).days.find(row => row.date === womensDay))
      .toMatchObject({ holidayKey: null, target: 468 })
    // Free days: Mon–Fri without a holiday on which a part-timer does not work (Bea now works Tuesday to Friday).
    db.update(employeeHours).set({ workdays: 0b0011110 }).where(eq(employeeHours.employeeId, bea)).run()
    const freeDays = getYearCalendar(db, berlin, 2027).freeDays[bea]!
    expect(freeDays).toContain('2027-03-01')
    expect(freeDays).not.toContain(womensDay)
  })
})
