import { and, eq } from 'drizzle-orm'
import { addDays, daysInMonth } from '../../shared/domain/dates'
import type { OccupancyChild } from '../../shared/domain/occupancy'
import { effectiveSchoolStart, type SchoolCutoff } from '../../shared/domain/schoolStart'
import type { SchoolSettingsDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { children, facilities } from '../db/schema'
import { ServiceError } from '../lib/errors'

/** A leap year, so that 29 February is a valid cutoff day. */
const LEAP_YEAR = 2024

/** The facility's school settings (the defaults for a new facility are 30 June and 6 years). */
export function getSchoolSettings(db: Db, facilityId: number): SchoolSettingsDto {
  const row = db.select({
    month: facilities.schoolCutoffMonth, day: facilities.schoolCutoffDay, ageYears: facilities.schoolAgeYears,
  }).from(facilities).where(eq(facilities.id, facilityId)).get()
  if (!row) throw new ServiceError(404, 'facility_not_found')
  return { cutoffMonth: row.month, cutoffDay: row.day, ageYears: row.ageYears }
}

/** The facility's settings as the domain's cutoff. */
export function schoolCutoffOf(db: Db, facilityId: number): SchoolCutoff {
  const settings = getSchoolSettings(db, facilityId)
  return { month: settings.cutoffMonth, day: settings.cutoffDay, ageYears: settings.ageYears }
}

/** Stores the cutoff: a real calendar day (29 February allowed) and an age of 4 to 8 years, else 400 invalid_school_cutoff. */
export function setSchoolCutoff(db: Db, facilityId: number, input: SchoolSettingsDto): void {
  const { cutoffMonth, cutoffDay, ageYears } = input
  const wholeNumbers = [cutoffMonth, cutoffDay, ageYears].every(Number.isInteger)
  if (!wholeNumbers || cutoffMonth < 1 || cutoffMonth > 12 || cutoffDay < 1 || cutoffDay > daysInMonth(LEAP_YEAR, cutoffMonth)
    || ageYears < 4 || ageYears > 8) {
    throw new ServiceError(400, 'invalid_school_cutoff')
  }
  getSchoolSettings(db, facilityId)
  db.update(facilities)
    .set({ schoolCutoffMonth: cutoffMonth, schoolCutoffDay: cutoffDay, schoolAgeYears: ageYears })
    .where(eq(facilities.id, facilityId)).run()
}

/**
 * The input of the occupancy table: the facility's contract children (those who left included), each with the stay from
 * its contract start to its last day (`left_on`, else the day before the school start). The group history is only the
 * child's group today. Contract children without a start are listed as undated; those whose stay ends before it starts
 * (left before the start, or already of school age at the start) never count and are listed as inconsistent.
 * Everything is in the order last name, first name, id.
 */
export function occupancyChildren(db: Db, facilityId: number): {
  children: OccupancyChild[]; names: Record<number, string>
  undated: { id: number; name: string }[]; inconsistent: { id: number; name: string }[]
} {
  const cutoff = schoolCutoffOf(db, facilityId)
  const rows = db.select().from(children)
    .where(and(eq(children.facilityId, facilityId), eq(children.admissionStatus, 'contract'))).all()
    .sort((a, b) => a.lastName.localeCompare(b.lastName, 'de') || a.firstName.localeCompare(b.firstName, 'de') || a.id - b.id)
  const names: Record<number, string> = {}
  const undated: { id: number; name: string }[] = []
  const inconsistent: { id: number; name: string }[] = []
  const result = rows.map((row): OccupancyChild => {
    const name = `${row.firstName} ${row.lastName}`
    names[row.id] = name
    const start = row.entryDate ?? row.plannedEntryDate
    const end = row.leftOn ?? addDays(effectiveSchoolStart(row.schoolStartDate, row.birthDate, cutoff), -1)
    if (start === null) undated.push({ id: row.id, name })
    else if (end < start) inconsistent.push({ id: row.id, name })
    return { id: row.id, start, end, groups: [{ from: null, groupId: row.groupId }] }
  })
  return { children: result, names, undated, inconsistent }
}
