import { and, eq, inArray } from 'drizzle-orm'
import { daysInMonth, monthDates, toIsoDate } from '../../shared/domain/dates'
import { facilityCell, groupCell, groupStays, type GroupStay, type OccupancyChild } from '../../shared/domain/occupancy'
import { hoursOn, isEntered } from '../../shared/domain/openingHours'
import {
  facilityAddOns, hasPeriodCheck, meets, plannedFte, quotaLines, requiredFte,
} from '../../shared/domain/staffing/calc'
import {
  ageBandOn, minuteGroups, minutesByGroup, NO_GROUP, phaseOf, presentInSlot, weeklyHours, worksWholeSlot,
  type GroupedEntry,
} from '../../shared/domain/staffing/day'
import { presenceShortfalls, SLOT_MINUTES } from '../../shared/domain/staffing/presence'
import type {
  AgeBand, DemandChild, PlannedStaff, PresenceSlot, Qualification, Requirement, RequirementLine, StaffingRuleSet,
} from '../../shared/domain/staffing/types'
import type { IsoDate, Minutes } from '../../shared/domain/types'
import { isCheckedDay, type DayHoursContext, type Warning } from '../../shared/domain/warnings'
import { isWorkEntry } from '../../shared/domain/balance'
import type { EntryDto, GroupDto, StaffingFiguresDto, StaffingMonthDto, StaffingRowDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { children, employees } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { listCareTypes } from './careTypes'
import { listGroups } from './groups'
import { facilityHolidayRules } from './holidayRules'
import { loadHoursContext } from './openingHours'
import { closureOn, loadClosures, loadEntries } from './queries'
import { occupancyChildren, schoolRules } from './schoolChildren'
import { staffingRulesFor } from './staffing'

interface ChildFacts {
  birthDate: IsoDate
  schoolStart: IsoDate
  /** The care type's times and days; null = no care type (the child does not count). */
  care: { start: Minutes; end: Minutes; daysPerWeek: number } | null
}

interface StaffFacts {
  name: string
  qualification: Qualification | null
  share: number | null
}

/** Everything of a facility's month both the report and the presence check read. */
interface MonthData {
  facilityId: number
  groups: GroupDto[]
  occupancy: OccupancyChild[]
  facts: Map<number, ChildFacts>
  staff: Map<number, StaffFacts>
  /** Per employee and date: the plan's entries with the group they count for. */
  days: Map<number, Map<IsoDate, (GroupedEntry & { countsAsStaff: boolean })[]>>
  /** Weekdays without public holidays and closures. */
  careDays: IsoDate[]
  hours: DayHoursContext
}

function assertMonth(year: number, month: number): void {
  if (!Number.isInteger(year) || !Number.isInteger(month) || year < 2000 || year > 2100 || month < 1 || month > 12) {
    throw new ServiceError(400, 'invalid_month')
  }
}

function loadMonth(db: Db, facilityId: number, year: number, month: number): MonthData {
  const monthStart = toIsoDate(year, month, 1)
  const monthEnd = toIsoDate(year, month, daysInMonth(year, month))
  const careTypes = new Map(listCareTypes(db, facilityId).map(type => [type.id, type]))
  const school = schoolRules(db, facilityId)
  const facts = new Map<number, ChildFacts>()
  const rows = db.select({
    id: children.id, birthDate: children.birthDate, schoolStartDate: children.schoolStartDate, careTypeId: children.careTypeId,
  }).from(children).where(and(eq(children.facilityId, facilityId), eq(children.admissionStatus, 'contract'))).all()
  for (const row of rows) {
    const care = row.careTypeId === null ? undefined : careTypes.get(row.careTypeId)
    facts.set(row.id, {
      birthDate: row.birthDate,
      schoolStart: school.factsOf(row).schoolStart,
      care: care === undefined ? null : { start: care.start, end: care.end, daysPerWeek: care.daysPerWeek },
    })
  }

  // The plan of the facility: its staff's entries that are no help-out elsewhere, and the helpers' entries made here.
  const planEntries = loadEntries(db, { from: monthStart, to: monthEnd, planFacilityId: facilityId })
  const ids = [...new Set(planEntries.map(entry => entry.employeeId))]
  const people = ids.length === 0
    ? []
    : db.select({
        id: employees.id, name: employees.name, facilityId: employees.facilityId, groupId: employees.groupId,
        qualification: employees.qualification, share: employees.staffingShare,
      }).from(employees).where(inArray(employees.id, ids)).all()
  const staff = new Map(people.map(p => [p.id, { name: p.name, qualification: p.qualification, share: p.share }]))
  // A helper's home group belongs to another facility: their duties count for a group here only with an entry group.
  const homeGroup = new Map(people.map(p => [p.id, p.facilityId === facilityId ? p.groupId : null]))
  const days: MonthData['days'] = new Map()
  for (const entry of planEntries) {
    const byDate = days.get(entry.employeeId) ?? new Map<IsoDate, (GroupedEntry & { countsAsStaff: boolean })[]>()
    days.set(entry.employeeId, byDate)
    byDate.set(entry.date, [...(byDate.get(entry.date) ?? []), grouped(entry, homeGroup.get(entry.employeeId) ?? null)])
  }

  const closures = loadClosures(db, facilityId)
  const holidays = facilityHolidayRules(db, facilityId)
  const careDays = monthDates(year, month).filter(date => isCheckedDay(date, closureOn(closures, date) !== null, holidays))
  return {
    facilityId, groups: listGroups(db, facilityId), occupancy: occupancyChildren(db, facilityId).children, facts, staff, days,
    careDays, hours: loadHoursContext(db, facilityId),
  }
}

function grouped(entry: EntryDto, homeGroup: number | null): GroupedEntry & { countsAsStaff: boolean } {
  return {
    kind: entry.kind, creditMode: entry.creditMode, start: entry.start, end: entry.end,
    breakStart: entry.breakStart, breakEnd: entry.breakEnd, countsAsStaff: entry.countsAsStaff,
    group: entry.groupId ?? homeGroup,
  }
}

/** The entered opening of a group on a date: its own day if it set one, else the facility's; null = not entered. */
function openingOn(hours: DayHoursContext, groupId: number | null, date: IsoDate): { open: Minutes; close: Minutes } | null {
  const own = groupId === null ? undefined : hours.groups.find(group => group.groupId === groupId)?.hours
  const groupDay = hoursOn(own ?? null, date)
  const hasOwnDay = groupDay !== null && (groupDay.closed || groupDay.open !== null || groupDay.close !== null)
  const day = hasOwnDay ? groupDay : hoursOn(hours.facility, date)
  return isEntered(day) ? { open: day.open, close: day.close } : null
}

/** Average daily opening of the group on the care days with entered hours (null = none entered). */
function averageOpening(data: MonthData, groupId: number | null): Minutes | null {
  const spans = data.careDays.flatMap((date) => {
    const day = openingOn(data.hours, groupId, date)
    return day === null ? [] : [day.close - day.open]
  })
  return spans.length === 0 ? null : spans.reduce((a, b) => a + b, 0) / spans.length
}

/** Planned working minutes of the month per employee and group mark (group id or NO_GROUP). */
function plannedMinutes(data: MonthData): Map<number, Map<number, number>> {
  const result = new Map<number, Map<number, number>>()
  for (const [employeeId, byDate] of data.days) {
    const perGroup = new Map<number, number>()
    for (const dayEntries of byDate.values()) {
      for (const [mark, minutes] of minutesByGroup(minuteGroups(dayEntries, isWorkEntry))) {
        perGroup.set(mark, (perGroup.get(mark) ?? 0) + minutes)
      }
    }
    result.set(employeeId, perGroup)
  }
  return result
}

interface Counted {
  demand: DemandChild[]
  u3: number
  withoutCareType: number
}

function countChildren(data: MonthData, ids: number[], monthStart: IsoDate): Counted {
  const counted: Counted = { demand: [], u3: 0, withoutCareType: 0 }
  for (const id of ids) {
    const facts = data.facts.get(id)
    if (facts === undefined) continue
    const { ageBand, ageMonths } = ageBandOn(facts.birthDate, facts.schoolStart, monthStart)
    if (ageBand === 'u3') counted.u3++
    if (facts.care === null) counted.withoutCareType++
    else counted.demand.push({ ageBand, ageMonths, weeklyHours: weeklyHours(facts.care) })
  }
  return counted
}

const byName = (a: string, b: string) => a.localeCompare(b, 'de')

function staffOf(data: MonthData, minutes: Map<number, number>): { planned: PlannedStaff[]; unqualified: string[] } {
  const planned: PlannedStaff[] = []
  const unqualified: string[] = []
  for (const [employeeId, total] of minutes) {
    if (total <= 0) continue
    const person = data.staff.get(employeeId)
    if (person === undefined) continue
    planned.push({ qualification: person.qualification, share: person.share, hours: total / 60 })
    if (person.qualification === null) unqualified.push(person.name)
  }
  return { planned, unqualified: unqualified.sort(byName) }
}

function figures(
  rules: StaffingRuleSet, required: Requirement, staff: { planned: PlannedStaff[]; unqualified: string[] },
  counted: { total: number; u3: number; withoutCareType: number }, weeks: number,
): StaffingFiguresDto {
  const planned = plannedFte(rules, staff.planned, weeks)
  const checked = hasPeriodCheck(rules) && weeks > 0
  return {
    children: { total: counted.total, u3: counted.u3 },
    required: { fte: required.fte, demandFte: required.demandFte, fachkraftFte: required.fachkraftFte, lines: required.lines },
    planned: { fte: planned.fte, fachkraftFte: planned.fachkraftFte, unqualifiedFte: planned.unqualifiedFte },
    diff: planned.fte - required.fte,
    ok: checked ? meets(planned.fte, required.fte) : null,
    quotas: quotaLines(rules, required, planned),
    unmatchedChildren: required.unmatchedChildren,
    staffWithoutQualification: staff.unqualified,
    childrenWithoutCareType: counted.withoutCareType,
  }
}

/** Lines of the same key summed (the groups' lines, then the facility's), in the order of first appearance. */
function mergeLines(lines: RequirementLine[]): RequirementLine[] {
  const merged = new Map<string, RequirementLine>()
  for (const line of lines) {
    const known = merged.get(line.key)
    if (known === undefined) merged.set(line.key, { ...line })
    else known.fte += line.fte
  }
  return [...merged.values()]
}

/**
 * The Personalschlüssel tab of a month (400 invalid_month): per group the contract children of the month as the
 * Belegung counts them (a child changing group counts in both), Soll by the state's rules valid on the month's first
 * day (age band on that day, weekly hours from the care type), Ist from the plan (work entries, the entry's group else
 * the home group, helpers where they work, absences never), and the facility total (each child once, plus the
 * facility lines such as Leitung). Weeks of the month = care days ÷ 5, so someone planned at their daily target on
 * every care day is one full-time position.
 */
export function staffingMonth(db: Db, facilityId: number, year: number, month: number): StaffingMonthDto {
  assertMonth(year, month)
  const monthStart = toIsoDate(year, month, 1)
  const { rules, preset } = staffingRulesFor(db, facilityId, monthStart)
  const data = loadMonth(db, facilityId, year, month)
  const weeks = data.careDays.length / 5
  const minutes = plannedMinutes(data)
  const minutesFor = (mark: number) => new Map([...minutes].map(([id, perGroup]) => [id, perGroup.get(mark) ?? 0]))

  const rowFor = (groupId: number | null, name: string, groupType: string | null): StaffingRowDto => {
    const cell = groupCell(data.occupancy, groupId, year, month)
    const ids = [...cell.present, ...cell.fresh].map(entry => entry.childId)
    const counted = countChildren(data, ids, monthStart)
    const required = requiredFte(rules, { groupType, openingMinutesPerDay: averageOpening(data, groupId), children: counted.demand })
    const staff = staffOf(data, minutesFor(groupId ?? NO_GROUP))
    return { groupId, name, groupType, ...figures(rules, required, staff, { total: ids.length, ...counted }, weeks) }
  }
  const rows = data.groups.map(group => rowFor(group.id, group.name, group.groupType))
  const ungrouped = rowFor(null, '', null)
  if (ungrouped.children.total > 0 || ungrouped.planned.fte > 0) rows.push(ungrouped)

  const facilityIds = (() => {
    const cell = facilityCell(data.occupancy, year, month)
    return [...cell.present, ...cell.fresh].map(entry => entry.childId)
  })()
  const counted = countChildren(data, facilityIds, monthStart)
  const demandFte = rows.reduce((sum, row) => sum + row.required.demandFte, 0)
  const facilityLines = facilityAddOns(rules, {
    children: counted.demand,
    groupCount: rows.filter(row => row.groupId !== null && row.children.total > 0).length,
    demandFte,
  })
  const required: Requirement = {
    fte: rows.reduce((sum, row) => sum + row.required.fte, 0)
      + facilityLines.reduce((sum, line) => sum + (line.counts ? line.fte : 0), 0),
    demandFte,
    fachkraftFte: rows.reduce((sum, row) => sum + row.required.fachkraftFte, 0),
    lines: mergeLines([...rows.flatMap(row => row.required.lines), ...facilityLines]),
    unmatchedChildren: rows.reduce((sum, row) => sum + row.unmatchedChildren, 0),
    periodCheck: hasPeriodCheck(rules),
  }
  const allMinutes = new Map([...minutes].map(([id, perGroup]) => [id, [...perGroup.values()].reduce((a, b) => a + b, 0)]))
  const total = figures(rules, required, staffOf(data, allMinutes), { total: facilityIds.length, ...counted }, weeks)

  return {
    year,
    month,
    groups: rows,
    total,
    meta: {
      land: rules.land,
      validFrom: preset.validFrom,
      source: preset.source,
      confidence: preset.confidence,
      note: preset.note ?? null,
      periodCheck: hasPeriodCheck(rules),
      fteHoursPerWeek: rules.fteHoursPerWeek,
      careDays: data.careDays.length,
      weeks,
    },
  }
}

/** A duty with children: a shift or special shift counting as staff (never a code, a break or an absence). */
const isPresenceDuty = (entry: GroupedEntry & { countsAsStaff: boolean }) =>
  (entry.kind === 'shift' || entry.kind === 'special') && entry.countsAsStaff

/** The group a child is in on a date by its group stays (undefined = not in the facility that day). */
function groupOfDay(stays: GroupStay[], date: IsoDate): number | null | undefined {
  return stays.find(stay => stay.from <= date && (stay.to === null || date <= stay.to))?.groupId
}

/**
 * The presence check of the state's rules (spec Personalschlüssel §3) for every care day of the month with entered
 * opening hours: per group and 15-minute slot of its opening, the contract children of the group that day whose care
 * time touches the slot vs. the staff on duty for the group during the whole slot (shift or special shift counting as
 * staff, breaks and absences not). Hauptbetreuungszeit = more than half of the group's children with a care type are
 * there. Consecutive slots with the same gap make one warning (400 invalid_month).
 */
export function staffingWarnings(db: Db, facilityId: number, year: number, month: number): Warning[] {
  assertMonth(year, month)
  // Without entered opening hours nothing is checked.
  const hours = loadHoursContext(db, facilityId)
  if (hours.facility === null && hours.groups.length === 0) return []
  const data = loadMonth(db, facilityId, year, month)
  const stays = data.occupancy.map(child => ({ id: child.id, stays: groupStays(child) }))
  const warnings: Warning[] = []
  for (const date of data.careDays) {
    const { rules } = staffingRulesFor(db, facilityId, date)
    if (rules.presence.length === 0) continue
    const onDuty = [...data.days].flatMap(([employeeId, byDate]) => {
      const dayEntries = byDate.get(date)
      return dayEntries === undefined ? [] : [{ employeeId, minutes: minuteGroups(dayEntries, isPresenceDuty) }]
    })
    for (const group of data.groups) {
      const day = openingOn(data.hours, group.id, date)
      if (day === null) continue
      const kids: { ageBand: AgeBand; care: { start: Minutes; end: Minutes } }[] = []
      for (const child of stays) {
        const facts = data.facts.get(child.id)
        if (facts?.care == null || groupOfDay(child.stays, date) !== group.id) continue
        kids.push({ ageBand: ageBandOn(facts.birthDate, facts.schoolStart, date).ageBand, care: facts.care })
      }
      if (kids.length === 0) continue
      const slots: PresenceSlot[] = []
      for (let minute = day.open; minute < day.close; minute += SLOT_MINUTES) {
        const until = Math.min(minute + SLOT_MINUTES, day.close)
        slots.push({
          minute,
          children: kids.filter(kid => presentInSlot(kid.care, minute)).map(kid => ({ ageBand: kid.ageBand })),
          staff: onDuty.filter(person => worksWholeSlot(person.minutes, group.id, minute, until)).map((person) => {
            const facts = data.staff.get(person.employeeId)
            return { qualification: facts?.qualification ?? null, share: facts?.share ?? null }
          }),
        })
      }
      for (const gap of presenceShortfalls(rules, slots, phaseOf(rules, kids.map(kid => kid.care)), group.groupType)) {
        warnings.push({ type: 'staffing', date, groupId: group.id, groupName: group.name, ...gap })
      }
    }
  }
  return warnings
}
