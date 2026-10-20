import { and, eq, gte, isNotNull, lte } from 'drizzle-orm'
import { childStatus, nextBirthday as nextChildBirthday } from '../../shared/domain/children'
import { addDays } from '../../shared/domain/dates'
import { groupOnDay } from '../../shared/domain/occupancy'
import { nextBirthday as nextStaffBirthday } from '../../shared/domain/reminders'
import { formatTime } from '../../shared/domain/time'
import type { IsoDate, Minutes } from '../../shared/domain/types'
import type { Db } from '../db/client'
import { childParentMeetings, children, employees } from '../db/schema'
import { groupHistories } from './childGroupChanges'
import { listGroups } from './groups'

/** The events of one day: child events counted per group (null = no group), meetings per time and group. */
interface DayEvents {
  settling: Map<number | null, number>
  meetings: Map<string, { start: Minutes; groupId: number | null; count: number }>
  birthdays: Map<number | null, number>
  staff: string[]
}

type ChildRow = Pick<typeof children.$inferSelect, 'id' | 'birthDate' | 'entryDate' | 'leftOn' | 'admissionStatus' | 'facilitySince'>

/** Whether the child is one of the facility's active children on that day (and was not still in another facility). */
function activeOn(child: ChildRow, date: IsoDate): boolean {
  return childStatus(child, date) === 'active' && (child.facilitySince === null || child.facilitySince <= date)
}

/** Every day in [from, to] that `next` (the next occurrence on or after a day) gives. */
function occurrences(next: (day: IsoDate) => IsoDate, from: IsoDate, to: IsoDate): IsoDate[] {
  const days: IsoDate[] = []
  for (let day = next(from); day <= to; day = next(addDays(day, 1))) days.push(day)
  return days
}

const counted = (count: number, text: string) => (count > 1 ? `${count}× ${text}` : text)

/**
 * The automatic, anonymous events of the facility's days in [from, to], for the plan's Info row and the year
 * calendar: Eingewöhnung (a child's entry day), Elterngespräch (every meeting, by time), Kindergeburtstag (an active
 * child's birthday) and the birthdays of the staff not left before the day. Child events name only the child's group
 * on that day (a group of the facility; none: no parenthesis) and are counted per group (meetings per time and group);
 * never a child's name or id, never a meeting's note. Only days with events are in the map, each in the order
 * Eingewöhnung, Elterngespräch (by time), Kindergeburtstag, Geburtstag (by name); groups in their order, no group last.
 * 29 February falls on 28 February in non-leap years. Computed when read, never stored with a release.
 */
export function autoEventsFor(db: Db, facilityId: number, from: IsoDate, to: IsoDate): Map<IsoDate, string[]> {
  const groups = listGroups(db, facilityId)
  const nameOf = new Map(groups.map(group => [group.id, group.name]))
  const rank = new Map(groups.map((group, index) => [group.id, index]))
  const byRank = (a: number | null, b: number | null) =>
    (a === null ? groups.length : rank.get(a)!) - (b === null ? groups.length : rank.get(b)!)
  const withGroup = (text: string, groupId: number | null) => (groupId === null ? text : `${text} (${nameOf.get(groupId)})`)

  const histories = groupHistories(db, facilityId)
  const groupOf = (childId: number, date: IsoDate): number | null => {
    const groupId = groupOnDay(histories.get(childId) ?? [], date)
    return groupId !== null && nameOf.has(groupId) ? groupId : null
  }

  const days = new Map<IsoDate, DayEvents>()
  const dayOf = (date: IsoDate): DayEvents => {
    let day = days.get(date)
    if (!day) {
      day = { settling: new Map(), meetings: new Map(), birthdays: new Map(), staff: [] }
      days.set(date, day)
    }
    return day
  }
  const count = (map: Map<number | null, number>, groupId: number | null) => map.set(groupId, (map.get(groupId) ?? 0) + 1)

  const rows: ChildRow[] = db.select({
    id: children.id, birthDate: children.birthDate, entryDate: children.entryDate, leftOn: children.leftOn,
    admissionStatus: children.admissionStatus, facilitySince: children.facilitySince,
  }).from(children).where(eq(children.facilityId, facilityId)).all()
  for (const child of rows) {
    const entry = child.entryDate
    if (entry !== null && entry >= from && entry <= to && activeOn(child, entry)) {
      count(dayOf(entry).settling, groupOf(child.id, entry))
    }
    for (const date of occurrences(day => nextChildBirthday(child.birthDate, day).date, from, to)) {
      if (activeOn(child, date)) count(dayOf(date).birthdays, groupOf(child.id, date))
    }
  }

  const child = new Map(rows.map(row => [row.id, row]))
  const meetings = db.select({ childId: childParentMeetings.childId, date: childParentMeetings.date, start: childParentMeetings.start })
    .from(childParentMeetings)
    .innerJoin(children, eq(children.id, childParentMeetings.childId))
    .where(and(eq(children.facilityId, facilityId), gte(childParentMeetings.date, from), lte(childParentMeetings.date, to)))
    .all()
  for (const meeting of meetings) {
    const since = child.get(meeting.childId)?.facilitySince ?? null
    if (since !== null && meeting.date < since) continue // held while the child was in another facility
    const groupId = groupOf(meeting.childId, meeting.date)
    const slots = dayOf(meeting.date).meetings
    const key = `${meeting.start}|${groupId ?? ''}`
    const slot = slots.get(key) ?? { start: meeting.start, groupId, count: 0 }
    slot.count += 1
    slots.set(key, slot)
  }

  const staff = db.select({ name: employees.name, birthday: employees.birthday, leftOn: employees.leftOn }).from(employees)
    .where(and(eq(employees.facilityId, facilityId), isNotNull(employees.birthday))).all()
  for (const employee of staff) {
    for (const date of occurrences(day => nextStaffBirthday(employee.birthday!, day), from, to)) {
      if (employee.leftOn === null || employee.leftOn >= date) dayOf(date).staff.push(employee.name)
    }
  }

  const result = new Map<IsoDate, string[]>()
  for (const date of [...days.keys()].sort()) {
    const day = days.get(date)!
    const perGroup = (map: Map<number | null, number>, text: string) =>
      [...map].sort(([a], [b]) => byRank(a, b)).map(([groupId, n]) => counted(n, withGroup(text, groupId)))
    result.set(date, [
      ...perGroup(day.settling, 'Eingewöhnung'),
      ...[...day.meetings.values()].sort((a, b) => a.start - b.start || byRank(a.groupId, b.groupId))
        .map(slot => counted(slot.count, withGroup(`Elterngespräch ${formatTime(slot.start)}`, slot.groupId))),
      ...perGroup(day.birthdays, 'Kindergeburtstag'),
      ...day.staff.sort((a, b) => a.localeCompare(b, 'de')).map(name => `Geburtstag ${name}`),
    ])
  }
  return result
}
