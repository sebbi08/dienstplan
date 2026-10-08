import { and, asc, eq, gte, inArray, isNotNull, isNull, lte } from 'drizzle-orm'
import { computeDay, computeRange, summarize } from '../../shared/domain/balance'
import { cellKey, parseCellKey } from '../../shared/domain/cells'
import { addDays, daysInMonth, isoWeekNumber, isWeekend, monthDates, toIsoDate, weekday, weekStart } from '../../shared/domain/dates'
import { holidayOn } from '../../shared/domain/holidays'
import {
  changeHistory, diffCells, ownEntries, snapshotCells, type CellState, type ReleasedChange, type ReleasedState,
} from '../../shared/domain/releaseDiff'
import { isManager } from '../../shared/domain/roles'
import { creditedMinutes, plannedBreakMinutes } from '../../shared/domain/stamping'
import { isEmployedInRange, isEmployedOn } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import { dayWarnings, timeWarnings, type EmployeeDay, type Warning } from '../../shared/domain/warnings'
import type {
  ActualCellDto, ChangeDto, ClosureDto, DayRowDto, EntryDto, HelperDto, MonthPlanAdminDto, MonthPlanDto, MyPlanDayDto, MyPlanDto,
  MyPlanEntryDto, PendingChangeDto, SessionUser, SnapshotData, TimeRecordDto, WeekSummaryDto,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, entries, facilities, helpOuts } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { activeTrackingFrom } from './appSettings'
import { computeBalances } from './balances'
import { groupNames } from './groups'
import { listHelpers } from './helpOuts'
import {
  closureOn, groupByEmployee, loadClosures, loadCodes, loadCoverageRules, loadEmployees, loadEntries,
  loadTemplates, ownCellFilter, type EmployeeRecord,
} from './queries'
import { buildSnapshot, loadReleases, type StoredRelease } from './release'
import { actualTimeFor, loadTimeRecords } from './timeTracking'
import { weekTemplateNames } from './weekTemplates'

function monthBounds(year: number, month: number): { monthStart: IsoDate; monthEnd: IsoDate } {
  return { monthStart: toIsoDate(year, month, 1), monthEnd: toIsoDate(year, month, daysInMonth(year, month)) }
}

/**
 * Warnings, week totals, balances and actuals. The staff's figures use all their entries (help-outs elsewhere count on
 * their one account), but a day spent in another plan only counts as filled, not for this facility's coverage. Helpers
 * count for coverage only: B gets no other data about them.
 */
