import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import { eventLastDay, type EventVisibility } from '../../shared/domain/calendarEvents'
import { employmentStart } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import type {
  EmployeeRequirementsDto, EventAttendanceDto, PlannedRequirementDto,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { calendarEventEmployees, calendarEventGroups, calendarEvents, employeeRequirements, employees, requirementTypes } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { listGroups } from './groups'
import { loadEmployees, type EmployeeRecord } from './queries'
import { addRequirementRecord } from './requirements'

/**
 * Pflichttermine as appointments („Pflichttermin“ in the appointment dialog): an appointment names a kind of mandatory
 * appointment (calendar_events.requirement_type_id), and the people „Wer sieht den Termin?“ names are its participants
 * (everyone / the home groups / the chosen people). Before it: „geplant am …“ at the kind of each participant. From its
 * (last) day on: the Leitung confirms who took part („Teilnahme bestätigen“); each ticked person gets an entry of the kind
 * on the last day, exactly as if entered by hand (addRequirementRecord, so its rules apply), linked to the appointment
 * (employee_requirements.calendar_event_id): a new confirmation changes or removes only these entries.
 */

/** The appointment as this service reads it. */
interface RequirementEvent {
  id: number
  facilityId: number
  title: string
  date: IsoDate
  endDate: IsoDate | null
  visibility: EventVisibility
  requirementTypeId: number | null
  attendanceConfirmedAt: string | null
  groupIds: number[]
  employeeIds: number[]
}

const columns = {
  id: calendarEvents.id, facilityId: calendarEvents.facilityId, title: calendarEvents.title, date: calendarEvents.date,
  endDate: calendarEvents.endDate, visibility: calendarEvents.visibility, requirementTypeId: calendarEvents.requirementTypeId,
  attendanceConfirmedAt: calendarEvents.attendanceConfirmedAt,
}

/** The appointments' rows with their chosen groups and people. */
function withLists(db: Db, rows: Omit<RequirementEvent, 'groupIds' | 'employeeIds'>[]): RequirementEvent[] {
  if (rows.length === 0) return []
  const ids = rows.map(row => row.id)
  const groupRows = db.select().from(calendarEventGroups).where(inArray(calendarEventGroups.eventId, ids)).all()
  const personRows = db.select().from(calendarEventEmployees).where(inArray(calendarEventEmployees.eventId, ids)).all()
  return rows.map(row => ({
    ...row,
    groupIds: groupRows.filter(item => item.eventId === row.id).map(item => item.groupId),
    employeeIds: personRows.filter(item => item.eventId === row.id).map(item => item.employeeId),
  }))
}

/** The facility's Pflichttermin appointment with this id: 404 event_not_found, 400 event_not_requirement for an ordinary one. */
function requirementEvent(db: Db, facilityId: number, id: number): RequirementEvent & { requirementTypeId: number } {
  const row = db.select(columns).from(calendarEvents).where(and(eq(calendarEvents.id, id), eq(calendarEvents.facilityId, facilityId))).get()
  if (!row) throw new ServiceError(404, 'event_not_found')
  if (row.requirementTypeId === null) throw new ServiceError(400, 'event_not_requirement')
  return withLists(db, [row])[0]! as RequirementEvent & { requirementTypeId: number }
}

/** Start of employment as the Pflichttermine count it: „beschäftigt seit“, else the first weekly hours (null = unknown). */
const startOf = (employee: EmployeeRecord): IsoDate | null => employee.employedSince ?? employmentStart(employee.info)

/**
 * The facility's own employees the appointment is meant for: everyone (`all`), those whose home group is one of the
 * chosen (`groups`; the home group as it is now – the app keeps no history of it), the chosen people (`employees`);
 * nobody for 'leaders'. Not those who left before its first day, nor those starting after its last day.
 */
export function intendedParticipants(employeesOfFacility: readonly EmployeeRecord[], event: Pick<RequirementEvent, 'date' | 'endDate' | 'visibility' | 'groupIds' | 'employeeIds'>): EmployeeRecord[] {
  const last = eventLastDay(event)
  return employeesOfFacility.filter((employee) => {
    if (employee.leftOn !== null && employee.leftOn < event.date) return false
    const start = startOf(employee)
    if (start !== null && start > last) return false
    switch (event.visibility) {
      case 'all': return true
      case 'groups': return employee.groupId !== null && event.groupIds.includes(employee.groupId)
      case 'employees': return event.employeeIds.includes(employee.id)
      default: return false
    }
  })
}

/** The entries an appointment's confirmation created, of the facility's own employees. */
function linkedEntries(db: Db, facilityId: number, eventId: number) {
  return db.select({ id: employeeRequirements.id, employeeId: employeeRequirements.employeeId, typeId: employeeRequirements.typeId, date: employeeRequirements.date })
    .from(employeeRequirements)
    .innerJoin(employees, eq(employees.id, employeeRequirements.employeeId))
    .where(and(eq(employeeRequirements.calendarEventId, eventId), eq(employees.facilityId, facilityId))).all()
}

/** Employees with an entry of the kind on that day entered by hand (not from an appointment). */
function handEnteredOn(db: Db, employeeIds: number[], typeId: number, date: IsoDate): Set<number> {
  if (employeeIds.length === 0) return new Set()
  return new Set(db.select({ employeeId: employeeRequirements.employeeId }).from(employeeRequirements).where(and(
    inArray(employeeRequirements.employeeId, employeeIds), eq(employeeRequirements.typeId, typeId), eq(employeeRequirements.date, date),
    isNull(employeeRequirements.calendarEventId),
  )).all().map(row => row.employeeId))
}

/** The people of „Teilnahme bestätigen“: the intended ones now, and anyone an earlier confirmation recorded. */
function attendanceRoster(db: Db, facilityId: number, event: RequirementEvent & { requirementTypeId: number }) {
  const staff = loadEmployees(db, facilityId)
  const linked = linkedEntries(db, facilityId, event.id)
  const linkedIds = new Set(linked.map(entry => entry.employeeId))
  const intended = new Set(intendedParticipants(staff, event).map(employee => employee.id))
  const people = staff.filter(employee => intended.has(employee.id) || linkedIds.has(employee.id))
  const recordDate = eventLastDay(event)
  const hand = handEnteredOn(db, people.map(employee => employee.id), event.requirementTypeId, recordDate)
  return { people, linked, linkedIds, hand, recordDate }
}

/** „Teilnahme bestätigen“: the appointment and its people, ticked as they would be saved now. */
export function getEventAttendance(db: Db, facilityId: number, eventId: number, today: IsoDate): EventAttendanceDto {
  const event = requirementEvent(db, facilityId, eventId)
  const type = db.select({ name: requirementTypes.name }).from(requirementTypes).where(eq(requirementTypes.id, event.requirementTypeId)).get()!
  const { people, linkedIds, hand, recordDate } = attendanceRoster(db, facilityId, event)
  const groupNames = new Map(listGroups(db, facilityId).map(group => [group.id, group.name]))
  const confirmed = event.attendanceConfirmedAt !== null
  return {
    eventId: event.id, title: event.title, date: event.date, endDate: event.endDate, typeName: type.name, recordDate,
    canConfirm: recordDate <= today, confirmedAt: event.attendanceConfirmedAt,
    people: people.map(employee => ({
      employeeId: employee.id, name: employee.name,
      groupName: employee.groupId === null ? null : groupNames.get(employee.groupId) ?? null,
      attended: hand.has(employee.id) || (confirmed ? linkedIds.has(employee.id) : true),
      handEntered: hand.has(employee.id),
    })),
  }
}

/**
 * Saves „Teilnahme bestätigen“: every ticked person (`attended`) of the roster gets an entry of the kind on the last day
 * (an earlier one from this appointment is kept or moved to that day and kind; a hand-entered one on that day stays and
 * none is added); for everyone else of the roster the entries from this appointment go – hand-entered ones never. Only
 * from the (last) day on (400 event_not_over); a person not on the roster: 400 attendance_person_invalid.
 */
export function confirmEventAttendance(
  db: Db, facilityId: number, eventId: number, attended: readonly number[], today: IsoDate, now: Date = new Date(),
): void {
  const event = requirementEvent(db, facilityId, eventId)
  const { people, linked, hand, recordDate } = attendanceRoster(db, facilityId, event)
  if (recordDate > today) throw new ServiceError(400, 'event_not_over')
  const roster = new Set(people.map(employee => employee.id))
  const ticked = new Set(attended)
  if ([...ticked].some(id => !roster.has(id))) throw new ServiceError(400, 'attendance_person_invalid')
  db.transaction((tx) => {
    for (const employee of people) {
      const own = linked.filter(entry => entry.employeeId === employee.id)
      if (hand.has(employee.id)) continue
      if (!ticked.has(employee.id)) {
        if (own.length) tx.delete(employeeRequirements).where(inArray(employeeRequirements.id, own.map(entry => entry.id))).run()
        continue
      }
      if (own.length) {
        tx.update(employeeRequirements).set({ date: recordDate, typeId: event.requirementTypeId })
          .where(inArray(employeeRequirements.id, own.map(entry => entry.id))).run()
        continue
      }
      // As if entered by hand: the same checks (own employee, own kind, no day ahead, no note where none is allowed).
      const id = addRequirementRecord(tx, facilityId, employee.id, { typeId: event.requirementTypeId, date: recordDate }, today)
      tx.update(employeeRequirements).set({ calendarEventId: event.id }).where(eq(employeeRequirements.id, id)).run()
    }
    tx.update(calendarEvents).set({ attendanceConfirmedAt: now.toISOString() }).where(eq(calendarEvents.id, event.id)).run()
  })
}

/**
 * A Pflichttermin appointment changed (updateCalendarEvent, in its transaction): the entries its confirmation created
 * follow it – to the new last day and kind; with „Pflichttermin“ taken off they stay as entered by hand (no link) and
 * the confirmation goes. A confirmed appointment cannot move ahead of today (400 event_confirmed_future): its entries
 * would lie in the future. Nothing to do before a confirmation.
 */
export function followConfirmedEvent(
  tx: Db, eventId: number,
  before: { requirementTypeId: number | null; attendanceConfirmedAt: string | null },
  after: { requirementTypeId: number | null; date: IsoDate; endDate: IsoDate | null },
  today: IsoDate,
): { attendanceConfirmedAt: string | null } {
  if (before.attendanceConfirmedAt === null || before.requirementTypeId === null || after.requirementTypeId === null) {
    if (before.attendanceConfirmedAt !== null) {
      tx.update(employeeRequirements).set({ calendarEventId: null }).where(eq(employeeRequirements.calendarEventId, eventId)).run()
    }
    return { attendanceConfirmedAt: null }
  }
  const last = eventLastDay(after)
  if (last > today) throw new ServiceError(400, 'event_confirmed_future')
  tx.update(employeeRequirements).set({ date: last, typeId: after.requirementTypeId })
    .where(eq(employeeRequirements.calendarEventId, eventId)).run()
  return { attendanceConfirmedAt: before.attendanceConfirmedAt }
}

/** The facility's Pflichttermin appointments not confirmed whose last day is on or after `from` and first day on or before `to`. */
function unconfirmedEvents(db: Db, facilityId: number, where: { lastFrom?: IsoDate; lastTo?: IsoDate }): RequirementEvent[] {
  const last = sql<string>`coalesce(${calendarEvents.endDate}, ${calendarEvents.date})`
  return withLists(db, db.select(columns).from(calendarEvents).where(and(
    eq(calendarEvents.facilityId, facilityId), isNotNull(calendarEvents.requirementTypeId), isNull(calendarEvents.attendanceConfirmedAt),
    where.lastFrom === undefined ? undefined : gte(last, where.lastFrom),
    where.lastTo === undefined ? undefined : lte(last, where.lastTo),
  )).orderBy(asc(calendarEvents.date), asc(calendarEvents.id)).all())
}

/**
 * „geplant am …“: per employee and kind (key `employeeId:typeId`) the earliest Pflichttermin appointment ahead (last day
 * today or later, not confirmed) the employee is meant for (intendedParticipants).
 */
export function plannedRequirements(db: Db, facilityId: number, today: IsoDate): Map<string, PlannedRequirementDto> {
  const planned = new Map<string, PlannedRequirementDto>()
  const events = unconfirmedEvents(db, facilityId, { lastFrom: today })
  if (events.length === 0) return planned
  const staff = loadEmployees(db, facilityId)
  for (const event of events) {
    for (const employee of intendedParticipants(staff, event)) {
      const key = `${employee.id}:${event.requirementTypeId}`
      if (!planned.has(key)) planned.set(key, { eventId: event.id, date: event.date, endDate: event.endDate })
    }
  }
  return planned
}

/** The employee page's Pflichttermine with „geplant am …“ at each kind an appointment ahead is planned for. */
export function withPlannedRequirements(
  db: Db, facilityId: number, employeeId: number, dto: EmployeeRequirementsDto, today: IsoDate,
): EmployeeRequirementsDto {
  const planned = plannedRequirements(db, facilityId, today)
  return {
    ...dto,
    kinds: dto.kinds.map((kind) => {
      const next = planned.get(`${employeeId}:${kind.type.id}`)
      return next ? { ...kind, planned: next } : kind
    }),
  }
}

/**
 * For „Offen für dich“ of the Leitung: the facility's Pflichttermin appointments from their (last) day on whose
 * attendance is not confirmed yet, earliest first.
 */
export function unconfirmedAttendance(db: Db, facilityId: number, today: IsoDate): { id: number; date: IsoDate }[] {
  return unconfirmedEvents(db, facilityId, { lastTo: today }).map(event => ({ id: event.id, date: event.date }))
}
