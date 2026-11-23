import { and, asc, eq, gte, inArray, isNotNull, isNull, lte } from 'drizzle-orm'
import { groupAttendance } from '../../shared/domain/attendance'
import { computeDay, computeRange, isFullDayTimed, summarize } from '../../shared/domain/balance'
import { cellKey, parseCellKey } from '../../shared/domain/cells'
import { addDays, daysInMonth, isoWeekNumber, isWeekend, monthDates, toIsoDate, weekday, weekStart } from '../../shared/domain/dates'
import { holidayIn, type HolidayRules } from '../../shared/domain/holidays'
import {
  changeHistory, diffCells, ownEntries, snapshotCells, type CellState, type ReleasedChange, type ReleasedState,
} from '../../shared/domain/releaseDiff'
import { can } from '../../shared/domain/permissions'
import { dayCreditedMinutes } from '../../shared/domain/stamping'
import { countsForBalance, isEmployedInRange, isEmployedOn } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import { dayWarnings, timeWarnings, type DayHoursContext, type EmployeeDay, type Warning } from '../../shared/domain/warnings'
import { plannedLawWarnings, recordedLawWarnings, usesStampedHints } from '../../shared/domain/workingTimeLaw'
import { isMinorOn } from '../../shared/domain/youthProtection'
import type {
  ActualCellDto, ChangeDto, ClosureDto, DayRowDto, EntryDto, HelperDto, MonthPlanAdminDto, MonthPlanDto, MyPlanDayDto, MyPlanDto,
  MyPlanEntryDto, PendingChangeDto, SessionUser, SnapshotData, TimeRecordDto, WeekSummaryDto,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, entries, facilities, helpOuts } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { maskSnapshot, seesProtectedCodes, withoutPrivateCodes } from '../lib/protectedCodes'
import { activeTrackingFrom } from './appSettings'
import { autoEventsFor } from './autoEvents'
import { computeBalances } from './balances'
import { loadSickLeaves, sickLeavesByCell } from './earlySickLeaves'
import { childSickWarnings } from './employeeChildren'
import { groupNames, snapshotGroupNames } from './groups'
import { listHelpers } from './helpOuts'
import { facilityHolidayRules } from './holidayRules'
import { maternityPlanWarnings } from './maternity'
import { loadHoursContext, withOpeningHours } from './openingHours'
import { fullParentalLeaveDates, parentalLeavePlanCells } from './parentalLeave'
import {
  closureOn, groupByEmployee, loadClosures, loadCodes, loadCoverageRules, loadEmployee, loadEmployees, loadEntries,
  loadTemplates, ownCellFilter, type EmployeeRecord,
} from './queries'
import { buildSnapshot, loadReleases, type StoredRelease } from './release'
import { staffingWarnings } from './staffingReport'
import { actualTimeFor, loadTimeRecords } from './timeTracking'
import { loadWarningAcks } from './warningAcks'
import { weekTemplateNames, weekTemplateUsesOf } from './weekTemplates'
import { birthYearsOf, youthPlanWarnings } from './youthProtection'

function monthBounds(year: number, month: number): { monthStart: IsoDate; monthEnd: IsoDate } {
  return { monthStart: toIsoDate(year, month, 1), monthEnd: toIsoDate(year, month, daysInMonth(year, month)) }
}

/**
 * Warnings, week totals, balances and actuals. The staff's figures use all their entries (help-outs elsewhere count on
 * their one account), but a day spent in another plan only counts as filled, not for this facility's coverage. Helpers
 * count for coverage only: B gets no other data about them. The "Im Dienst erkrankt" markers are those of the own staff
 * only; a marked day has no time warnings and its recorded time never counts as deviating (the plan is credited).
 */