function buildAdminData(
  db: Db, facilityId: number, staff: EmployeeRecord[], helpers: HelperDto[], closures: ClosureDto[],
  year: number, month: number, today: IsoDate,
): Omit<MonthPlanAdminDto, 'pendingChanges' | 'releasedEmployees'> {
  const { monthStart, monthEnd } = monthBounds(year, month)
  const rangeStart = weekStart(monthStart)
  const rangeEnd = addDays(weekStart(monthEnd), 6)
  const byEmployee = groupByEmployee(loadEntries(db, { from: rangeStart, to: rangeEnd, homeFacilityId: facilityId }))
  const helperIds = helpers.map(helper => helper.employeeId)
  const helperEntries = helperIds.length === 0
    ? []
    : loadEntries(db, { from: monthStart, to: monthEnd, employeeIds: helperIds })
  const helpersHere = groupByEmployee(helperEntries.filter(entry => entry.helpFacilityId === facilityId))
  // A day of the home facility holding only its closure bookings is free for a help-out here (they give way to it).
  const closureBookings = new Set(helperIds.length === 0
    ? []
    : db.select({ id: entries.id }).from(entries).where(and(
        inArray(entries.employeeId, helperIds), gte(entries.date, monthStart), lte(entries.date, monthEnd),
        isNotNull(entries.closureId), isNull(entries.helpFacilityId),
      )).all().map(row => row.id))
  const helperBusy: Record<number, IsoDate[]> = {}
  for (const id of helperIds) {
    helperBusy[id] = [...new Set(helperEntries
      .filter(entry => entry.employeeId === id && entry.helpFacilityId !== facilityId && !closureBookings.has(entry.id))
      .map(entry => entry.date))]
  }
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

  const warnings: Warning[] = monthDates(year, month).flatMap((date) => {
    const staffDays: EmployeeDay[] = staff.map((employee) => {
      const dayEntries = (byEmployee.get(employee.id) ?? []).filter(entry => entry.date === date)
      // Staff entries planned elsewhere are help-elsewhere markers (one day, one plan).
      const busyElsewhere = dayEntries.some(entry => entry.helpFacilityId !== null)
      return { employeeId: employee.id, info: employee.info, entries: busyElsewhere ? [] : dayEntries, busyElsewhere }
    })
    const helperDays: EmployeeDay[] = helpers.map(helper => ({
      employeeId: helper.employeeId,
      info: { hours: [], leftOn: null },
      entries: (helpersHere.get(helper.employeeId) ?? []).filter(entry => entry.date === date),
      coverageOnly: true,
    }))
    return dayWarnings(date, [...staffDays, ...helperDays], rules, closureOn(closures, date) !== null)
  })

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
  return {
    warnings, weeks, balances: computeBalances(db, facilityId, staff, monthEnd, today), actuals, helpers, helperBusy,
  }
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

function facilityNameIfSeveral(db: Db, facilityId: number): string | null {
  const all = db.select({ id: facilities.id, name: facilities.name }).from(facilities).all()
  return all.length > 1 ? all.find(facility => facility.id === facilityId)?.name ?? null : null
}

/** Names of the facility and of every facility the shown entries were planned in. */
function facilityNamesFor(db: Db, facilityId: number, shownEntries: EntryDto[]): Record<number, string> {
  const ids = [...new Set([facilityId, ...shownEntries.flatMap(entry => entry.helpFacilityId ?? [])])]
  return Object.fromEntries(db.select({ id: facilities.id, name: facilities.name }).from(facilities)
    .where(inArray(facilities.id, ids)).all().map(row => [row.id, row.name]))
}

/**
 * Changes and pending changes concern a plan's own cells only: help-elsewhere markers belong to another plan. Their texts
 * name the facility's group of a duty counting for another group.
 */
function ownCellsOf(db: Db, facilityId: number): (data: SnapshotData) => Map<string, CellState> {
  const names = groupNames(db, facilityId)
  return data => snapshotCells({ ...data, entries: ownEntries(facilityId, data.entries) }, names)
}

function releasedStates(db: Db, facilityId: number, releases: StoredRelease[]): ReleasedState[] {
  const ownCells = ownCellsOf(db, facilityId)
  return releases.map(release => ({ releasedAt: release.releasedAt, releasedBy: release.releasedBy, cells: ownCells(release.data) }))
}

/** The month's day rows with the shown plan's closures and Info fields (none when no plan is shown). */
function dayRows(year: number, month: number, shownDays: SnapshotData['days']): DayRowDto[] {
  const byDate = new Map(shownDays.map(day => [day.date, day]))
  return monthDates(year, month).map(date => ({
    date,
    weekday: weekday(date),
    isWeekend: isWeekend(date),
    holidayKey: holidayOn(date),
    closureLabel: byDate.get(date)?.closureLabel ?? null,
    info1: byDate.get(date)?.info1 ?? '',
    info2: byDate.get(date)?.info2 ?? '',
  }))
}

export function getMonthPlan(
  db: Db, viewer: SessionUser, facilityId: number, year: number, month: number, today: IsoDate,
): MonthPlanDto {
  const isAdmin = isManager(viewer.role)
  const releases = loadReleases(db, facilityId, year, month)
  const latest = releases.at(-1) ?? null
  if (!isAdmin && !latest) throw new ServiceError(403, 'month_not_released')

  const ownCells = ownCellsOf(db, facilityId)
  const states = releasedStates(db, facilityId, releases)
  const changes = toChangeDtos(changeHistory(states))
  const shown: SnapshotData = isAdmin ? buildSnapshot(db, facilityId, year, month) : latest!.data

  const pendingChanges: Record<string, PendingChangeDto> = {}
  if (isAdmin && states.length > 0) {
    // Someone who moved away, or the days before someone moved in, are no change of this facility's plan.
    const ownsCell = ownCellFilter(db, facilityId)
    for (const diff of diffCells(states.at(-1)!.cells, ownCells(shown))) {
      const { employeeId, date } = changeFromKey(diff.key)
      if (employeeId !== null && !ownsCell(employeeId, date)) continue
      pendingChanges[diff.key] = { before: diff.before, after: diff.after }
    }
  }

  const days = dayRows(year, month, shown.days)

  let admin: MonthPlanAdminDto | null = null
  if (isAdmin) {
    const { monthStart, monthEnd } = monthBounds(year, month)
    const staff = loadEmployees(db, facilityId).filter(employee => isEmployedInRange(employee.info, monthStart, monthEnd))
    const helpers = listHelpers(db, facilityId, year, month)
    admin = {
      ...buildAdminData(db, facilityId, staff, helpers, loadClosures(db, facilityId), year, month, today),
      pendingChanges,
      releasedEmployees: latest?.data.employees ?? [],
    }
  }

  return {
    year,
    month,
    facilityName: facilityNameIfSeveral(db, facilityId),
    facilityId,
    facilityNames: facilityNamesFor(db, facilityId, shown.entries),
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
  // Each plan the person's days come from, as last released: the home plan (without the markers of help-outs
  // elsewhere), then every facility the person helps in that month (only the entries planned there).
  const homeReleases = loadReleases(db, employee.facilityId, year, month)
  const home = homeReleases.at(-1) ?? null
  const sources: { releasedAt: string; entries: MyPlanEntryDto[]; changes: Record<string, ChangeDto[]> }[] = []
  if (home) {
    sources.push({
      releasedAt: home.releasedAt,
      entries: ownEntries(employee.facilityId, home.data.entries.filter(entry => entry.employeeId === employee.id)),
      changes: toChangeDtos(changeHistory(releasedStates(db, employee.facilityId, homeReleases))),
    })
  }
  const helpFacilities = db.select({ id: facilities.id, name: facilities.name })
    .from(helpOuts)
    .innerJoin(facilities, eq(helpOuts.facilityId, facilities.id))
    .where(and(eq(helpOuts.employeeId, employee.id), eq(helpOuts.year, year), eq(helpOuts.month, month)))
    .orderBy(asc(facilities.name))
    .all()
  for (const facility of helpFacilities) {
    const releases = loadReleases(db, facility.id, year, month)
    const latest = releases.at(-1)
    if (!latest) continue // an unreleased help-out month shows nothing
    sources.push({
      releasedAt: latest.releasedAt,
      entries: latest.data.entries
        .filter(entry => entry.employeeId === employee.id && entry.helpFacilityId === facility.id)
        .map(entry => ({ ...entry, helpFacilityName: facility.name })),
      changes: toChangeDtos(changeHistory(releasedStates(db, facility.id, releases))),
    })
  }
  if (sources.length === 0) throw new ServiceError(403, 'month_not_released')

  const days: MyPlanDayDto[] = dayRows(year, month, home?.data.days ?? []).map((day) => {
    const key = cellKey(employee.id, day.date)
    // One day, one plan: when two releases disagree (one is not re-released yet), the newer release wins.
    const candidates = sources
      .map(source => ({ releasedAt: source.releasedAt, entries: source.entries.filter(entry => entry.date === day.date) }))
      .filter(candidate => candidate.entries.length > 0)
    const newest = candidates.reduce<(typeof candidates)[number] | null>(
      (best, candidate) => (best === null || candidate.releasedAt > best.releasedAt ? candidate : best), null)
    return {
      ...day,
      entries: newest?.entries ?? [],
      // The day's changes from every plan it was in, e.g. a home duty given up before helping out that day.
      changes: sources.flatMap(source => source.changes[key] ?? []).sort((a, b) => a.changedAt.localeCompare(b.changedAt)),
    }
  })
  return {
    year,
    month,
    employee: { id: employee.id, name: employee.name, shortName: employee.shortName },
    // The home plan's release; a month only released where the person helps out has none.
    release: {
      releasedAt: home?.releasedAt ?? null,
      releasedBy: home?.releasedBy ?? null,
      changeCount: days.filter(day => day.changes.length > 0).length,
      pendingCount: 0,
    },
    days,
  }
}
