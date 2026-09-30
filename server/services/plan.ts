import { and, asc, eq, gt, gte, lte } from 'drizzle-orm'
import { computeRange, summarize } from '../../shared/domain/balance'
import { cellKey, noteKey } from '../../shared/domain/cells'
import { addDays, daysInMonth, isoWeekNumber, isWeekend, monthDates, toIsoDate, weekday, weekStart } from '../../shared/domain/dates'
import { holidayOn } from '../../shared/domain/holidays'
import { isEmployedInRange } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import { dayWarnings } from '../../shared/domain/warnings'
import type {
  ChangeDto, ClosureDto, DayRowDto, MonthPlanAdminDto, MonthPlanDto, MyPlanDto, SessionUser, WeekSummaryDto,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { changeLog, dayNotes, employees, monthPlans, users } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { computeBalances } from './balances'
import {
  closureOn, groupByEmployee, loadClosures, loadCodes, loadCoverageRules, loadEmployees, loadEntries,
  loadTemplates, type EmployeeRecord,
} from './queries'

function monthBounds(year: number, month: number): { monthStart: IsoDate; monthEnd: IsoDate } {
  return { monthStart: toIsoDate(year, month, 1), monthEnd: toIsoDate(year, month, daysInMonth(year, month)) }
}

function loadChanges(db: Db, from: IsoDate, to: IsoDate, releasedAt: string | null) {
  const changes: Record<string, ChangeDto[]> = {}
  if (!releasedAt) return { changes, changeCount: 0 }
  const rows = db.select({ log: changeLog, username: users.username })
    .from(changeLog)
    .leftJoin(users, eq(changeLog.changedBy, users.id))
    .where(and(gte(changeLog.date, from), lte(changeLog.date, to), gt(changeLog.changedAt, releasedAt)))
    .orderBy(asc(changeLog.changedAt))
    .all()
  for (const { log, username } of rows) {
    const key = log.field === 'entry' ? cellKey(log.employeeId!, log.date) : noteKey(log.field, log.date)
    ;(changes[key] ??= []).push({
      field: log.field, employeeId: log.employeeId, date: log.date,
      before: log.before, after: log.after, changedAt: log.changedAt, changedBy: username ?? '',
    })
  }
  return { changes, changeCount: Object.keys(changes).length }
}

function buildAdminData(
  db: Db, staff: EmployeeRecord[], closures: ClosureDto[], year: number, month: number, today: IsoDate,
): MonthPlanAdminDto {
  const { monthStart, monthEnd } = monthBounds(year, month)
  const rangeStart = weekStart(monthStart)
  const rangeEnd = addDays(weekStart(monthEnd), 6)
  const byEmployee = groupByEmployee(loadEntries(db, { from: rangeStart, to: rangeEnd }))
  const rules = loadCoverageRules(db)

  const warnings = monthDates(year, month).flatMap(date => dayWarnings(
    date,
    staff.map(employee => ({
      employeeId: employee.id,
      info: employee.info,
      entries: (byEmployee.get(employee.id) ?? []).filter(entry => entry.date === date),
    })),
    rules,
    closureOn(closures, date) !== null,
  ))

  const weeks: WeekSummaryDto[] = []
  for (let start = rangeStart; start <= monthEnd; start = addDays(start, 7)) {
    const end = addDays(start, 6)
    weeks.push({
      weekStart: start,
      weekEnd: end,
      weekNumber: isoWeekNumber(start),
      totals: staff.map(employee => ({
        employeeId: employee.id,
        ...summarize(computeRange(employee.info, byEmployee.get(employee.id) ?? [], start, end)),
      })),
    })
  }

  return { warnings, weeks, balances: computeBalances(db, staff, monthEnd, today) }
}

export function getMonthPlan(db: Db, viewer: SessionUser, year: number, month: number, today: IsoDate): MonthPlanDto {
  const { monthStart, monthEnd } = monthBounds(year, month)
  const plan = db.select().from(monthPlans).where(and(eq(monthPlans.year, year), eq(monthPlans.month, month))).get()
  const releasedAt = plan?.releasedAt ?? null
  const isAdmin = viewer.role === 'admin'
  if (!isAdmin && !releasedAt) throw new ServiceError(403, 'month_not_released')

  const staff = loadEmployees(db).filter(employee => isEmployedInRange(employee.info, monthStart, monthEnd))
  const staffIds = new Set(staff.map(employee => employee.id))
  const closures = loadClosures(db)
  const notes = new Map(
    db.select().from(dayNotes).where(and(gte(dayNotes.date, monthStart), lte(dayNotes.date, monthEnd))).all()
      .map(note => [note.date, note]),
  )

  const days: DayRowDto[] = monthDates(year, month).map(date => ({
    date,
    weekday: weekday(date),
    isWeekend: isWeekend(date),
    holidayKey: holidayOn(date),
    closureLabel: closureOn(closures, date)?.label ?? null,
    info1: notes.get(date)?.info1 ?? '',
    info2: notes.get(date)?.info2 ?? '',
  }))

  const { changes, changeCount } = loadChanges(db, monthStart, monthEnd, releasedAt)
  const releasedBy = releasedAt && plan?.releasedBy
    ? db.select().from(users).where(eq(users.id, plan.releasedBy)).get()?.username ?? null
    : null

  return {
    year,
    month,
    release: { releasedAt, releasedBy, changeCount },
    days,
    employees: staff.map(({ id, name, shortName }) => ({ id, name, shortName })),
    entries: loadEntries(db, { from: monthStart, to: monthEnd }).filter(entry => staffIds.has(entry.employeeId)),
    changes,
    templates: loadTemplates(db),
    codes: loadCodes(db),
    admin: isAdmin ? buildAdminData(db, staff, closures, year, month, today) : null,
  }
}

export function getMyPlan(db: Db, viewer: SessionUser, year: number, month: number, today: IsoDate): MyPlanDto {
  if (viewer.employeeId === null) throw new ServiceError(403, 'no_employee')
  const employee = db.select().from(employees).where(eq(employees.id, viewer.employeeId)).get()
  if (!employee) throw new ServiceError(403, 'no_employee')
  const plan = getMonthPlan(db, { ...viewer, role: 'observer' }, year, month, today)
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