function buildAdminData(
  db: Db, facilityId: number, staff: EmployeeRecord[], helpers: HelperDto[], closures: ClosureDto[],
  year: number, month: number, today: IsoDate, hours: DayHoursContext, showsChildSickEntitlement = true, showsMaternity = true,
  showsBirthYearHint = true,
): Omit<MonthPlanAdminDto, 'pendingChanges' | 'releasedEmployees'> {
  const { monthStart, monthEnd } = monthBounds(year, month)
  const rangeStart = weekStart(monthStart)
  const rangeEnd = addDays(weekStart(monthEnd), 6)
  // The day before the month for the rest period (§ 5 ArbZG) of its first day; the weeks usually start earlier anyway.
  const dayBefore = addDays(monthStart, -1)
  const byEmployee = groupByEmployee(loadEntries(db, {
    from: rangeStart < monthStart ? rangeStart : dayBefore, to: rangeEnd, homeFacilityId: facilityId,
  }))
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
  // Group rules name their group in the warning.
  const names = groupNames(db, facilityId)
  const rules = loadCoverageRules(db, facilityId)
    .map(rule => rule.groupId === null ? rule : { ...rule, groupName: names[rule.groupId] ?? '' })
  // The plan's days are checked against this facility's holidays; each person's own working days follow their info.
  const holidays = facilityHolidayRules(db, facilityId)
  const actualOf = actualTimeFor(db, facilityId, today)
  const trackingFrom = activeTrackingFrom(db, facilityId, today)
  const recordsByCell = new Map<string, TimeRecordDto[]>()
  if (trackingFrom !== null) {
    for (const record of loadTimeRecords(db, { from: dayBefore, to: monthEnd })) {
      const key = cellKey(record.employeeId, record.date)
      recordsByCell.set(key, [...(recordsByCell.get(key) ?? []), record])
    }
  }
  const staffIds = staff.map(employee => employee.id)
  const sickLeaves = sickLeavesByCell(loadSickLeaves(db, staffIds, monthStart, monthEnd))
  // „Im Dienst erkrankt“ of the day before the month: its stamped end gives no rest period for the first day.
  const markedBefore = new Set(Object.keys(sickLeavesByCell(loadSickLeaves(db, staffIds, dayBefore, dayBefore))))
  const isMarked = (key: string) => key in sickLeaves || markedBefore.has(key)
  const dayEntriesOf = (employeeId: number, date: IsoDate) => (byEmployee.get(employeeId) ?? []).filter(entry => entry.date === date)
  /** A past day of the tracking range, not marked, whose stamps count: it gets the stamped law hints, not the planned. */
  const stampedLawDay = (employee: EmployeeRecord, date: IsoDate) => {
    const key = cellKey(employee.id, date)
    return trackingFrom !== null && trackingFrom <= date && date < today && isEmployedOn(employee.info, date) && !isMarked(key)
      && usesStampedHints({ entries: dayEntriesOf(employee.id, date), records: recordsByCell.get(key) ?? [] })
  }

  // Birth years (personal data) only to tell the days a person is under 18; never sent.
  const birthYears = birthYearsOf(db, staffIds)
  const warnings: Warning[] = monthDates(year, month).flatMap((date) => {
    const staffDays: EmployeeDay[] = staff.map((employee) => {
      const dayEntries = (byEmployee.get(employee.id) ?? []).filter(entry => entry.date === date)
      // Staff entries planned elsewhere are help-elsewhere markers (one day, one plan).
      const busyElsewhere = dayEntries.some(entry => entry.helpFacilityId !== null)
      return {
        employeeId: employee.id, groupId: employee.groupId, info: employee.info, entries: busyElsewhere ? [] : dayEntries, busyElsewhere,
      }
    })
    // Helpers have no home group here: their duties count for a group only with an entry group. They count for
    // coverage only, so their info (a placeholder) is never read.
    const helperDays: EmployeeDay[] = helpers.map(helper => ({
      employeeId: helper.employeeId,
      groupId: null,
      info: { hours: [], leftOn: null, holidays },
      entries: (helpersHere.get(helper.employeeId) ?? []).filter(entry => entry.date === date),
      coverageOnly: true,
    }))
    // Working time law (§ 3, § 4 Satz 3, § 5 ArbZG) of the own staff on every day they are employed, weekends included,
    // with all their entries (a help-out elsewhere is work too). Helpers are checked in their home facility's plan. A
    // past day with stamps gets the stamped hints instead (below). On a day under 18 the JArbSchG's break rules replace
    // § 4 Satz 3 (youthPlanWarnings).
    const lawWarnings = staff.filter(employee => isEmployedOn(employee.info, date) && !stampedLawDay(employee, date))
      .flatMap(employee => plannedLawWarnings(
        date, employee.id, dayEntriesOf(employee.id, date), dayEntriesOf(employee.id, addDays(date, -1)),
        isMinorOn(employee.birthday, birthYears.get(employee.id) ?? null, date),
      ))
    return [...dayWarnings(date, [...staffDays, ...helperDays], rules, closureOn(closures, date) !== null, holidays, hours), ...lawWarnings]
  })
  // The state's presence rules (Personalschlüssel) per group and time of day.
  warnings.push(...staffingWarnings(db, facilityId, year, month))
  // More „Kind krank“ days than the entitlement of the year (§ 45 SGB V): a hint on the person's last such day; the
  // numbers (they tell the children and „alleinerziehend“) only for viewers of the personal data.
  // Not at all for a viewer without the health data (it would tell „Kind krank“ behind „abwesend“).
  if (showsMaternity) warnings.push(...childSickWarnings(db, staff, year, month, showsChildSickEntitlement))
  // Mutterschutz (§§ 4–6 MuSchG): the hints of a case with their reason only for viewers of the case (employees.sickness),
  // everybody else „Arbeitszeitgrenze überschritten“ (pregnancy is health data).
  warnings.push(...maternityPlanWarnings(db, staff, year, month, showsMaternity))
  // Jugendarbeitsschutz (JArbSchG) on the days a person is under 18, from the planned entries of whole weeks; „Geburtsjahr
  // fehlt“ only for whoever can enter it (employees.personal).
  warnings.push(...youthPlanWarnings(db, staff, year, month, dayEntriesOf, showsBirthYearHint))

  const actuals: Record<string, ActualCellDto> = {}
  if (trackingFrom !== null) {
    for (const date of monthDates(year, month)) {
      if (date < trackingFrom || date >= today) continue
      for (const employee of staff) {
        if (!isEmployedOn(employee.info, date)) continue
        const key = cellKey(employee.id, date)
        const dayEntries = (byEmployee.get(employee.id) ?? []).filter(entry => entry.date === date)
        const records = recordsByCell.get(key) ?? []
        const marked = key in sickLeaves
        if (!marked) {
          warnings.push(...timeWarnings(date, employee.id, dayEntries, records, employee.breakMode))
          const before = addDays(date, -1)
          const beforeKey = cellKey(employee.id, before)
          // The day before counts only when it lies in the tracking range too and is not marked „Im Dienst erkrankt“.
          const previous = before >= trackingFrom && isEmployedOn(employee.info, before) && !isMarked(beforeKey)
            ? { entries: dayEntriesOf(employee.id, before), records: recordsByCell.get(beforeKey) ?? [] }
            : null
          warnings.push(...recordedLawWarnings(date, employee.id, { entries: dayEntries, records }, employee.breakMode, previous))
        }
        if (records.length === 0) continue
        // Home-office minutes count as stamped, so a stamped day with home office does not show as deviating.
        const minutes = dayCreditedMinutes(records, dayEntries, employee.breakMode)
        const planned = computeDay(employee.info, date, dayEntries).credit
        // A whole Büro/home-office day counts its target whatever was stamped: its stamps never deviate.
        const deviates = !marked && !dayEntries.some(isFullDayTimed) && Math.abs(minutes - planned) > 15
        actuals[key] = { minutes, open: records.some(record => record.end === null), deviates }
      }
    }
  }

  const weeks: WeekSummaryDto[] = []
  const templateNames = weekTemplateNames(db, facilityId, rangeStart, monthEnd)
  const templateUses = weekTemplateUsesOf(db, facilityId, rangeStart, monthEnd)
  for (let start = rangeStart; start <= monthEnd; start = addDays(start, 7)) {
    const end = addDays(start, 6)
    weeks.push({
      weekStart: start,
      weekEnd: end,
      weekNumber: isoWeekNumber(start),
      templateName: templateNames.get(start)?.['0'] ?? null,
      templateNames: templateNames.get(start) ?? {},
      templateUses: templateUses.get(start)?.uses ?? [],
      templateChangedSince: templateUses.get(start)?.changedSince ?? false,
      totals: staff.map(employee => ({
        employeeId: employee.id,
        // Only the days the hours account counts (countsForBalance): weeks before „Stundenkonto ab“ show no difference.
        ...summarize(computeRange(employee.info, byEmployee.get(employee.id) ?? [], start, end, actualOf(employee.id))
          .filter(day => countsForBalance(employee.info, day.date))),
      })),
    })
  }

  // Time warnings were appended after all plan warnings; Array.prototype.sort is stable.
  warnings.sort((a, b) => a.date.localeCompare(b.date))
  return {
    warnings, weeks, balances: computeBalances(db, facilityId, staff, monthEnd, today), actuals, helpers, helperBusy, sickLeaves,
    warningAcks: loadWarningAcks(db, facilityId, monthStart, monthEnd),
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
 * name the facility's group of a duty counting for another group, as the group was called in that state (a release: at
 * release time; the draft: now).
 */
function ownCellsOf(db: Db, facilityId: number): (data: SnapshotData) => Map<string, CellState> {
  const namesOf = snapshotGroupNames(db, facilityId)
  return data => snapshotCells({ ...data, entries: ownEntries(facilityId, data.entries) }, namesOf(data))
}

/** Per group of the shown plan and day: the persons working in that group (see groupAttendance); no groups = {}. */
function attendanceOf(facilityId: number, shown: SnapshotData, year: number, month: number): MonthPlanDto['attendance'] {
  const groups = shown.groups ?? []
  if (groups.length === 0) return {}
  const homeGroups = new Map(shown.employees.map(employee => [employee.id, employee.groupId ?? null]))
  return groupAttendance(facilityId, groups.map(group => group.id), homeGroups, shown.entries, monthDates(year, month))
}

function releasedStates(db: Db, facilityId: number, releases: StoredRelease[]): ReleasedState[] {
  const ownCells = ownCellsOf(db, facilityId)
  return releases.map(release => ({ releasedAt: release.releasedAt, releasedBy: release.releasedBy, cells: ownCells(release.data) }))
}

/**
 * The month's day rows with the shown plan's closures and Info fields (none when no plan is shown); holidays are those
 * of the given rules (a facility's plan: the facility; a person's own plan: their home facility). The automatic events
 * are those of that facility as they are now, also for a released month: they are not part of a release.
 */
function dayRows(
  db: Db, facilityId: number, year: number, month: number, shownDays: SnapshotData['days'], holidays: HolidayRules,
): DayRowDto[] {
  const byDate = new Map(shownDays.map(day => [day.date, day]))
  const { monthStart, monthEnd } = monthBounds(year, month)
  const events = autoEventsFor(db, facilityId, monthStart, monthEnd)
  return monthDates(year, month).map(date => ({
    date,
    weekday: weekday(date),
    isWeekend: isWeekend(date),
    holidayKey: holidayIn(date, holidays),
    closureLabel: byDate.get(date)?.closureLabel ?? null,
    info1: byDate.get(date)?.info1 ?? '',
    info2: byDate.get(date)?.info2 ?? '',
    autoEvents: events.get(date) ?? [],
  }))
}

export function getMonthPlan(
  db: Db, viewer: SessionUser, facilityId: number, year: number, month: number, today: IsoDate,
): MonthPlanDto {
  // The draft with its pending changes and warnings with plan.edit; everyone else the latest released plan.
  const isAdmin = can(viewer.permissions, 'plan.edit')
  // Krank, Kind krank, Mutterschutz and Beschäftigungsverbot show alike as „abwesend“ to whoever may not see health
  // data, also in the releases and their changes (the hours and hints below use the real entries).
  const showsProtected = seesProtectedCodes(viewer)
  const releases = loadReleases(db, facilityId, year, month)
    .map(release => (showsProtected ? release : { ...release, data: maskSnapshot(release.data) }))
  const latest = releases.at(-1) ?? null
  if (!isAdmin && !latest) throw new ServiceError(403, 'month_not_released')

  const ownCells = ownCellsOf(db, facilityId)
  const states = releasedStates(db, facilityId, releases)
  const changes = toChangeDtos(changeHistory(states))
  const draft = isAdmin ? buildSnapshot(db, facilityId, year, month) : null
  const shown: SnapshotData = draft ? (showsProtected ? draft : maskSnapshot(draft)) : latest!.data
  const codes = loadCodes(db)

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

  // Opening hours: a closed weekday suppresses the rules, entered days add the edge warnings (none entered: nothing changes).
  const hours = loadHoursContext(db, facilityId)
  const days = withOpeningHours(dayRows(db, facilityId, year, month, shown.days, facilityHolidayRules(db, facilityId)), hours)

  const { monthStart, monthEnd } = monthBounds(year, month)
  const staff = loadEmployees(db, facilityId).filter(employee => isEmployedInRange(employee.info, monthStart, monthEnd))
  let admin: MonthPlanAdminDto | null = null
  if (isAdmin) {
    const helpers = listHelpers(db, facilityId, year, month)
    admin = {
      ...buildAdminData(
        db, facilityId, staff, helpers, loadClosures(db, facilityId), year, month, today, hours,
        can(viewer.permissions, 'employees.personal'), showsProtected, can(viewer.permissions, 'employees.personal'),
      ),
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
    groups: shown.groups ?? [],
    attendance: attendanceOf(facilityId, shown, year, month),
    changes,
    templates: loadTemplates(db, facilityId),
    codes: showsProtected ? codes : withoutPrivateCodes(codes),
    // „Krank melden“ for an editor who may not see health data (only Krank, on a day without a private code; entries.ts).
    reportSickCodeId: isAdmin && !showsProtected ? codes.find(code => code.key === 'sick')?.id ?? null : null,
    // A full Elternzeit is marked on the staff's working days without stored entries, as it is now (also in a released
    // month): „Elternzeit“ or „abwesend“ (server/services/parentalLeave.ts).
    parentalLeave: parentalLeavePlanCells(db, viewer, facilityId, staff, year, month),
    admin: admin && !showsProtected
      // The acknowledgements of the Mutterschutz hints name the rule, the „Im Dienst erkrankt“ markers tell a sickness:
      // neither for whoever sees only „abwesend“ and „Arbeitszeitgrenze überschritten“.
      ? {
          ...admin, sickLeaves: {},
          warningAcks: admin.warningAcks.filter(ack => !ack.key.startsWith('maternity|') && !ack.key.startsWith('child_sick_days|')),
        }
      : admin,
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

  // The person's own plan shows the holidays of their home facility, also on days helping out elsewhere.
  const homeHolidays = facilityHolidayRules(db, employee.facilityId)
  // The person's own full Elternzeit: „Elternzeit“ on its working days (as it is now, no stored entry).
  const { monthStart, monthEnd } = monthBounds(year, month)
  const ownLeave = new Set(fullParentalLeaveDates(loadEmployee(db, employee.id)!.info, monthStart, monthEnd))
  const days: MyPlanDayDto[] = dayRows(db, employee.facilityId, year, month, home?.data.days ?? [], homeHolidays).map((day) => {
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
      ...(ownLeave.has(day.date) ? { parentalLeave: true } : {}),
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
