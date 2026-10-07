import { eq } from 'drizzle-orm'
import { computeDay, computeRange, summarize } from '../../shared/domain/balance'
import { cellKey, parseCellKey } from '../../shared/domain/cells'
import { addDays, daysInMonth, isoWeekNumber, isWeekend, monthDates, toIsoDate, weekday, weekStart } from '../../shared/domain/dates'
import { holidayOn } from '../../shared/domain/holidays'
import { changeHistory, diffCells, snapshotCells, type ReleasedChange } from '../../shared/domain/releaseDiff'
import { isManager } from '../../shared/domain/roles'
import { creditedMinutes, plannedBreakMinutes } from '../../shared/domain/stamping'
import { isEmployedInRange, isEmployedOn } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import { dayWarnings, timeWarnings, type Warning } from '../../shared/domain/warnings'
import type {
  ActualCellDto, ChangeDto, ClosureDto, DayRowDto, MonthPlanAdminDto, MonthPlanDto, MyPlanDto, PendingChangeDto, SessionUser, SnapshotData,
  TimeRecordDto, WeekSummaryDto,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { activeTrackingFrom } from './appSettings'
import { computeBalances } from './balances'
import {
  closureOn, groupByEmployee, loadClosures, loadCodes, loadCoverageRules, loadEmployees, loadEntries,
  loadTemplates, ownCellFilter, type EmployeeRecord,
} from './queries'
import { buildSnapshot, loadReleases } from './release'
import { actualTimeFor, loadTimeRecords } from './timeTracking'
import { weekTemplateNames } from './weekTemplates'

function monthBounds(year: number, month: number): { monthStart: IsoDate; monthEnd: IsoDate } {
  return { monthStart: toIsoDate(year, month, 1), monthEnd: toIsoDate(year, month, daysInMonth(year, month)) }
}

function buildAdminData(
  db: Db, facilityId: number, staff: EmployeeRecord[], closures: ClosureDto[], year: number, month: number, today: IsoDate,
): Omit<MonthPlanAdminDto, 'pendingChanges' | 'releasedEmployees'> {
  const { monthStart, monthEnd } = monthBounds(year, month)
  const rangeStart = weekStart(monthStart)
  const rangeEnd = addDays(weekStart(monthEnd), 6)
  const byEmployee = groupByEmployee(loadEntries(db, { from: rangeStart, to: rangeEnd, facilityId }))
  const rules = loadCoverageRules(db, facilityId)
  const actualOf = actualTimeFor(db, facilityId, today)
  const trackingFrom = activeTrackingFrom(db, facilityId, today)
  const recordsByCell = new Map<string, TimeRecordDto[]>()
  if (trackingFrom !== null) {
    for (const record of loadTimeRecords(db, { from: monthStart, to: monthEnd })) {
      const key = cellKey(record.employeeId, record.date)
      recordsByCell.set(key, [...(recordsByCell.get(key) ?? []), record])
    }
  }

  const warnings: Warning[] = monthDates(year, month).flatMap(date => dayWarnings(
    date,
    staff.map(employee => ({
      employeeId: employee.id,
      info: employee.info,
      entries: (byEmployee.get(employee.id) ?? []).filter(entry => entry.date === date),
    })),
    rules,
    closureOn(closures, date) !== null,
  ))

  const actuals: Record<string, ActualCellDto> = {}
  if (trackingFrom !== null) {
    for (const date of monthDates(year, month)) {
      if (date < trackingFrom || date >= today) continue
      for (const employee of staff) {
        if (!isEmployedOn(employee.info, date)) continue
        const key = cellKey(employee.id, date)
        const dayEntries = (byEmployee.get(employee.id) ?? []).filter(entry => entry.date === date)
        const records = recordsByCell.get(key) ?? []
        warnings.push(...timeWarnings(date, employee.id, dayEntries, records, employee.breakMode))
        if (records.length === 0) continue
        const minutes = creditedMinutes(records, employee.breakMode, plannedBreakMinutes(dayEntries))
        const planned = computeDay(employee.info, date, dayEntries).credit
        actuals[key] = { minutes, open: records.some(record => record.end === null), deviates: Math.abs(minutes - planned) > 15 }
      }
    }
  }

  const weeks: WeekSummaryDto[] = []
  const templateNames = weekTemplateNames(db, facilityId, rangeStart, monthEnd)
  for (let start = rangeStart; start <= monthEnd; start = addDays(start, 7)) {
    const end = addDays(start, 6)
    weeks.push({
      weekStart: start,
      weekEnd: end,
      weekNumber: isoWeekNumber(start),
      templateName: templateNames.get(start) ?? null,
      totals: staff.map(employee => ({
        employeeId: employee.id,
        ...summarize(computeRange(employee.info, byEmployee.get(employee.id) ?? [], start, end, actualOf(employee.id))),
      })),
    })
  }

  // Time warnings were appended after all plan warnings; Array.prototype.sort is stable.
  warnings.sort((a, b) => a.date.localeCompare(b.date))
  return { warnings, weeks, balances: computeBalances(db, facilityId, staff, monthEnd, today), actuals }
}

function changeFromKey(key: string): Pick<ChangeDto, 'field' | 'employeeId' | 'date'> {
  const [prefix, date] = key.split('|') as [string, string]
  if (prefix === 'info1' || prefix === 'info2') return { field: prefix, employeeId: null, date }
  const cell = parseCellKey(key)
  return { field: 'entry', employeeId: cell.employeeId, date: cell.date }
}

function toChangeDtos(history: Map<string, ReleasedChange[]>): Record<string, ChangeDto[]> {
  const changes: Record<string, ChangeDto[]> = {}
  for (const [key, list] of history) {
    changes[key] = list.map(change => ({
      ...changeFromKey(key), before: change.before, after: change.after,
      changedAt: change.releasedAt, changedBy: change.releasedBy,
    }))
  }
  return changes
}

export function getMonthPlan(
  db: Db, viewer: SessionUser, facilityId: number, year: number, month: number, today: IsoDate,
): MonthPlanDto {
  const isAdmin = isManager(viewer.role)
  const releases = loadReleases(db, facilityId, year, month)
  const latest = releases.at(-1) ?? null
  if (!isAdmin && !latest) throw new ServiceError(403, 'month_not_released')

  const states = releases.map(release => ({
    releasedAt: release.releasedAt, releasedBy: release.releasedBy, cells: snapshotCells(release.data),
  }))
  const changes = toChangeDtos(changeHistory(states))
  const shown: SnapshotData = isAdmin ? buildSnapshot(db, facilityId, year, month) : latest!.data

  const pendingChanges: Record<string, PendingChangeDto> = {}
  if (isAdmin && states.length > 0) {
    // Someone who moved away, or the days before someone moved in, are no change of this facility's plan.
    const ownsCell = ownCellFilter(db, facilityId)
    for (const diff of diffCells(states.at(-1)!.cells, snapshotCells(shown))) {
      const { employeeId, date } = changeFromKey(diff.key)
      if (employeeId !== null && !ownsCell(employeeId, date)) continue
      pendingChanges[diff.key] = { before: diff.before, after: diff.after }
    }
  }

  const shownDays = new Map(shown.days.map(day => [day.date, day]))
  const days: DayRowDto[] = monthDates(year, month).map(date => ({
    date,
    weekday: weekday(date),
    isWeekend: isWeekend(date),
    holidayKey: holidayOn(date),
    closureLabel: shownDays.get(date)?.closureLabel ?? null,
    info1: shownDays.get(date)?.info1 ?? '',
    info2: shownDays.get(date)?.info2 ?? '',
  }))

  let admin: MonthPlanAdminDto | null = null
  if (isAdmin) {
    const { monthStart, monthEnd } = monthBounds(year, month)
    const staff = loadEmployees(db, facilityId).filter(employee => isEmployedInRange(employee.info, monthStart, monthEnd))
    admin = {
      ...buildAdminData(db, facilityId, staff, loadClosures(db, facilityId), year, month, today),
      pendingChanges,
      releasedEmployees: latest?.data.employees ?? [],
    }
  }

  return {
    year,
    month,
    release: {
      releasedAt: latest?.releasedAt ?? null,
      releasedBy: latest?.releasedBy ?? null,
      changeCount: Object.keys(changes).length,
      pendingCount: Object.keys(pendingChanges).length,
    },
    days,
    employees: shown.employees,
    entries: shown.entries,
    changes,
    templates: loadTemplates(db, facilityId),
    codes: loadCodes(db),
    admin,
  }
}

export function getMyPlan(db: Db, viewer: SessionUser, year: number, month: number, today: IsoDate): MyPlanDto {
  if (viewer.employeeId === null) throw new ServiceError(403, 'no_employee')
  const employee = db.select().from(employees).where(eq(employees.id, viewer.employeeId)).get()
  if (!employee) throw new ServiceError(403, 'no_employee')
  // The plan of the employee's own (home) facility.
  const plan = getMonthPlan(db, { ...viewer, role: 'observer' }, employee.facilityId, year, month, today)
  const days = plan.days.map(day => ({
    ...day,
    entries: plan.entries.filter(entry => entry.employeeId === employee.id && entry.date === day.date),
    changes: plan.changes[cellKey(employee.id, day.date)] ?? [],
  }))
  return {
    year,
    month,
    employee: { id: employee.id, name: employee.name, shortName: employee.shortName },
    release: { ...plan.release, changeCount: days.filter(day => day.changes.length > 0).length },
    days,
  }
}
