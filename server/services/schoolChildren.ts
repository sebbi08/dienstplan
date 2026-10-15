import { and, asc, eq, isNull } from 'drizzle-orm'
import { childStatus, purgeDate } from '../../shared/domain/children'
import { addDays, daysInMonth } from '../../shared/domain/dates'
import { groupOnDay, type GroupEntry, type OccupancyChild } from '../../shared/domain/occupancy'
import { effectiveSchoolStart, type SchoolCutoff } from '../../shared/domain/schoolStart'
import { schoolCutoffOf as stateSchoolCutoff } from '../../shared/domain/states'
import type { IsoDate } from '../../shared/domain/types'
import type { GroupDto, SchoolCutoffInput, SchoolLeaverDto, SchoolSettingsDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { children, facilities } from '../db/schema'
import { switchAutoLeaveOff } from '../lib/autoLeave'
import { ServiceError } from '../lib/errors'
import { getChildRetentionYears } from './appSettings'
import { contractChangeDays, groupHistories, registerLeaving } from './childGroupChanges'
import { listGroups } from './groups'

type ChildRow = typeof children.$inferSelect

/** A leap year, so that 29 February is a valid cutoff day. */
const LEAP_YEAR = 2024

/**
 * The facility's school settings (a new facility starts with the cutoff of its state and no automatic leaving) and, for
 * the offer to adopt it, the cutoff the school law of its state names.
 */
export function getSchoolSettings(db: Db, facilityId: number): SchoolSettingsDto {
  const row = db.select({
    month: facilities.schoolCutoffMonth, day: facilities.schoolCutoffDay, ageYears: facilities.schoolAgeYears,
    autoLeave: facilities.autoLeaveSchoolChildren, state: facilities.state,
  }).from(facilities).where(eq(facilities.id, facilityId)).get()
  if (!row) throw new ServiceError(404, 'facility_not_found')
  const law = stateSchoolCutoff(row.state)
  return {
    cutoffMonth: row.month, cutoffDay: row.day, ageYears: row.ageYears, autoLeave: row.autoLeave,
    stateCutoff: { cutoffMonth: law.month, cutoffDay: law.day, ageYears: law.ageYears },
  }
}

/** The facility's settings as the domain's cutoff. */
export function schoolCutoffOf(db: Db, facilityId: number): SchoolCutoff {
  const settings = getSchoolSettings(db, facilityId)
  return { month: settings.cutoffMonth, day: settings.cutoffDay, ageYears: settings.ageYears }
}

/**
 * Stores the cutoff: a real calendar day (29 February allowed) and an age of 4 to 8 years, else 400
 * invalid_school_cutoff. Another cutoff than before moves school starts, so it switches the facility's automatic
 * leaving off in the same transaction: the Träger sees whom it takes now before switching it on again. Returns the
 * settings as they are afterwards and whether the switch was on and is off now.
 */
export function setSchoolCutoff(
  db: Db, facilityId: number, input: SchoolCutoffInput,
): { settings: SchoolSettingsDto; autoLeaveSwitchedOff: boolean } {
  const { cutoffMonth, cutoffDay, ageYears } = input
  const wholeNumbers = [cutoffMonth, cutoffDay, ageYears].every(Number.isInteger)
  if (!wholeNumbers || cutoffMonth < 1 || cutoffMonth > 12 || cutoffDay < 1 || cutoffDay > daysInMonth(LEAP_YEAR, cutoffMonth)
    || ageYears < 4 || ageYears > 8) {
    throw new ServiceError(400, 'invalid_school_cutoff')
  }
  return db.transaction((tx) => {
    const stored = getSchoolSettings(tx, facilityId)
    let autoLeaveSwitchedOff = false
    if (stored.cutoffMonth !== cutoffMonth || stored.cutoffDay !== cutoffDay || stored.ageYears !== ageYears) {
      tx.update(facilities)
        .set({ schoolCutoffMonth: cutoffMonth, schoolCutoffDay: cutoffDay, schoolAgeYears: ageYears })
        .where(eq(facilities.id, facilityId)).run()
      autoLeaveSwitchedOff = switchAutoLeaveOff(tx, facilityId)
    }
    return { settings: getSchoolSettings(tx, facilityId), autoLeaveSwitchedOff }
  })
}

/**
 * The Träger switches the automatic leaving of the facility's school children on or off (404 facility_not_found).
 *
 * Switching on needs the children the Träger has just seen in the preview (`schoolLeavers`), each with the leaving day
 * shown there (the preview's entries can be passed as they are). They must be exactly the children it would
 * deregister now, with exactly these leaving days, in any order (409 auto_leave_preview_changed otherwise, and nothing
 * changes). Then the switch is stored and these children are deregistered in the same transaction, so what was
 * confirmed is what happens. Returns how many children were deregistered. Switching off needs no list and deregisters
 * nobody.
 */
export function setAutoLeave(
  db: Db, facilityId: number, value: boolean, today: IsoDate, confirmed: Pick<SchoolLeaverDto, 'id' | 'leftOn'>[] = [],
): number {
  return db.transaction((tx) => {
    getSchoolSettings(tx, facilityId)
    if (value) {
      const key = (child: Pick<SchoolLeaverDto, 'id' | 'leftOn'>) => `${child.id}:${child.leftOn}`
      const confirmedKeys = new Set(confirmed.map(key))
      const leavers = schoolLeavers(tx, facilityId, today)
      if (leavers.length !== confirmedKeys.size || leavers.some(leaver => !confirmedKeys.has(key(leaver)))) {
        throw new ServiceError(409, 'auto_leave_preview_changed')
      }
    }
    tx.update(facilities).set({ autoLeaveSchoolChildren: value }).where(eq(facilities.id, facilityId)).run()
    return value ? leaveFacilitySchoolChildren(tx, facilityId, today) : 0
  })
}

/** What the school rules say about a child. */
export interface SchoolFacts {
  /** The manual school start, else the one the facility's cutoff yields from the birth date. */
  schoolStart: IsoDate
  /**
   * The group for school children that makes the child stay: the one it is in on its school start, else the first one
   * its group history enters afterwards (planned changes included, so an after-school contract that starts some days
   * into the school year counts). null = none, so its stay ends the day before the school start.
   */
  schoolGroup: GroupDto | null
}

/**
 * The school rules of a facility, loaded once for all its children: the one place that says when a child's school
 * start is and whether a group for school children makes it stay. The occupancy, the automatic leaving, its preview,
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
      // The histories come in the history order: the group on the school start, then those of the later entries.
      const history = histories.get(row.id) ?? []
      const fromSchoolStart = [
        groupOnDay(history, schoolStart),
        ...history.filter(entry => entry.from !== null && entry.from > schoolStart).map(entry => entry.groupId),
      ]
      const staysIn = fromSchoolStart.find(groupId => groupId !== null && schoolGroups.has(groupId))
      return { schoolStart, schoolGroup: staysIn == null ? null : schoolGroups.get(staysIn)! }
    },
  }
}

const byName = (a: ChildRow, b: ChildRow) =>
  a.lastName.localeCompare(b.lastName, 'de') || a.firstName.localeCompare(b.firstName, 'de') || a.id - b.id

/**
 * The input of the occupancy table: the facility's contract children (those who left included), each with the stay from
 * its contract start to its last day and its group history, planned changes included. The last day is `left_on`, else
 * the day before the school start; a child a group for school children makes stay (see `SchoolFacts`) stays for good (open).
 * Contract children without a start are listed as undated; those whose stay ends before it starts (left before the
 * start, or already of school age at the start without such a group) never count and are listed as inconsistent.
 *
 * A child whose record was moved here from another facility counts here from the day of the move (the record's
 * `facilitySince`), not from its contract start: the time before belongs to the other facility. One whose stay had
 * ended by then never counts here, and its dates are not called inconsistent for that.
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
    const contractStart = row.entryDate ?? row.plannedEntryDate
    const { schoolStart, schoolGroup } = rules.factsOf(row)
    const end = row.leftOn ?? (schoolGroup === null ? addDays(schoolStart, -1) : null)
    if (contractStart === null) undated.push({ id: row.id, name })
    else if (end !== null && end < contractStart) inconsistent.push({ id: row.id, name })
    // The stay in this facility: from the day the record was moved here, when that is after the contract start.
    const start = contractStart !== null && row.facilitySince !== null && row.facilitySince > contractStart
      ? row.facilitySince
      : contractStart
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

/** The child's school start is reached and no group for school children makes it stay: its stay has ended. */
export function isSchoolStartDue(child: SchoolFacts, today: IsoDate): boolean {
  return child.schoolStart <= today && child.schoolGroup === null
}

/**
 * The one selection of the automatic leaving: the facility's active contract children without a leaving day whose
 * school start is reached and whom no group for school children makes stay, each with the leaving day it gets (the day
 * before its school start, however long ago that is) and the day its record is deleted with that (the leaving day plus
 * the retention period, always after today). The daily run deregisters exactly these, switching on
 * deregisters exactly these and the preview shows exactly these, so they cannot differ. The switch plays no part
 * here: this is what happens once it is on.
 *
 * Three kinds of children are left out, because nobody could have expected what the leaving day would do to them: a
 * child that only started on or after its school start (it would have left before it came; the occupancy lists it as
 * inconsistent), a child whose record would be deleted at once (its leaving day is already past the retention
 * period), and a child with a group change after the leaving day that carries a further care contract, planned or
 * applied (somebody concluded a contract for that time; its group may only have lost the flag "for school children"
 * by mistake, and a planned change would be deleted with the leaving). They stay active, and in the list of the
 * coming school children, until somebody decides about them by hand.
 */
export function schoolLeavers(db: Db, facilityId: number, today: IsoDate): SchoolLeaverDto[] {
  const retentionYears = getChildRetentionYears(db)
  const contractChanges = contractChangeDays(db, facilityId)
  const leavers: SchoolLeaverDto[] = []
  for (const child of activeSchoolChildren(db, facilityId, today)) {
    if (!isSchoolStartDue(child, today)) continue
    const { row, schoolStart } = child
    const leftOn = addDays(schoolStart, -1)
    // An active child has an entry day.
    const leftBeforeStart = leftOn < row.entryDate!
    const purgeOn = purgeDate(leftOn, retentionYears)
    const deletedAtOnce = purgeOn <= today
    const contractChange = contractChanges.get(row.id)
    const hasLaterContract = contractChange !== undefined && contractChange > leftOn
    if (leftBeforeStart || deletedAtOnce || hasLaterContract) continue
    leavers.push({ id: row.id, name: `${row.firstName} ${row.lastName}`, schoolStart, leftOn, purgeOn })
  }
  return leavers
}

/** Whether the next daily run would deregister the child: its facility's switch is on and `schoolLeavers` selects it. */
export function leavesAtNextRun(db: Db, facilityId: number, childId: number, today: IsoDate): boolean {
  return getSchoolSettings(db, facilityId).autoLeave && schoolLeavers(db, facilityId, today).some(leaver => leaver.id === childId)
}

/**
 * Guards a single write to a child's record or group history against the automatic leaving. The Träger has seen whom
 * it takes only when switching it on, so no edit of one child may hand it a further one without anybody seeing it: a
 * write after which the next run would deregister the child, though it would not have before, is refused
 * (409 would_deregister). A child the run takes anyway can be edited as before, and with the switch off nothing is
 * refused. Whether it would is asked of the leaving's own selection, like for a move into the facility.
 *
 * Call it inside the write's transaction before writing (`childId` left out: the write creates the child), then call
 * what it returns with the child's id after writing; the refusal rolls the whole write back.
 */
export function guardAgainstLeaving(db: Db, facilityId: number, today: IsoDate, childId?: number): (childId: number) => void {
  const takenAnyway = childId !== undefined && leavesAtNextRun(db, facilityId, childId, today)
  return (writtenId) => {
    if (!takenAnyway && leavesAtNextRun(db, facilityId, writtenId, today)) throw new ServiceError(409, 'would_deregister')
  }
}

/**
 * Deregisters the facility's children `schoolLeavers` selects: each leaves on the day before its school start, like a
 * child that is deregistered by hand (a planned group change after that day is deleted). They are archived with that;
 * the retention period runs from the leaving day. Returns how many. Must run inside a transaction.
 */
function leaveFacilitySchoolChildren(db: Db, facilityId: number, today: IsoDate): number {
  const leavers = schoolLeavers(db, facilityId, today)
  for (const leaver of leavers) registerLeaving(db, leaver.id, leaver.leftOn)
  return leavers.length
}

/**
 * The daily run: deregisters the school children of every facility with the switch on (see
 * `leaveFacilitySchoolChildren`) and returns how many. Running it again changes nothing, because a child with a
 * leaving day is never selected. Each facility has its own transaction: when one fails, nothing of it is written, the
 * others are done all the same and the next run tries again. The failure is logged with the facility's id only.
 */
export function leaveSchoolChildren(db: Db, today: IsoDate, log: Pick<Console, 'error'> = console): number {
  const switchedOn = db.select({ id: facilities.id }).from(facilities)
    .where(eq(facilities.autoLeaveSchoolChildren, true)).orderBy(asc(facilities.id)).all()
  let deregistered = 0
  for (const facility of switchedOn) {
    try {
      deregistered += db.transaction(tx => leaveFacilitySchoolChildren(tx, facility.id, today))
    }
    catch (error) {
      log.error(`Deregistering the school children of facility ${facility.id} failed`, error)
    }
  }
  return deregistered
}
