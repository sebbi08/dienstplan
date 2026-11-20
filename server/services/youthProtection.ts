import { and, eq, inArray } from 'drizzle-orm'
import { daysInMonth, monthDates, toIsoDate, weekStart } from '../../shared/domain/dates'
import { employmentStart, isEmployedOn } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import type { Warning } from '../../shared/domain/warnings'
import type { LawEntry } from '../../shared/domain/workingTimeLaw'
import {
  averageDailyMinutes, birthdayUncertainOn, isMinorOn, needsBirthYear, youthFollowupBanFrom, youthWarnings,
} from '../../shared/domain/youthProtection'
import type { Db } from '../db/client'
import { employeeRequirements, employees, requirementTypes } from '../db/schema'
import type { EmployeeRecord } from './queries'

/** The birth years of the employees (personal data: read here only, never sent). */
export function birthYearsOf(db: Db, employeeIds: readonly number[]): Map<number, number | null> {
  if (employeeIds.length === 0) return new Map()
  return new Map(db.select({ id: employees.id, birthYear: employees.birthYear }).from(employees)
    .where(inArray(employees.id, [...employeeIds])).all().map(row => [row.id, row.birthYear]))
}

/** The employees with a recorded follow-up examination (§ 33 JArbSchG, built-in kind youth_followup). */
export function followupRecordedOf(db: Db, employeeIds: readonly number[]): Set<number> {
  if (employeeIds.length === 0) return new Set()
  return new Set(db.selectDistinct({ id: employeeRequirements.employeeId }).from(employeeRequirements)
    .innerJoin(requirementTypes, eq(employeeRequirements.typeId, requirementTypes.id))
    .where(and(inArray(employeeRequirements.employeeId, [...employeeIds]), eq(requirementTypes.builtinKey, 'youth_followup')))
    .all().map(row => row.id))
}

/**
 * The Jugendarbeitsschutz hints of the month's plan (JArbSchG, shared/domain/youthProtection.ts) for the own staff on the
 * days they are under 18 and employed, from all their planned entries (`entriesOf`: help-outs elsewhere included; it
 * must hold the whole calendar weeks around the month and the day before it). Age is no health data: every plan editor
 * gets them, like the ArbZG hints; the birth date is never part of a hint.
 *
 * `showsBirthYearHint` (employees.personal, who can enter it): „Geburtsjahr fehlt“ once a month, on the person's first
 * employed day of it, for a trainee, student, intern or „keine pädagogische Kraft“ without a birth year; „Geburtstag
 * fehlt“ once a month, on the first employed day of it in the year of the 18th birthday, for anyone with a birth year
 * and no birthday (whether they are still under 18 cannot be told). With the birth year alone the rules apply while the
 * person is certainly under 18 (minorStatusOn).
 *
 * § 33 Abs. 3: from 14 months after the start („beschäftigt seit“, else the first weekly hours) without a recorded
 * follow-up examination, each day with work gets „Beschäftigungsverbot: Bescheinigung der Nachuntersuchung fehlt“.
 */
export function youthPlanWarnings(
  db: Db, staff: readonly EmployeeRecord[], year: number, month: number,
  entriesOf: (employeeId: number, date: IsoDate) => LawEntry[], showsBirthYearHint: boolean,
): Warning[] {
  const monthStart = toIsoDate(year, month, 1)
  const monthEnd = toIsoDate(year, month, daysInMonth(year, month))
  const birthYears = birthYearsOf(db, staff.map(employee => employee.id))
  const followupRecorded = followupRecordedOf(db, staff.map(employee => employee.id))
  const warnings: Warning[] = []
  for (const employee of staff) {
    const birthYear = birthYears.get(employee.id) ?? null
    if (birthYear === null) {
      if (!showsBirthYearHint || !needsBirthYear(employee.qualification)) continue
      const first = monthDates(year, month).find(date => isEmployedOn(employee.info, date))
      if (first !== undefined) warnings.push({ type: 'youth_birth_year', date: first, employeeId: employee.id })
      continue
    }
    if (showsBirthYearHint) {
      const uncertain = monthDates(year, month)
        .find(date => isEmployedOn(employee.info, date) && birthdayUncertainOn(employee.birthday, birthYear, date))
      if (uncertain !== undefined) warnings.push({ type: 'youth_birthday', date: uncertain, employeeId: employee.id })
    }
    // Under 18 is over for good after the 18th birthday: not certainly under 18 on the first day the week rules look at,
    // nothing to check.
    if (!isMinorOn(employee.birthday, birthYear, weekStart(monthStart))) continue
    warnings.push(...youthWarnings({
      employeeId: employee.id, from: monthStart, to: monthEnd, holidays: employee.info.holidays,
      entriesOf: date => entriesOf(employee.id, date),
      appliesOn: date => isEmployedOn(employee.info, date) && isMinorOn(employee.birthday, birthYear, date),
      creditOn: date => averageDailyMinutes(employee.info, date),
      examBanFrom: youthFollowupBanFrom(employee.employedSince ?? employmentStart(employee.info), followupRecorded.has(employee.id)),
    }))
  }
  return warnings
}
