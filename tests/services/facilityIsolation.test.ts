import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import {
  calendarEvents, changeLog, closures, coverageRules, dayNotes, earlyClosures, employees, entries, monthPlans, notifications,
  shiftTemplates, weekTemplateMarks, weekTemplates,
} from '../../server/db/schema'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { getActiveUser } from '../../server/services/auth'
import { getBalanceOverview } from '../../server/services/balances'
import {
  createCalendarEvent, deleteCalendarEvent, getMyYearCalendar, getSickYear, getStaffYearCalendar, getYearCalendar,
  listCalendarEvents, updateCalendarEvent,
} from '../../server/services/calendar'
import { isMonthReleased } from '../../server/services/changeLog'
import { createClosure, deleteClosure, listClosures } from '../../server/services/closures'
import { createEarlyClosure, deleteEarlyClosure, listEarlyClosures, updateEarlyClosure } from '../../server/services/earlyClosures'
import {
  addAdjustment, addHours, createEmployee, deleteAdjustment, deleteHours, getEmployee, listEmployees, listLevelUps, moveEmployee,
  moveEmployeeToFacility, setContract, setEntitlement, setStampingOptions, updateEmployee,
} from '../../server/services/employees'
import { applyToCells, deleteEntry, setDayNote, setEntryGroup, updateEntryTimes } from '../../server/services/entries'
import { createGroup, deleteGroup, listGroups, renameGroup } from '../../server/services/groups'
import { getLeaveOverview } from '../../server/services/leave'
import {
  createLeaveRequest, decideLeaveRequest, getLeavePlanning, getLeaveSettings, isPlanner, listMyLeaveRequests, listOpenRequests,
  maxConcurrent, previewLeaveRequest, setLeaveModule, setMaxConcurrent,
} from '../../server/services/leaveRequests'
import { addHelpOut as planHelper, helpCandidates, listHelpers, removeHelpOut } from '../../server/services/helpOuts'
import { getMyTime } from '../../server/services/myTime'
import { listNotifications, notifyDutyChanges, releaseNotificationStatus } from '../../server/services/notifications'
import { getMonthPlan, getMyPlan } from '../../server/services/plan'
import { loadEmployees, loadEntries } from '../../server/services/queries'
import { backfillSnapshots, buildSnapshot, loadReleases, releaseMonth } from '../../server/services/release'
import { revertToRelease } from '../../server/services/revert'
import { createCoverageRule, createTemplate, getSettings, updateCoverageRule } from '../../server/services/settings'
import { clearPin, setPin, terminalStamp, terminalStatus } from '../../server/services/terminal'
import {
  createRecord, deleteRecord, getTimeMonth, listOpenRecords, loadTimeRecords, setTimeDayNote, stamp, updateRecord,
} from '../../server/services/timeTracking'
import {
  applyWeekTemplate, deleteWeekTemplate, listWeekTemplates, renameWeekTemplate, saveWeekTemplate, weekTemplateNames,
} from '../../server/services/weekTemplates'
import { cellKey, noteKey } from '../../shared/domain/cells'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addGroup, addHelpOut, addUser, codeId, createTestDb, errorCode, templateId } from '../helpers/fixtures'

const today = '2026-10-05'
const date = '2026-10-06'

