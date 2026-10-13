import { and, eq, isNull } from 'drizzle-orm'
import { childStatus, purgeDate } from '../../shared/domain/children'
import { addDays, daysInMonth } from '../../shared/domain/dates'
import type { GroupEntry, OccupancyChild } from '../../shared/domain/occupancy'
import { effectiveSchoolStart, type SchoolCutoff } from '../../shared/domain/schoolStart'
import type { IsoDate } from '../../shared/domain/types'
import type { GroupDto, SchoolCutoffInput, SchoolLeaverDto, SchoolSettingsDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { children, facilities } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { getChildRetentionYears } from './appSettings'
import { groupHistories, registerLeaving } from './childGroupChanges'
import { listGroups } from './groups'

type ChildRow = typeof children.$inferSelect

/** A leap year, so that 29 February is a valid cutoff day. */
const LEAP_YEAR = 2024

/** The facility's school settings (the defaults for a new facility are 30 June, 6 years and no automatic leaving). */
export function getSchoolSettings(db: Db, facilityId: number): SchoolSettingsDto {
  const row = db.select({
    month: facilities.schoolCutoffMonth, day: facilities.schoolCutoffDay, ageYears: facilities.schoolAgeYears,
    autoLeave: facilities.autoLeaveSchoolChildren,
  }).from(facilities).where(eq(facilities.id, facilityId)).get()
  if (!row) throw new ServiceError(404, 'facility_not_found')
  return { cutoffMonth: row.month, cutoffDay: row.day, ageYears: row.ageYears, autoLeave: row.autoLeave }
}

/** The facility's settings as the domain's cutoff. */
export function schoolCutoffOf(db: Db, facilityId: number): SchoolCutoff {
  const settings = getSchoolSettings(db, facilityId)
  return { month: settings.cutoffMonth, day: settings.cutoffDay, ageYears: settings.ageYears }
}

/** Stores the cutoff: a real calendar day (29 February allowed) and an age of 4 to 8 years, else 400 invalid_school_cutoff. */
export function setSchoolCutoff(db: Db, facilityId: number, input: SchoolCutoffInput): void {
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
 * The Träger switches the automatic leaving of the facility's school children on or off (404 facility_not_found). It
 * only stores the switch: the daily run (`leaveSchoolChildren`) does the rest, and `schoolLeavers` says beforehand whom.
 */
export function setAutoLeave(db: Db, facilityId: number, value: boolean): void {
  getSchoolSettings(db, facilityId)
  db.update(facilities).set({ autoLeaveSchoolChildren: value }).where(eq(facilities.id, facilityId)).run()
}

/** What the school rules say about a child. */
export interface SchoolFacts {
  /** The manual school start, else the one the facility's cutoff yields from the birth date. */
  schoolStart: IsoDate
  /**
   * The group for school children the child is in on its school start, by its group history with the planned changes;
   * null = none, so its stay ends the day before the school start.
   */
  schoolGroup: GroupDto | null
}

/** The group a history (in the history order) gives on a day: its last entry from that day or earlier. */
function groupOn(history: GroupEntry[], day: IsoDate): number | null {
  let groupId: number | null = null
  for (const entry of history) {
    if (entry.from === null || entry.from <= day) groupId = entry.groupId
  }
  return groupId
}

/**
 * The school rules of a facility, loaded once for all its children: the one place that says when a child's school
 * start is and whether it is in a group for school children then. The occupancy, the automatic leaving, its preview,
 * the list of the coming school children and taking a leaving back all judge by it. A group of another facility in
 * the history (from before the child moved here) counts as no group, whatever it is flagged as there.
 */
export function schoolRules(db: Db, facilityId: number): {
  histories: Map<number, GroupEntry[]>
  factsOf: (row: Pick<ChildRow, 'id' | 'birthDate' | 'schoolStartDate'>) => SchoolFacts
} {
  const cutoff = schoolCutoffOf(db, facilityId)
  const histories = groupHistories(db, facilityId)
  const schoolGroups = new Map(listGroups(db, facilityId).filter(group => group.forSchoolChildren).map(group => [group.id, group]))
  return {
    histories,
    factsOf: (row) => {
      const schoolStart = effectiveSchoolStart(row.schoolStartDate, row.birthDate, cutoff)
      const groupId = groupOn(histories.get(row.id) ?? [], schoolStart)
      return { schoolStart, schoolGroup: groupId === null ? null : schoolGroups.get(groupId) ?? null }
    },
  }
}

const byName = (a: ChildRow, b: ChildRow) =>
  a.lastName.localeCompare(b.lastName, 'de') || a.firstName.localeCompare(b.firstName, 'de') || a.id - b.id

/**
 * The input of the occupancy table: the facility's contract children (those who left included), each with the stay from
 * its contract start to its last day and its group history, planned changes included. The last day is `left_on`, else
 * the day before the school start; a child in a group for school children on its school start stays for good (open).
 * Contract children without a start are listed as undated; those whose stay ends before it starts (left before the
 * start, or already of school age at the start without such a group) never count and are listed as inconsistent.
 * Everything is in the order last name, first name, id.
 */
export function occupancyChildren(db: Db, facilityId: number): {
  children: OccupancyChild[]; names: Record<number, string>
  undated: { id: number; name: string }[]; inconsistent: { id: number; name: string }[]
} {
  const rules = schoolRules(db, facilityId)
  const rows = db.select().from(children)
    .where(and(eq(children.facilityId, facilityId), eq(children.admissionStatus, 'contract'))).all().sort(byName)
  const names: Record<number, string> = {}
  const undated: { id: number; name: string }[] = []
  const inconsistent: { id: number; name: string }[] = []
  const result = rows.map((row): OccupancyChild => {
    const name = `${row.firstName} ${row.lastName}`
    names[row.id] = name
    const start = row.entryDate ?? row.plannedEntryDate
    const { schoolStart, schoolGroup } = rules.factsOf(row)
    const end = row.leftOn ?? (schoolGroup === null ? addDays(schoolStart, -1) : null)
    if (start === null) undated.push({ id: row.id, name })
    else if (end !== null && end < start) inconsistent.push({ id: row.id, name })
    return { id: row.id, start, end, groups: rules.histories.get(row.id) ?? [] }
  })
  return { children: result, names, undated, inconsistent }
}

/** A child the school rules can concern today, with what they say about it. */
export interface SchoolChild extends SchoolFacts {
  row: ChildRow
}

/**
 * The facility's children the school rules can concern today, ordered by name: contract children that are active (so
 * neither a Vormerkung nor a child that has not started nor an archived one) and have no leaving day. A leaving day
 * somebody registered, also a later one, is never touched.
 */
export function activeSchoolChildren(db: Db, facilityId: number, today: IsoDate): SchoolChild[] {
  const rules = schoolRules(db, facilityId)
  return db.select().from(children)
    .where(and(eq(children.facilityId, facilityId), eq(children.admissionStatus, 'contract'), isNull(children.leftOn))).all()
    .filter(row => childStatus(row, today) === 'active')
    .sort(byName)
    .map(row => ({ row, ...rules.factsOf(row) }))
}

/** The child's school start is reached and it is not in a group for school children on it: its stay has ended. */
export function isSchoolStartDue(child: SchoolFacts, today: IsoDate): boolean {
  return child.schoolStart <= today && child.schoolGroup === null
}

/**
 * The one selection of the automatic leaving: the facility's active contract children without a leaving day whose
 * school start is reached and who are not in a group for school children on it, each with the leaving day it gets (the
 * day before its school start, however long ago that is). The daily run deregisters exactly these and the preview
 * shows exactly these, so they cannot differ. The switch plays no part here: this is what the run does once it is on.
 *
 * Two kinds of children are left out, because nobody could have expected what the leaving day would do to them: a
 * child that only started on or after its school start (it would have left before it came; the occupancy lists it as
 * inconsistent), and a child whose record would be deleted at once (its leaving day is already past the retention
 * period). Both stay active, and in the list of the coming school children, until somebody decides about them by hand.
 */
export function schoolLeavers(db: Db, facilityId: number, today: IsoDate): SchoolLeaverDto[] {
  const retentionYears = getChildRetentionYears(db)
  const leavers: SchoolLeaverDto[] = []
  for (const child of activeSchoolChildren(db, facilityId, today)) {
    if (!isSchoolStartDue(child, today)) continue
    const { row, schoolStart } = child
    const leftOn = addDays(schoolStart, -1)
    const leftBeforeStart = row.entryDate === null || leftOn < row.entryDate
    if (leftBeforeStart || purgeDate(leftOn, retentionYears) <= today) continue
    leavers.push({ id: row.id, name: `${row.firstName} ${row.lastName}`, schoolStart, leftOn })
  }
  return leavers
}

/**
 * The daily run: in every facility with the switch on, the children `schoolLeavers` selects leave on the day before
 * their school start, like a child that is deregistered by hand (a planned group change after that day is deleted).
 * They are archived with that; the retention period runs from the leaving day. Returns how many children were
 * deregistered. Running it again changes nothing, because a child with a leaving day is never selected.
 */
export function leaveSchoolChildren(db: Db, today: IsoDate): number {
  return db.transaction((tx) => {
    const switchedOn = tx.select({ id: facilities.id }).from(facilities).where(eq(facilities.autoLeaveSchoolChildren, true)).all()
    let deregistered = 0
    for (const facility of switchedOn) {
      for (const leaver of schoolLeavers(tx, facility.id, today)) {
        registerLeaving(tx, leaver.id, leaver.leftOn)
        deregistered += 1
      }
    }
    return deregistered
  })
}