describe('facility isolation', () => {
  let db: Db
  let facility2: number
  let anna: number
  let kim: number
  let leitungA: SessionUser
  let leitungB: SessionUser
  beforeEach(() => {
    db = createTestDb()
    facility2 = addFacility(db, 'Krippe')
    anna = addEmployee(db, 'Anna')
    kim = addEmployee(db, 'Kim', { facilityId: facility2 })
    leitungA = addUser(db, 'leitungA', 'admin')
    leitungB = addUser(db, 'leitungB', 'admin', null, facility2)
  })

  describe('employees, plan entries, day notes and closures (Task 3)', () => {
    it('lists only the facility\'s employees', () => {
      expect(listEmployees(db, 1, today, 'admin').map(e => e.name)).toEqual(['Anna'])
      expect(listEmployees(db, facility2, today, 'admin').map(e => e.name)).toEqual(['Kim'])
      expect(loadEmployees(db, 1).map(e => e.name)).toEqual(['Anna'])
      expect(errorCode(() => getEmployee(db, 1, kim, today, 'admin'))).toBe('employee_not_found')
      expect(getEmployee(db, facility2, kim, today, 'admin').name).toBe('Kim')
    })

    it('refuses changes to another facility\'s employee', () => {
      const update = { name: 'Kim', shortName: 'KI', leftOn: null }
      expect(errorCode(() => updateEmployee(db, 1, kim, update))).toBe('employee_not_found')
      expect(errorCode(() => addHours(db, 1, kim, { weeklyMinutes: 600, validFrom: '2026-10-01' }))).toBe('employee_not_found')
      expect(errorCode(() => addAdjustment(db, 1, kim, { date, minutes: 60, reason: 'x' }))).toBe('employee_not_found')
      expect(errorCode(() => setStampingOptions(db, 1, kim, { stampVia: 'tablet', breakMode: 'auto' }))).toBe('employee_not_found')
      const contract = { personnelNumber: null, employedSince: null, jobKey: null, jobOther: null, payGroup: null, payLevel: null }
      expect(errorCode(() => setContract(db, 1, kim, contract))).toBe('employee_not_found')
      addHours(db, facility2, kim, { weeklyMinutes: 600, validFrom: '2026-10-01' })
      const hoursId = getEmployee(db, facility2, kim, today, 'admin').hours[1]!.id
      expect(errorCode(() => deleteHours(db, 1, hoursId))).toBe('hours_not_found')
      expect(errorCode(() => moveEmployee(db, 1, kim, 'up'))).toBe('employee_not_found')
      expect(errorCode(() => setEntitlement(db, 1, kim, 2026, { days: 30, carriedOverDays: 0 }))).toBe('employee_not_found')
      addAdjustment(db, facility2, kim, { date, minutes: 60, reason: 'Übertrag' })
      const adjustmentId = getEmployee(db, facility2, kim, today, 'admin').adjustments[0]!.id
      deleteAdjustment(db, 1, adjustmentId)
      expect(getEmployee(db, facility2, kim, today, 'admin').adjustments).toHaveLength(1)
      deleteAdjustment(db, facility2, adjustmentId)
      expect(getEmployee(db, facility2, kim, today, 'admin').adjustments).toHaveLength(0)
    })

    it('refuses plan entries for another facility\'s employee', () => {
      const shift = { kind: 'shift' as const, templateId: templateId(db, 'M') }
      expect(errorCode(() => applyToCells(db, leitungA, 1, [{ employeeId: kim, date }], 'replace', shift))).toBe('employee_not_found')
      expect(loadEntries(db, { employeeId: kim })).toEqual([])
    })

    it('refuses a mixed batch as a whole', () => {
      const shift = { kind: 'shift' as const, templateId: templateId(db, 'M') }
      const cells = [{ employeeId: anna, date }, { employeeId: kim, date }]
      expect(errorCode(() => applyToCells(db, leitungA, 1, cells, 'replace', shift))).toBe('employee_not_found')
      expect(db.select().from(entries).all()).toEqual([])
    })

    it('keeps entries of another facility out of reach', () => {
      applyToCells(db, leitungB, facility2, [{ employeeId: kim, date }], 'replace', { kind: 'special', start: 480, end: 720 })
      const [entry] = loadEntries(db, { employeeId: kim })
      expect(errorCode(() => deleteEntry(db, leitungA, 1, entry!.id))).toBe('entry_not_found')
      expect(errorCode(() => updateEntryTimes(db, leitungA, 1, entry!.id, { start: 500, end: 720, breakStart: null, breakEnd: null })))
        .toBe('entry_not_found')
      expect(loadEntries(db, { homeFacilityId: 1 })).toEqual([])
      expect(loadEntries(db, { homeFacilityId: facility2 }).map(e => e.id)).toEqual([entry!.id])
    })

    it('logs changes only for the facility whose month is released', () => {
      db.insert(monthPlans).values({ facilityId: 1, year: 2026, month: 10, releasedAt: '2026-10-01T08:00:00.000Z' }).run()
      expect(isMonthReleased(db, 1, date)).toBe(true)
      expect(isMonthReleased(db, facility2, date)).toBe(false)
      const special = { kind: 'special' as const, start: 480, end: 720 }
      applyToCells(db, leitungA, 1, [{ employeeId: anna, date }], 'replace', special)
      applyToCells(db, leitungB, facility2, [{ employeeId: kim, date }], 'replace', special)
      setDayNote(db, leitungB, facility2, date, 'info2', 'Fototag')
      expect(db.select().from(changeLog).all().map(row => [row.facilityId, row.employeeId, row.field])).toEqual([[1, anna, 'entry']])
    })

    it('keeps day notes per facility', () => {
      setDayNote(db, leitungA, 1, date, 'info1', 'Ausflug')
      setDayNote(db, leitungB, facility2, date, 'info1', 'Elternabend')
      const notes = db.select().from(dayNotes).where(eq(dayNotes.date, date)).all()
      expect(notes.map(note => [note.facilityId, note.info1]).sort()).toEqual([[1, 'Ausflug'], [facility2, 'Elternabend']])
    })

    it('books closures only for the facility\'s staff', () => {
      const closure = createClosure(db, leitungA, 1, { startDate: date, endDate: date, label: 'Betriebsausflug', mode: 'closure_day' })
      expect(loadEntries(db, { from: date, to: date }).map(e => e.employeeId)).toEqual([anna])
      expect(errorCode(() => deleteClosure(db, leitungB, facility2, closure.id))).toBe('closure_not_found')
      expect(listClosures(db, 1).map(c => c.label)).toEqual(['Betriebsausflug'])
      expect(listClosures(db, facility2)).toEqual([])
      // A new employee of facility 2 does not get facility 1's closure.
      const lea = createEmployee(db, leitungB, facility2, { name: 'Lea', shortName: 'LE', weeklyMinutes: 2340, validFrom: '2026-01-01' })
      expect(loadEntries(db, { employeeId: lea })).toEqual([])
      expect(db.select().from(entries).where(and(eq(entries.employeeId, anna), eq(entries.absenceCodeId, codeId(db, 'closure_day')))).all())
        .toHaveLength(1)
    })

    it('early closures may share a date across facilities', () => {
      const first = createEarlyClosure(db, 1, { date, closedFrom: 780, reason: 'Wasserschaden' })
      createEarlyClosure(db, facility2, { date, closedFrom: 840, reason: 'Personalausfall' })
      expect(listEarlyClosures(db, 1, 2026).map(c => c.reason)).toEqual(['Wasserschaden'])
      expect(listEarlyClosures(db, facility2, 2026).map(c => c.reason)).toEqual(['Personalausfall'])
      expect(errorCode(() => updateEarlyClosure(db, facility2, first.id, { date, closedFrom: 800, reason: 'x' })))
        .toBe('early_closure_not_found')
      deleteEarlyClosure(db, facility2, first.id)
      expect(listEarlyClosures(db, 1, 2026)).toHaveLength(1)
      expect(errorCode(() => createEarlyClosure(db, 1, { date, closedFrom: 800, reason: 'x' }))).toBe('early_closure_exists')
    })

    it('creates employees in the given facility with their own sort order', () => {
      const lea = createEmployee(db, leitungB, facility2, { name: 'Lea', shortName: 'LE', weeklyMinutes: 2340, validFrom: '2026-01-01' })
      const ben = createEmployee(db, leitungA, 1, { name: 'Ben', shortName: 'BE', weeklyMinutes: 2340, validFrom: '2026-01-01' })
      expect(loadEmployees(db, facility2).map(e => [e.name, e.sortOrder])).toEqual([['Kim', 2], ['Lea', 3]])
      expect(listEmployees(db, 1, today, 'admin').map(e => e.id)).toEqual([anna, ben])
      const newFacility = addFacility(db, 'Hort')
      const first = createEmployee(db, leitungA, newFacility, { name: 'Tom', shortName: 'TO', weeklyMinutes: 2340, validFrom: '2026-01-01' })
      expect(loadEmployees(db, newFacility).map(e => [e.id, e.sortOrder])).toEqual([[first, 1]])
      expect(lea).toBeGreaterThan(0)
    })
  })

  describe('plans, releases, templates, balances and overviews (Task 4)', () => {
    const special = (start = 480) => ({ kind: 'special' as const, start, end: 720 })
    const fillBoth = (start = 480, day = date) => {
      applyToCells(db, leitungA, 1, [{ employeeId: anna, date: day }], 'replace', special(start))
      applyToCells(db, leitungB, facility2, [{ employeeId: kim, date: day }], 'replace', special(start))
    }

    it('month plan and warnings only show the facility\'s people', () => {
      const plan = getMonthPlan(db, leitungA, 1, 2026, 10, today)
      expect(plan.employees.map(e => e.name)).toEqual(['Anna'])
      expect(plan.admin!.warnings.some(w => w.type === 'missing_entry' && w.employeeId === anna)).toBe(true)
      expect(plan.admin!.warnings.some(w => w.type === 'missing_entry' && w.employeeId === kim)).toBe(false)
      expect(plan.admin!.balances.map(b => b.name)).toEqual(['Anna'])
      expect(plan.admin!.weeks[0]!.totals.map(t => t.employeeId)).toEqual([anna])
      const other = getMonthPlan(db, leitungB, facility2, 2026, 10, today)
      expect(other.employees.map(e => e.name)).toEqual(['Kim'])
      // With several facilities the plan (and its printout) names its facility.
      expect(plan.facilityName).toBe('Kindergarten')
      expect(other.facilityName).toBe('Krippe')
      expect(other.templates.every(t => t.id !== templateId(db, 'M'))).toBe(true)
    })

    it('releases are per facility', () => {
      fillBoth()
      releaseMonth(db, leitungA, 1, 2026, 10, new Date('2026-10-01T08:00:00Z'))
      expect(isMonthReleased(db, 1, date)).toBe(true)
      expect(isMonthReleased(db, facility2, date)).toBe(false)
      expect(loadReleases(db, facility2, 2026, 10)).toEqual([])
      expect(loadReleases(db, 1, 2026, 10)[0]!.data.employees.map(e => e.name)).toEqual(['Anna'])
      const kimAccount = addUser(db, 'kim', 'observer', kim)
      expect(errorCode(() => getMyPlan(db, kimAccount, 2026, 10, today))).toBe('month_not_released')

      fillBoth(540)
      expect(releaseMonth(db, leitungA, 1, 2026, 10, new Date('2026-10-02T08:00:00Z'))).toEqual({ notified: ['Anna'] })
      expect(db.select().from(notifications).all().map(n => n.employeeId)).toEqual([anna])
      expect(releaseNotificationStatus(db, 1, 2026, 10).map(s => s.name)).toEqual(['Anna'])
      expect(releaseNotificationStatus(db, facility2, 2026, 10)).toEqual([])

      releaseMonth(db, leitungB, facility2, 2026, 10, new Date('2026-10-02T08:00:00Z'))
      expect(releaseNotificationStatus(db, facility2, 2026, 10)).toEqual([])
      const mine = getMyPlan(db, kimAccount, 2026, 10, today)
      expect(mine.days.find(day => day.date === date)!.entries.map(e => e.start)).toEqual([540])
      expect(getMonthPlan(db, kimAccount, facility2, 2026, 10, today).employees.map(e => e.name)).toEqual(['Kim'])
    })

    it('backfills snapshots per facility', () => {
      fillBoth()
      db.insert(monthPlans).values([
        { facilityId: 1, year: 2026, month: 10, releasedAt: '2026-10-01T08:00:00.000Z' },
        { facilityId: facility2, year: 2026, month: 10, releasedAt: '2026-10-01T08:00:00.000Z' },
      ]).run()
      expect(backfillSnapshots(db)).toBe(2)
      expect(loadReleases(db, 1, 2026, 10).map(r => r.data.employees.map(e => e.name))).toEqual([['Anna']])
      expect(loadReleases(db, facility2, 2026, 10).map(r => r.data.employees.map(e => e.name))).toEqual([['Kim']])
      expect(backfillSnapshots(db)).toBe(0)
    })

    it('reverts only within the facility', () => {
      fillBoth()
      setDayNote(db, leitungB, facility2, date, 'info1', 'Fototag')
      releaseMonth(db, leitungA, 1, 2026, 10)
      expect(errorCode(() => revertToRelease(db, leitungB, facility2, 2026, 10, [cellKey(kim, date)]))).toBe('month_not_released')
      releaseMonth(db, leitungB, facility2, 2026, 10)
      // Another facility's employee is skipped: nothing of theirs is deleted.
      expect(revertToRelease(db, leitungB, facility2, 2026, 10, [cellKey(anna, date)])).toBe(0)
      expect(loadEntries(db, { employeeId: anna })).toHaveLength(1)
      setDayNote(db, leitungA, 1, date, 'info1', 'Ausflug')
      revertToRelease(db, leitungA, 1, 2026, 10, [noteKey('info1', date)])
      const notes = db.select().from(dayNotes).where(eq(dayNotes.date, date)).all()
      expect(notes.map(note => [note.facilityId, note.info1]).sort()).toEqual([[1, ''], [facility2, 'Fototag']])
    })

    it('week template names are unique per facility only', () => {
      const week = '2026-10-05'
      fillBoth(480, week)
      const a = saveWeekTemplate(db, 1, { name: 'Woche A', weekStart: week })
      const b = saveWeekTemplate(db, facility2, { name: 'Woche A', weekStart: week })
      expect(a.id).not.toBe(b.id)
      expect(a.rows.map(row => row.name)).toEqual(['Anna'])
      expect(b.rows.map(row => row.name)).toEqual(['Kim'])
      expect(listWeekTemplates(db, 1).map(t => t.id)).toEqual([a.id])
      expect(listWeekTemplates(db, facility2).map(t => t.id)).toEqual([b.id])
      expect(db.select().from(weekTemplateMarks).all().map(m => [m.facilityId, m.weekTemplateId]))
        .toEqual([[1, a.id], [facility2, b.id]])
      expect(weekTemplateNames(db, facility2, week, week).get(week)).toEqual({ 0: 'Woche A' })
      expect(errorCode(() => renameWeekTemplate(db, 1, b.id, 'Woche B'))).toBe('week_template_not_found')
      expect(errorCode(() => deleteWeekTemplate(db, 1, b.id))).toBe('week_template_not_found')
      expect(errorCode(() => applyWeekTemplate(db, leitungA, 1, b.id, '2026-10-12'))).toBe('week_template_not_found')
      saveWeekTemplate(db, 1, { name: 'Woche B', weekStart: week })
      expect(errorCode(() => renameWeekTemplate(db, 1, a.id, 'Woche B'))).toBe('name_taken')
      renameWeekTemplate(db, facility2, b.id, 'Woche B')
      expect(applyWeekTemplate(db, leitungB, facility2, b.id, '2026-10-12')).toEqual({ filled: 1, skipped: 0 })
      expect(weekTemplateNames(db, 1, '2026-10-12', '2026-10-12').size).toBe(0)
    })

    it('balances, calendar, sick days, leave overview and level-ups list only the facility\'s people', () => {
      const sick = { kind: 'code' as const, codeId: codeId(db, 'sick') }
      applyToCells(db, leitungA, 1, [{ employeeId: anna, date }], 'replace', sick)
      applyToCells(db, leitungB, facility2, [{ employeeId: kim, date }], 'replace', sick)
      expect(getBalanceOverview(db, 1, 2026, 10, today).map(b => b.name)).toEqual(['Anna'])
      expect(getBalanceOverview(db, facility2, 2026, 10, today).map(b => b.name)).toEqual(['Kim'])
      const calendar = getYearCalendar(db, 1, 2026)
      expect(calendar.employees.map(e => e.name)).toEqual(['Anna'])
      expect(Object.keys(calendar.days).map(Number)).toEqual([anna])
      expect(calendar.days[anna]![date]).toBe('sick')
      expect(getStaffYearCalendar(db, facility2, 2026, kim).employees.map(e => e.name)).toEqual(['Kim'])
      expect(getSickYear(db, 1, 2026).map(row => [row.name, row.total])).toEqual([['Anna', 1]])
      expect(getSickYear(db, facility2, 2026).map(row => [row.name, row.total])).toEqual([['Kim', 1]])
      expect(getLeaveOverview(db, 1, 2026, today).map(account => account.name)).toEqual(['Anna'])
      expect(getLeaveOverview(db, facility2, 2026, today).map(account => account.name)).toEqual(['Kim'])
      const contract = {
        personnelNumber: null, jobKey: 'educator' as const, jobOther: null, payGroup: 'S 8a' as const,
        employedSince: '2022-11-01', payLevel: 2,
      }
      setContract(db, 1, anna, contract)
      setContract(db, facility2, kim, contract)
      expect(listLevelUps(db, 1, today, 'provider').map(due => due.name)).toEqual(['Anna'])
      expect(listLevelUps(db, facility2, today, 'provider').map(due => due.name)).toEqual(['Kim'])
    })

    it('calendar events stay in their facility', () => {
      const input = { date, start: null, end: null, title: 'Elternabend', visibleToStaff: true }
      const other = createCalendarEvent(db, facility2, input)
      expect(other).toEqual({ id: other.id, ...input })
      expect(errorCode(() => updateCalendarEvent(db, 1, other.id, { ...input, title: 'Laternenfest' }))).toBe('event_not_found')
      deleteCalendarEvent(db, 1, other.id)
      expect(listCalendarEvents(db, 1, 2026)).toEqual([])
      expect(getYearCalendar(db, 1, 2026).events).toEqual([])
      expect(listCalendarEvents(db, facility2, 2026).map(e => e.title)).toEqual(['Elternabend'])
      expect(getStaffYearCalendar(db, facility2, 2026, kim).events.map(e => e.title)).toEqual(['Elternabend'])
      updateCalendarEvent(db, facility2, other.id, { ...input, title: 'Laternenfest' })
      deleteCalendarEvent(db, facility2, other.id)
      expect(listCalendarEvents(db, facility2, 2026)).toEqual([])
    })
  })

  describe('time tracking, tablet, own pages and leave requests (Task 5)', () => {
    const morning = new Date('2026-10-06T06:00:00Z') // 08:00 Berlin
    const later = new Date('2026-10-08T10:00:00Z')
    const pinFailed = (id: number) => db.select().from(employees).where(eq(employees.id, id)).get()!.pinFailed
    beforeEach(() => {
      setTimeTrackingFrom(db, 1, '2026-10-01')
      setTimeTrackingFrom(db, facility2, '2026-10-01')
      setPin(db, 1, anna, '1234')
      setPin(db, facility2, kim, '1234')
    })

    it('the tablet lists and stamps only its own facility', () => {
      expect(terminalStatus(db, facility2, morning).map(p => p.name)).toEqual(['Kim'])
      expect(terminalStatus(db, 1, morning).map(p => p.name)).toEqual(['Anna'])
      expect(errorCode(() => terminalStamp(db, facility2, anna, '1234', 'in', morning))).toBe('employee_not_found')
      expect(errorCode(() => terminalStamp(db, facility2, anna, '0000', 'in', morning))).toBe('employee_not_found')
      expect(pinFailed(anna)).toBe(0)
      expect(loadTimeRecords(db, { employeeId: anna })).toEqual([])
      expect(terminalStamp(db, facility2, kim, '1234', 'in', morning).employeeId).toBe(kim)
    })

    it('PINs are set and cleared only for the facility\'s employees', () => {
      expect(errorCode(() => setPin(db, 1, kim, '9999'))).toBe('employee_not_found')
      expect(errorCode(() => clearPin(db, 1, kim))).toBe('employee_not_found')
      expect(terminalStatus(db, facility2, morning).map(p => p.name)).toEqual(['Kim'])
    })

    it('time records stay in their facility', () => {
      stamp(db, anna, 'in', 'self', morning)
      stamp(db, kim, 'in', 'self', morning)
      expect(listOpenRecords(db, facility2, '2026-10-08').map(r => r.name)).toEqual(['Kim'])
      expect(listOpenRecords(db, 1, '2026-10-08').map(r => r.name)).toEqual(['Anna'])
      const [kimRecord] = loadTimeRecords(db, { employeeId: kim })
      const span = { start: kimRecord!.start, end: 900 }
      expect(errorCode(() => updateRecord(db, leitungA, 1, kimRecord!.id, span, later))).toBe('record_not_found')
      expect(errorCode(() => deleteRecord(db, leitungA, 1, kimRecord!.id, later))).toBe('record_not_found')
      const input = { employeeId: kim, date: '2026-10-07', start: 480, end: 600 }
      expect(errorCode(() => createRecord(db, leitungA, 1, input, later))).toBe('employee_not_found')
      expect(errorCode(() => setTimeDayNote(db, 1, kim, date, 'Arzt'))).toBe('employee_not_found')
      expect(errorCode(() => getTimeMonth(db, 1, kim, 2026, 10, today))).toBe('employee_not_found')
      updateRecord(db, leitungB, facility2, kimRecord!.id, span, later)
      createRecord(db, leitungB, facility2, input, later)
      setTimeDayNote(db, facility2, kim, date, 'Arzt')
      const month = getTimeMonth(db, facility2, kim, 2026, 10, '2026-10-08')
      expect(month.days.find(d => d.date === date)!.note).toBe('Arzt')
      deleteRecord(db, leitungB, facility2, kimRecord!.id, later)
      expect(loadTimeRecords(db, { employeeId: kim })).toHaveLength(1)
    })

    it('stamping uses the employee\'s own tracking start', () => {
      setTimeTrackingFrom(db, facility2, null)
      expect(stamp(db, anna, 'in', 'self', morning).employeeId).toBe(anna)
      expect(errorCode(() => stamp(db, kim, 'in', 'self', morning))).toBe('time_tracking_off')
      expect(errorCode(() => terminalStamp(db, facility2, kim, '1234', 'in', morning))).toBe('time_tracking_off')
      const kimAccount = addUser(db, 'kim', 'observer', kim)
      expect(getMyTime(db, kimAccount, 2026, 10, morning).enabled).toBe(false)
      expect(getMyTime(db, addUser(db, 'anna', 'observer', anna), 2026, 10, morning).enabled).toBe(true)
    })

    it('the own calendar is the one of the employee\'s facility', () => {
      const input = { date, start: null, end: null, title: 'Elternabend', visibleToStaff: true }
      createCalendarEvent(db, facility2, input)
      const kimAccount = addUser(db, 'kim', 'observer', kim)
      expect(getMyYearCalendar(db, kimAccount, 2026).employees.map(e => e.name)).toEqual(['Kim'])
      expect(getMyYearCalendar(db, kimAccount, 2026).events.map(e => e.title)).toEqual(['Elternabend'])
      expect(errorCode(() => getMyYearCalendar(db, leitungA, 2026))).toBe('no_employee')
    })

    it('leave planning, limit and counting are per facility', () => {
      const traeger = addUser(db, 'traeger', 'provider')
      setLeaveModule(db, { enabled: true, plannerIds: [leitungA.id, leitungB.id] })
      const lea = addEmployee(db, 'Lea', { facilityId: facility2 })
      const annaAccount = addUser(db, 'anna', 'observer', anna)
      const kimAccount = addUser(db, 'kim', 'observer', kim)
      const leaAccount = addUser(db, 'lea', 'observer', lea)

      // Limits are kept separately.
      setMaxConcurrent(db, leitungA, 1, 1)
      setMaxConcurrent(db, leitungB, facility2, 2)
      expect([maxConcurrent(db, 1), maxConcurrent(db, facility2)]).toEqual([1, 2])
      expect(errorCode(() => setMaxConcurrent(db, leitungB, 1, 5))).toBe('not_leave_planner')
      expect(getLeaveSettings(db, annaAccount).maxConcurrent).toBe(1)
      expect(getLeaveSettings(db, kimAccount).maxConcurrent).toBe(2)

      // A Leitung plans only for its own facility; the Träger plans everywhere.
      expect(isPlanner(db, leitungB, facility2)).toBe(true)
      expect(isPlanner(db, leitungB, 1)).toBe(false)
      expect(isPlanner(db, leitungA, facility2)).toBe(false)
      expect([isPlanner(db, traeger, 1), isPlanner(db, traeger, facility2)]).toEqual([true, true])
      expect(errorCode(() => getLeavePlanning(db, leitungB, 1, 2026))).toBe('not_leave_planner')

      // Requests and the load are counted per facility: Anna's leave and Kim's request do not add up.
      const vacation = { kind: 'code' as const, codeId: codeId(db, 'vacation') }
      applyToCells(db, leitungA, 1, [{ employeeId: anna, date: '2026-11-03' }], 'replace', vacation)
      const kimRequest = createLeaveRequest(db, kimAccount, { from: '2026-11-03', to: '2026-11-03', note: '' }, today)
      expect(previewLeaveRequest(db, leaAccount, '2026-11-03', '2026-11-03', today).overLimitDates).toEqual([])
      expect(previewLeaveRequest(db, annaAccount, '2026-11-02', '2026-11-04', today).overLimitDates).toEqual([])
      createLeaveRequest(db, annaAccount, { from: '2026-11-04', to: '2026-11-04', note: '' }, today)
      expect(listOpenRequests(db, leitungA, 1).map(r => r.name)).toEqual(['Anna'])
      expect(listOpenRequests(db, leitungB, facility2).map(r => r.name)).toEqual(['Kim'])
      expect(getLeaveSettings(db, leitungA)).toMatchObject({ isPlanner: true, openCount: 1 })
      expect(getLeaveSettings(db, leitungB)).toMatchObject({ isPlanner: true, openCount: 1 })
      const planning = getLeavePlanning(db, leitungA, 1, 2026)
      expect(planning.counts['2026-11-03']).toBe(1)
      expect(planning.maxConcurrent).toBe(1)
      expect(planning.openRequests.map(r => r.name)).toEqual(['Anna'])
      expect(getLeavePlanning(db, leitungB, facility2, 2026).counts['2026-11-03']).toBe(1)

      // Deciding happens in the requesting employee's facility.
      const decision = { approve: false, note: '', overwrite: false }
      expect(errorCode(() => decideLeaveRequest(db, leitungA, 1, kimRequest, decision))).toBe('leave_request_not_found')
      expect(errorCode(() => decideLeaveRequest(db, traeger, 1, kimRequest, decision))).toBe('leave_request_not_found')
      decideLeaveRequest(db, leitungB, facility2, kimRequest, decision)
      expect(listMyLeaveRequests(db, kimAccount)[0]!.status).toBe('rejected')
    })

    it('only Träger and Leitung accounts can be leave planners', () => {
      const tablet = addUser(db, 'tablet', 'terminal')
      expect(errorCode(() => setLeaveModule(db, { enabled: true, plannerIds: [tablet.id] }))).toBe('invalid_leave_planner')
      setLeaveModule(db, { enabled: true, plannerIds: [leitungB.id] })
      expect(getLeaveSettings(db, leitungB).plannerIds).toEqual([leitungB.id])
    })
  })

  describe('mandatory facility filter (Task 8)', () => {
    it('every admin list is empty in a fresh facility', () => {
      // Real data in facilities 1 and 2, so an unfiltered query would show something.
      const traeger = addUser(db, 'traeger', 'provider')
      setLeaveModule(db, { enabled: true, plannerIds: [traeger.id] })
      setTimeTrackingFrom(db, 1, '2026-10-01')
      setTimeTrackingFrom(db, facility2, '2026-10-01')
      const annaAccount = addUser(db, 'anna', 'observer', anna)
      const kimAccount = addUser(db, 'kim', 'observer', kim)
      createClosure(db, leitungA, 1, { startDate: '2026-12-24', endDate: '2026-12-24', label: 'Heiligabend', mode: 'closure_day' })
      createEarlyClosure(db, 1, { date, closedFrom: 780, reason: 'Wasserschaden' })
      createCalendarEvent(db, facility2, { date, start: null, end: null, title: 'Elternabend', visibleToStaff: true })
      for (const [actor, facility, employeeId] of [[leitungA, 1, anna], [leitungB, facility2, kim]] as const) {
        applyToCells(db, actor, facility, [{ employeeId, date }], 'replace', { kind: 'special', start: 480, end: 720 })
        applyToCells(db, actor, facility, [{ employeeId, date: '2026-10-07' }], 'replace', { kind: 'code', codeId: codeId(db, 'sick') })
        saveWeekTemplate(db, facility, { name: 'Woche A', weekStart: '2026-10-05' })
        stamp(db, employeeId, 'in', 'self', new Date('2026-10-06T06:00:00Z'))
      }
      createLeaveRequest(db, annaAccount, { from: '2026-11-03', to: '2026-11-03', note: '' }, today)
      createLeaveRequest(db, kimAccount, { from: '2026-11-03', to: '2026-11-03', note: '' }, today)
      expect(listOpenRequests(db, traeger, 1).map(r => r.name)).toEqual(['Anna'])
      expect(listOpenRecords(db, 1, '2026-10-08').map(r => r.name)).toEqual(['Anna'])

      const fresh = addFacility(db, 'Hort')
      expect(listEmployees(db, fresh, today, 'admin')).toEqual([])
      expect(loadEmployees(db, fresh)).toEqual([])
      expect(listClosures(db, fresh)).toEqual([])
      expect(listEarlyClosures(db, fresh, 2026)).toEqual([])
      expect(listCalendarEvents(db, fresh, 2026)).toEqual([])
      expect(listWeekTemplates(db, fresh)).toEqual([])
      expect(listOpenRecords(db, fresh, '2026-10-08')).toEqual([])
      expect(listOpenRequests(db, traeger, fresh)).toEqual([])
      expect(getSickYear(db, fresh, 2026)).toEqual([])
      expect(getBalanceOverview(db, fresh, 2026, 10, today)).toEqual([])
      expect(getLeaveOverview(db, fresh, 2026, today)).toEqual([])
      expect(listLevelUps(db, fresh, today, 'provider')).toEqual([])
      expect(getStaffYearCalendar(db, fresh, 2026, null).employees).toEqual([])
      expect(getYearCalendar(db, fresh, 2026).employees).toEqual([])
      expect(getYearCalendar(db, fresh, 2026).events).toEqual([])
      expect(getLeavePlanning(db, traeger, fresh, 2026).openRequests).toEqual([])

      // Only the copied templates and coverage rules are there, and they are the fresh facility's own rows.
      const settings = getSettings(db, fresh)
      const first = getSettings(db, 1)
      const content = <T extends { id: number }>(list: T[]) =>
        list.map(({ id: _id, facilityId: _facility, ...rest }: T & { facilityId?: number }) => rest)
      const ownRows = (list: object[]) => list.map(row => (row as { facilityId: number }).facilityId)
      expect(settings.templates.length).toBeGreaterThan(0)
      expect(content(settings.templates)).toEqual(content(first.templates))
      expect(new Set(ownRows(settings.templates))).toEqual(new Set([fresh]))
      expect(settings.templates.map(t => t.id)).not.toEqual(first.templates.map(t => t.id))
      expect(content(settings.coverageRules)).toEqual(content(first.coverageRules))
      expect(new Set(ownRows(settings.coverageRules))).toEqual(new Set([fresh]))
      expect(db.select().from(shiftTemplates).where(eq(shiftTemplates.facilityId, fresh)).all()).toHaveLength(settings.templates.length)
    })

    it('create functions write the given facility', () => {
      const lea = createEmployee(db, leitungB, facility2, { name: 'Lea', shortName: 'LE', weeklyMinutes: 2340, validFrom: '2026-01-01' })
      expect(db.select().from(employees).where(eq(employees.id, lea)).get()!.facilityId).toBe(facility2)

      const closure = createClosure(db, leitungB, facility2, { startDate: date, endDate: date, label: 'Ausflug', mode: 'closure_day' })
      expect(db.select().from(closures).where(eq(closures.id, closure.id)).get()!.facilityId).toBe(facility2)

      const early = createEarlyClosure(db, facility2, { date, closedFrom: 780, reason: 'Wasserschaden' })
      expect(db.select().from(earlyClosures).where(eq(earlyClosures.id, early.id)).get()!.facilityId).toBe(facility2)

      const event = createCalendarEvent(db, facility2, { date, start: null, end: null, title: 'Elternabend', visibleToStaff: true })
      expect(db.select().from(calendarEvents).where(eq(calendarEvents.id, event.id)).get()!.facilityId).toBe(facility2)

      const template = createTemplate(db, facility2, {
        shortLabel: 'X1', label: 'Sonderdienst', start: 480, end: 720, breakStart: null, breakEnd: null,
        countsAsStaff: true, pairsWithPrepTime: false, sortOrder: 99,
      })
      expect(db.select().from(shiftTemplates).where(eq(shiftTemplates.id, template.id)).get()!.facilityId).toBe(facility2)

      const rule = createCoverageRule(db, facility2, { label: 'Spätdienst', start: 900, end: 960, minCount: 1, active: true })
      expect(db.select().from(coverageRules).where(eq(coverageRules.id, rule.id)).get()!.facilityId).toBe(facility2)

      applyToCells(db, leitungB, facility2, [{ employeeId: kim, date }], 'replace', { kind: 'special', start: 480, end: 720 })
      const week = saveWeekTemplate(db, facility2, { name: 'Woche A', weekStart: '2026-10-05' })
      expect(db.select().from(weekTemplates).where(eq(weekTemplates.id, week.id)).get()!.facilityId).toBe(facility2)

      setDayNote(db, leitungB, facility2, date, 'info1', 'Elternabend')
      expect(db.select().from(dayNotes).all().map(note => [note.facilityId, note.info1])).toEqual([[facility2, 'Elternabend']])
    })

    describe('duty-change messages', () => {
      const at = (iso: string) => new Date(iso)
      let kimAccount: SessionUser
      let annaAccount: SessionUser
      const shift = (actor: SessionUser, facility: number, employeeId: number, label: string) =>
        applyToCells(db, actor, facility, [{ employeeId, date: '2026-11-03' }], 'replace', { kind: 'shift', templateId: templateId(db, label, facility) })
      beforeEach(() => {
        kimAccount = addUser(db, 'kim', 'observer', kim)
        annaAccount = addUser(db, 'anna', 'observer', anna)
      })

      it('notifyDutyChanges only tells the employees of the given facility', () => {
        shift(leitungA, 1, anna, 'F1')
        shift(leitungB, facility2, kim, 'F1')
        const merge = () => {
          const one = buildSnapshot(db, 1, 2026, 11)
          const two = buildSnapshot(db, facility2, 2026, 11)
          return { employees: [...one.employees, ...two.employees], entries: [...one.entries, ...two.entries], days: one.days }
        }
        const before = merge()
        shift(leitungA, 1, anna, 'F2')
        shift(leitungB, facility2, kim, 'F2')
        const after = merge()
        // A snapshot that (wrongly) contains both facilities still only notifies the facility being released.
        expect(notifyDutyChanges(db, 1, 2026, 11, before, after, '2026-10-21T08:00:00.000Z')).toEqual([anna])
        expect(listNotifications(db, anna, at('2026-10-21T09:00:00Z'))).toHaveLength(1)
        expect(listNotifications(db, kim, at('2026-10-21T09:00:00Z'))).toEqual([])
        expect(notifyDutyChanges(db, facility2, 2026, 11, before, after, '2026-10-21T08:00:00.000Z')).toEqual([kim])
        expect(listNotifications(db, kim, at('2026-10-21T09:00:00Z'))).toHaveLength(1)
        expect(listNotifications(db, anna, at('2026-10-21T09:00:00Z'))).toHaveLength(1)
      })

      it('re-releasing a changed plan in one facility notifies nobody in the other', () => {
        shift(leitungA, 1, anna, 'F1')
        shift(leitungB, facility2, kim, 'F1')
        releaseMonth(db, leitungA, 1, 2026, 11, at('2026-10-20T08:00:00Z'))
        releaseMonth(db, leitungB, facility2, 2026, 11, at('2026-10-20T08:00:00Z'))
        shift(leitungA, 1, anna, 'F2')
        shift(leitungB, facility2, kim, 'F2')
        expect(releaseMonth(db, leitungA, 1, 2026, 11, at('2026-10-21T08:00:00Z'))).toEqual({ notified: ['Anna'] })
        expect(listNotifications(db, kim, at('2026-10-21T09:00:00Z'))).toEqual([])
        expect(releaseMonth(db, leitungB, facility2, 2026, 11, at('2026-10-21T08:00:00Z'))).toEqual({ notified: ['Kim'] })
        expect(listNotifications(db, kim, at('2026-10-21T09:00:00Z'))).toHaveLength(1)
        expect(annaAccount.employeeId).toBe(anna)
        expect(kimAccount.employeeId).toBe(kim)
      })
    })
  })
  describe('moving an employee to another facility (final review)', () => {
    const sept = (day: number) => `2026-09-${String(day).padStart(2, '0')}`
    const moveDay = new Date('2026-10-05T08:00:00Z') // today
    const earlier = new Date('2026-07-01T08:00:00Z')
    const special = { kind: 'special' as const, start: 480, end: 720 }
    const vacation = () => ({ kind: 'code' as const, codeId: codeId(db, 'vacation') })
    const cellsOf = (employeeId: number) => loadEntries(db, { employeeId }).map(entry => [entry.date, entry.codeKey ?? entry.kind])
    let lena: number
    let provider: SessionUser
    beforeEach(() => {
      // Lena works in facility 1 (A) and has a duty and a leave day in September, which both facilities released.
      lena = addEmployee(db, 'Lena')
      provider = addUser(db, 'traeger', 'provider')
      applyToCells(db, leitungA, 1, [{ employeeId: lena, date: sept(7) }], 'replace', special)
      applyToCells(db, leitungA, 1, [{ employeeId: lena, date: sept(8) }], 'replace', vacation())
      applyToCells(db, leitungB, facility2, [{ employeeId: kim, date: sept(7) }], 'replace', special)
      releaseMonth(db, leitungA, 1, 2026, 9, new Date('2026-08-25T08:00:00Z'))
      releaseMonth(db, leitungB, facility2, 2026, 9, new Date('2026-08-25T08:00:00Z'))
    })

    it('the old facility shows no pending changes for someone who moved out, and a discard skips their cells', () => {
      moveEmployeeToFacility(db, provider, lena, facility2, moveDay)
      const plan = getMonthPlan(db, leitungA, 1, 2026, 9, today)
      expect(plan.admin!.pendingChanges).toEqual({})
      expect(plan.release.pendingCount).toBe(0)
      // The discard dialog can still name people who are only in the release.
      expect(plan.admin!.releasedEmployees.map(e => e.name)).toEqual(['Anna', 'Lena'])

      setDayNote(db, leitungA, 1, sept(7), 'info1', 'Ausflug')
      const keys = [cellKey(lena, sept(7)), cellKey(lena, sept(8)), noteKey('info1', sept(7))]
      expect(revertToRelease(db, leitungA, 1, 2026, 9, keys)).toBe(1)
      expect(cellsOf(lena)).toEqual([[sept(7), 'special'], [sept(8), 'vacation']])
      expect(db.select().from(dayNotes).where(eq(dayNotes.facilityId, 1)).all().map(note => note.info1)).toEqual([''])
    })

    it('the new facility never shows entries from before the move as pending, and a discard never deletes them', () => {
      const lenaAccount = addUser(db, 'lena', 'observer', lena)
      moveEmployeeToFacility(db, provider, lena, facility2, moveDay)
      const plan = getMonthPlan(db, leitungB, facility2, 2026, 9, today)
      expect(plan.employees.map(e => e.name)).toEqual(['Kim', 'Lena'])
      expect(plan.admin!.pendingChanges).toEqual({})
      expect(revertToRelease(db, leitungB, facility2, 2026, 9, [cellKey(lena, sept(7)), cellKey(lena, sept(8))])).toBe(0)
      expect(cellsOf(lena)).toEqual([[sept(7), 'special'], [sept(8), 'vacation']])
      // Releasing again takes Lena's history into the new facility's plan without telling her it changed.
      expect(releaseMonth(db, leitungB, facility2, 2026, 9, new Date('2026-10-05T09:00:00Z'))).toEqual({ notified: [] })
      expect(listNotifications(db, lena, moveDay)).toEqual([])
      expect(getMyPlan(db, lenaAccount, 2026, 9, today).days.find(day => day.date === sept(7))!.entries).toHaveLength(1)
    })

    it('entries from the move day on count as pending in the new facility, like those of a new employee', () => {
      applyToCells(db, leitungA, 1, [{ employeeId: lena, date: '2026-10-02' }, { employeeId: lena, date: '2026-10-07' }], 'replace', special)
      releaseMonth(db, leitungB, facility2, 2026, 10, new Date('2026-10-01T08:00:00Z'))
      const nora = addEmployee(db, 'Nora', { facilityId: facility2 })
      applyToCells(db, leitungB, facility2, [{ employeeId: nora, date: '2026-10-08' }], 'replace', special)
      moveEmployeeToFacility(db, provider, lena, facility2, moveDay)

      const pending = getMonthPlan(db, leitungB, facility2, 2026, 10, today).admin!.pendingChanges
      expect(Object.keys(pending).sort()).toEqual([cellKey(lena, '2026-10-07'), cellKey(nora, '2026-10-08')].sort())
      const keys = [cellKey(lena, '2026-10-02'), cellKey(lena, '2026-10-07'), cellKey(nora, '2026-10-08')]
      expect(revertToRelease(db, leitungB, facility2, 2026, 10, keys)).toBe(2)
      expect(cellsOf(lena)).toEqual([[sept(7), 'special'], [sept(8), 'vacation'], ['2026-10-02', 'special']])
      expect(cellsOf(nora)).toEqual([])
    })

    it('drops the old facility\'s closures from today on and books the new facility\'s', () => {
      const closure = (label: string, startDate: string, endDate: string, mode: 'vacation' | 'closure_day' = 'vacation') =>
        ({ startDate, endDate, label, mode })
      const pastA = createClosure(db, leitungA, 1, closure('Sommer A', '2026-08-03', '2026-08-04'), earlier)
      const futureA = createClosure(db, leitungA, 1, closure('Herbst A', '2026-10-05', '2026-10-06'), earlier)
      createClosure(db, leitungB, facility2, closure('Sommer B', '2026-08-10', '2026-08-10'), earlier)
      const futureB = createClosure(db, leitungB, facility2, closure('Herbst B', '2026-11-02', '2026-11-03', 'closure_day'), earlier)
      expect(loadEntries(db, { closureId: futureA.id }).map(entry => entry.employeeId)).toContain(lena)

      moveEmployeeToFacility(db, provider, lena, facility2, moveDay)
      const closureCells = db.select({ date: entries.date, closureId: entries.closureId }).from(entries)
        .where(eq(entries.employeeId, lena)).all().filter(row => row.closureId !== null)
        .map(row => [row.date, row.closureId]).sort()
      expect(closureCells).toEqual([
        ['2026-08-03', pastA.id], ['2026-08-04', pastA.id], ['2026-11-02', futureB.id], ['2026-11-03', futureB.id],
      ])
      expect(cellsOf(lena).filter(([day]) => day! >= '2026-10-01'))
        .toEqual([['2026-11-02', 'closure_day'], ['2026-11-03', 'closure_day']])
      // Anna stays in facility 1 and keeps its closure.
      expect(loadEntries(db, { closureId: futureA.id }).map(entry => entry.employeeId)).toEqual([anna, anna])
    })

    it('a joiner of this year moved into a facility with a closure never goes below zero leave', () => {
      const jo = addEmployee(db, 'Jo', { validFrom: '2026-03-01' })
      setEntitlement(db, 1, jo, 2026, { days: 2, carriedOverDays: 0 })
      applyToCells(db, leitungA, 1, [{ employeeId: jo, date: '2026-09-14' }], 'replace', vacation())
      createClosure(db, leitungB, facility2, { startDate: '2026-11-02', endDate: '2026-11-03', label: 'Herbst B', mode: 'vacation' }, earlier)
      moveEmployeeToFacility(db, provider, jo, facility2, moveDay)
      expect(cellsOf(jo)).toEqual([['2026-09-14', 'vacation'], ['2026-11-02', 'vacation'], ['2026-11-03', 'closure_day']])
    })

    it('a linked Leitung account follows the moved employee', () => {
      const lenaLeitung = addUser(db, 'lena', 'admin', lena)
      moveEmployeeToFacility(db, provider, lena, facility2, moveDay)
      expect(getActiveUser(db, lenaLeitung.id)!.facilityId).toBe(facility2)
      expect(getActiveUser(db, leitungA.id)!.facilityId).toBe(1)
    })

    it('moving to the facility the employee is already in changes nothing', () => {
      const before = db.select().from(employees).where(eq(employees.id, lena)).get()
      moveEmployeeToFacility(db, provider, lena, 1, moveDay)
      expect(db.select().from(employees).where(eq(employees.id, lena)).get()).toEqual(before)
    })
  })

  describe('help-outs stay between the two facilities involved (Aushelfen)', () => {
    // Anna (home facility A = 1) helps out in Krippe (B = facility2); Hort (C) has nothing to do with it.
    const morning = new Date('2026-10-06T06:00:00Z') // 08:00 Berlin
    let hort: number
    let leitungC: SessionUser
    let helpOutId: number
    let helperEntryId: number
    beforeEach(() => {
      hort = addFacility(db, 'Hort')
      leitungC = addUser(db, 'leitungC', 'admin', null, hort)
      helpOutId = addHelpOut(db, anna, facility2, 2026, 10)
      applyToCells(db, leitungB, facility2, [{ employeeId: anna, date }], 'replace',
        { kind: 'shift', templateId: templateId(db, 'F1', facility2) })
      helperEntryId = loadEntries(db, { employeeId: anna }).find(entry => entry.helpFacilityId === facility2)!.id
    })

    it('facility C lists neither the helper nor a marker', () => {
      expect(listHelpers(db, facility2, 2026, 10).map(h => h.employeeId)).toEqual([anna])
      expect(listHelpers(db, hort, 2026, 10)).toEqual([])
      const plan = getMonthPlan(db, leitungC, hort, 2026, 10, today)
      expect(plan.employees).toEqual([])
      expect(plan.admin!.helpers).toEqual([])
      expect(plan.admin!.helperBusy).toEqual({})
      expect(plan.entries).toEqual([])
      expect(plan.facilityNames).toEqual({ [hort]: 'Hort' })
      expect(JSON.stringify(plan)).not.toContain('Anna')
      // A and B do show it.
      expect(getMonthPlan(db, leitungB, facility2, 2026, 10, today).admin!.helpers.map(h => h.employeeId)).toEqual([anna])
      const planA = getMonthPlan(db, leitungA, 1, 2026, 10, today)
      expect(planA.entries.filter(entry => entry.employeeId === anna).map(entry => entry.helpFacilityId)).toEqual([facility2])
    })

    it('C cannot remove B\'s help-out', () => {
      expect(errorCode(() => removeHelpOut(db, hort, helpOutId))).toBe('help_out_not_found')
      expect(errorCode(() => removeHelpOut(db, 1, helpOutId))).toBe('help_out_not_found')
      expect(listHelpers(db, facility2, 2026, 10)).toHaveLength(1)
    })

    it('C cannot write the helper\'s cells', () => {
      const shift = { kind: 'shift' as const, templateId: templateId(db, 'M', hort) }
      for (const mode of ['replace', 'add'] as const) {
        expect(errorCode(() => applyToCells(db, leitungC, hort, [{ employeeId: anna, date }], mode, shift)))
          .toBe('employee_not_found')
      }
      expect(errorCode(() => applyToCells(db, leitungC, hort, [{ employeeId: anna, date }], 'clear', null))).toBe('employee_not_found')
      expect(errorCode(() => applyToCells(db, leitungC, hort, [{ employeeId: anna, date: '2026-10-07' }], 'replace', shift)))
        .toBe('employee_not_found')
      expect(loadEntries(db, { employeeId: anna }).map(entry => [entry.id, entry.helpFacilityId])).toEqual([[helperEntryId, facility2]])
    })

    it('C cannot change B\'s entries by id', () => {
      expect(errorCode(() => deleteEntry(db, leitungC, hort, helperEntryId))).toBe('entry_not_found')
      expect(errorCode(() => updateEntryTimes(db, leitungC, hort, helperEntryId, { start: 500, end: 720, breakStart: null, breakEnd: null })))
        .toBe('entry_not_found')
      expect(loadEntries(db, { employeeId: anna }).map(entry => entry.id)).toEqual([helperEntryId])
    })

    it('C\'s candidates name A\'s and B\'s employees and nothing more', () => {
      const candidates = helpCandidates(db, hort, 2026, 10)
      expect(candidates).toEqual([
        { employeeId: anna, name: 'Anna', shortName: expect.any(String), facilityName: 'Kindergarten' },
        { employeeId: kim, name: 'Kim', shortName: expect.any(String), facilityName: 'Krippe' },
      ])
      for (const candidate of candidates) {
        expect(Object.keys(candidate).sort()).toEqual(['employeeId', 'facilityName', 'name', 'shortName'])
      }
      // B already has Anna as a helper, so she is no candidate there; C can still add her for itself.
      expect(helpCandidates(db, facility2, 2026, 10).map(c => c.employeeId)).toEqual([])
      expect(planHelper(db, hort, { employeeId: anna, year: 2026, month: 10 })).toBeGreaterThan(0)
    })

    it('C cannot discard B\'s helper cell, and releasing C tells nobody of A or B', () => {
      const at = (iso: string) => new Date(iso)
      releaseMonth(db, leitungB, facility2, 2026, 10, at('2026-10-01T08:00:00Z'))
      releaseMonth(db, leitungA, 1, 2026, 10, at('2026-10-01T08:00:00Z'))
      releaseMonth(db, leitungC, hort, 2026, 10, at('2026-10-01T08:00:00Z'))
      applyToCells(db, leitungB, facility2, [{ employeeId: anna, date }], 'replace',
        { kind: 'shift', templateId: templateId(db, 'F2', facility2) })
      const before = loadEntries(db, { employeeId: anna })
      expect(revertToRelease(db, leitungC, hort, 2026, 10, [cellKey(anna, date)])).toBe(0)
      expect(loadEntries(db, { employeeId: anna })).toEqual(before)
      const sent = db.select().from(notifications).all().length
      expect(releaseMonth(db, leitungC, hort, 2026, 10, at('2026-10-02T08:00:00Z'))).toEqual({ notified: [] })
      expect(db.select().from(notifications).all()).toHaveLength(sent)
      expect(buildSnapshot(db, hort, 2026, 10).entries).toEqual([])
    })

    it('the tablet of C does not list the helper', () => {
      setTimeTrackingFrom(db, 1, '2026-10-01')
      setTimeTrackingFrom(db, facility2, '2026-10-01')
      setTimeTrackingFrom(db, hort, '2026-10-01')
      setPin(db, 1, anna, '1234')
      expect(terminalStatus(db, facility2, morning).map(p => p.name)).toEqual(['Anna'])
      expect(terminalStatus(db, hort, morning)).toEqual([])
      expect(errorCode(() => terminalStamp(db, hort, anna, '1234', 'in', morning))).toBe('employee_not_found')
    })
  })

  describe('groups stay inside their facility (Gruppen)', () => {
    const day = '2026-10-06'
    const special = { kind: 'special' as const, start: 480, end: 720 }
    const names = ['Bärchen', 'Eulen']
    let mäuse: number
    let bärchen: number
    let eulen: number
    let annaEntryId: number
    let kimEntryId: number
    beforeEach(() => {
      // Both facilities have groups, members, duties, a required duty and a group week template; both released.
      mäuse = addGroup(db, 1, 'Mäuse')
      bärchen = addGroup(db, facility2, names[0]!)
      eulen = addGroup(db, facility2, names[1]!)
      updateEmployee(db, 1, anna, { name: 'Anna', shortName: 'AN', leftOn: null, groupId: mäuse })
      updateEmployee(db, facility2, kim, { name: 'Kim', shortName: 'KI', leftOn: null, groupId: bärchen })
      addEmployee(db, 'Lea', { facilityId: facility2, groupId: eulen })
      applyToCells(db, leitungA, 1, [{ employeeId: anna, date: day }], 'replace', special)
      applyToCells(db, leitungB, facility2, [{ employeeId: kim, date: day }], 'replace', special)
      applyToCells(db, leitungB, facility2, [{ employeeId: kim, date: '2026-10-07' }], 'replace', { ...special, groupId: eulen })
      annaEntryId = loadEntries(db, { employeeId: anna })[0]!.id
      kimEntryId = loadEntries(db, { employeeId: kim }).find(entry => entry.date === '2026-10-07')!.id
      createCoverageRule(db, 1, { label: 'Frühdienst Mäuse', start: 480, end: 720, minCount: 1, active: true, groupId: mäuse })
      createCoverageRule(db, facility2, { label: 'Frühdienst Bärchen', start: 480, end: 720, minCount: 1, active: true, groupId: bärchen })
      saveWeekTemplate(db, 1, { name: 'Woche Mäuse', weekStart: '2026-10-05', groupId: mäuse })
      saveWeekTemplate(db, facility2, { name: 'Woche Bärchen', weekStart: '2026-10-05', groupId: bärchen })
      releaseMonth(db, leitungA, 1, 2026, 10, new Date('2026-10-01T08:00:00Z'))
      releaseMonth(db, leitungB, facility2, 2026, 10, new Date('2026-10-01T08:00:00Z'))
    })

    it('another facility\'s group cannot be used anywhere', () => {
      const groupNotFound = (action: () => unknown) => expect(errorCode(action)).toBe('group_not_found')
      groupNotFound(() => createEmployee(db, leitungA, 1, {
        name: 'Ben', shortName: 'BE', weeklyMinutes: 2340, validFrom: '2026-01-01', groupId: bärchen,
      }))
      groupNotFound(() => updateEmployee(db, 1, anna, { name: 'Anna', shortName: 'AN', leftOn: null, groupId: bärchen }))
      groupNotFound(() => setEntryGroup(db, leitungA, 1, annaEntryId, bärchen))
      groupNotFound(() => applyToCells(db, leitungA, 1, [{ employeeId: anna, date: '2026-10-07' }], 'replace', { ...special, groupId: bärchen }))
      groupNotFound(() => createCoverageRule(db, 1, { label: 'X', start: 480, end: 720, minCount: 1, active: true, groupId: bärchen }))
      const ruleId = getSettings(db, 1).coverageRules.find(rule => rule.groupId === mäuse)!.id
      groupNotFound(() => updateCoverageRule(db, 1, ruleId, { label: 'X', start: 480, end: 720, minCount: 1, active: true, groupId: bärchen }))
      groupNotFound(() => saveWeekTemplate(db, 1, { name: 'Woche X', weekStart: '2026-10-05', groupId: bärchen }))
      groupNotFound(() => renameGroup(db, 1, bärchen, 'Gehackt'))
      groupNotFound(() => deleteGroup(db, 1, bärchen, today))
      // And the other way round, with A's group in facility B.
      groupNotFound(() => setEntryGroup(db, leitungB, facility2, kimEntryId, mäuse))
      groupNotFound(() => renameGroup(db, facility2, mäuse, 'Gehackt'))
      groupNotFound(() => deleteGroup(db, facility2, mäuse, today))

      // Nothing changed.
      expect(listGroups(db, facility2).map(group => group.name)).toEqual(names)
      expect(listGroups(db, 1).map(group => group.name)).toEqual(['Mäuse'])
      expect(getEmployee(db, 1, anna, today, 'admin').groupId).toBe(mäuse)
      expect(loadEntries(db, { employeeId: anna }).map(entry => [entry.id, entry.groupId])).toEqual([[annaEntryId, null]])
      expect(loadEntries(db, { employeeId: kim }).map(entry => [entry.id, entry.groupId])).toEqual([[expect.any(Number), null], [kimEntryId, eulen]])
      expect(getSettings(db, 1).coverageRules.map(rule => rule.groupId)).toContain(mäuse)
      expect(listWeekTemplates(db, 1).map(t => t.name)).toEqual(['Woche Mäuse'])
    })

    it('a group name may be used again in another facility, and A\'s list stays its own', () => {
      expect(createGroup(db, 1, 'Bärchen').name).toBe('Bärchen')
      expect(listGroups(db, facility2).map(group => group.id)).toEqual([bärchen, eulen])
    })

    it('facility A sees none of B\'s group names', () => {
      const annaAccount = addUser(db, 'anna', 'observer', anna)
      for (const name of names) {
        for (const value of [
          listGroups(db, 1),
          listEmployees(db, 1, today, 'admin'),
          getSettings(db, 1),
          listWeekTemplates(db, 1),
          getMonthPlan(db, leitungA, 1, 2026, 10, today),
          getMonthPlan(db, annaAccount, 1, 2026, 10, today),
          buildSnapshot(db, 1, 2026, 10),
          loadReleases(db, 1, 2026, 10),
          getMyPlan(db, annaAccount, 2026, 10, today),
        ]) {
          expect(JSON.stringify(value)).not.toContain(name)
        }
      }
      expect(getMonthPlan(db, leitungA, 1, 2026, 10, today).groups.map(group => group.name)).toEqual(['Mäuse'])
      expect(buildSnapshot(db, 1, 2026, 10).groups!.map(group => group.name)).toEqual(['Mäuse'])
      // The same holds the other way round, and B really has its groups in plan and snapshot.
      expect(getMonthPlan(db, leitungB, facility2, 2026, 10, today).groups.map(group => group.name)).toEqual(names)
      expect(buildSnapshot(db, facility2, 2026, 10).groups!.map(group => group.name)).toEqual(names)
      expect(JSON.stringify(buildSnapshot(db, facility2, 2026, 10))).not.toContain('Mäuse')
      expect(JSON.stringify(getMonthPlan(db, leitungB, facility2, 2026, 10, today))).not.toContain('Mäuse')
    })

    it('a helper in B on a duty for a B group shows no group name in A\'s plan, snapshot or own page', () => {
      addHelpOut(db, anna, facility2, 2026, 10)
      applyToCells(db, leitungB, facility2, [{ employeeId: anna, date: '2026-10-08' }], 'replace',
        { kind: 'shift', templateId: templateId(db, 'F1', facility2), groupId: bärchen })
      const helperEntry = loadEntries(db, { employeeId: anna }).find(entry => entry.helpFacilityId === facility2)!
      expect(helperEntry.groupId).toBe(bärchen)

      const planA = getMonthPlan(db, leitungA, 1, 2026, 10, today)
      // The marker is there (so the check is meaningful), but without the group.
      expect(planA.entries.filter(entry => entry.employeeId === anna && entry.helpFacilityId === facility2)).toHaveLength(1)
      expect(planA.entries.every(entry => entry.helpFacilityId === null || entry.groupId === null)).toBe(true)
      const snapshotA = buildSnapshot(db, 1, 2026, 10)
      expect(snapshotA.entries.filter(entry => entry.helpFacilityId === facility2)).toHaveLength(1)
      expect(snapshotA.entries.every(entry => entry.helpFacilityId === null || entry.groupId === null)).toBe(true)
      releaseMonth(db, leitungA, 1, 2026, 10, new Date('2026-10-02T08:00:00Z'))
      const annaAccount = addUser(db, 'anna', 'observer', anna)
      for (const name of names) {
        for (const value of [planA, snapshotA, loadReleases(db, 1, 2026, 10), getMonthPlan(db, annaAccount, 1, 2026, 10, today),
          getMyPlan(db, annaAccount, 2026, 10, today)]) {
          expect(JSON.stringify(value)).not.toContain(name)
        }
      }
      // B itself names its group for the helper's duty.
      const planB = getMonthPlan(db, leitungB, facility2, 2026, 10, today)
      expect(planB.entries.find(entry => entry.id === helperEntry.id)!.groupId).toBe(bärchen)
    })
  })
})
