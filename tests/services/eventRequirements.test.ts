import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { calendarEvents, employeeRequirements, employees } from '../../server/db/schema'
import {
  createCalendarEvent, deleteCalendarEvent, getMyYearCalendar, getYearCalendar, listCalendarEvents, updateCalendarEvent,
  type CalendarEventInput,
} from '../../server/services/calendar'
import { listEmployeeListExtras } from '../../server/services/employeeListExtras'
import { moveEmployeeToFacility } from '../../server/services/employees'
import {
  confirmEventAttendance, getEventAttendance, intendedParticipants, plannedRequirements, withPlannedRequirements,
} from '../../server/services/eventRequirements'
import { myOpenItems } from '../../server/services/openItems'
import { loadEmployees } from '../../server/services/queries'
import {
  addRequirementRecord, createRequirementType, deleteRequirementType, getEmployeeRequirements,
} from '../../server/services/requirements'
import { PERMISSION_KEYS } from '../../shared/domain/permissions'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addGroup, addUser, createTestDb, errorCode, requirementTypeId } from '../helpers/fixtures'

const BEFORE = '2026-10-01'
const AFTER = '2026-10-20'
const NOW = new Date('2026-10-20T09:00:00.000Z')
const MAY = { mayRecord: true }

/** An appointment of facility 1 (one day, no time) with the given changes. */
const input = (changes: Partial<CalendarEventInput> = {}): CalendarEventInput => ({
  date: '2026-10-14', endDate: null, start: null, end: null, title: 'Erste Hilfe', visibility: 'all', groupIds: [], employeeIds: [], ...changes,
})

let db: Db
let baeren: number
let igel: number
let anna: number // Bären
let ben: number // Igel
let carla: number // no group
let firstAid: number
let leitung: SessionUser
let annaUser: SessionUser
let benUser: SessionUser

/** The entries of an employee and kind: date and the appointment that created them. */
const entries = (employeeId: number, typeId = firstAid) => db.select({ date: employeeRequirements.date, eventId: employeeRequirements.calendarEventId, note: employeeRequirements.note })
  .from(employeeRequirements).where(and(eq(employeeRequirements.employeeId, employeeId), eq(employeeRequirements.typeId, typeId)))
  .orderBy(employeeRequirements.date).all()
const kindOf = (employeeId: number, today: string, typeId = firstAid) =>
  withPlannedRequirements(db, 1, employeeId, getEmployeeRequirements(db, 1, employeeId, today), today).kinds.find(kind => kind.type.id === typeId)!
const people = (eventId: number, today = AFTER) => getEventAttendance(db, 1, eventId, today).people.map(person => [person.name, person.attended])

beforeEach(() => {
  db = createTestDb()
  baeren = addGroup(db, 1, 'Bären')
  igel = addGroup(db, 1, 'Igel')
  anna = addEmployee(db, 'Anna', { groupId: baeren })
  ben = addEmployee(db, 'Ben', { groupId: igel })
  carla = addEmployee(db, 'Carla')
  firstAid = requirementTypeId(db, 'first_aid')
  leitung = addUser(db, 'leitung', 'admin', addEmployee(db, 'Lea', { groupId: baeren }))
  annaUser = addUser(db, 'anna', 'observer', anna)
  benUser = addUser(db, 'ben', 'observer', ben)
})

describe('„Pflichttermin“ on an appointment', () => {
  it('may be set only by whoever enters Pflichttermine, for a kind of the facility, never „Nur Leitung und Träger“', () => {
    expect(errorCode(() => createCalendarEvent(db, 1, input({ requirementTypeId: firstAid })))).toBe('forbidden')
    expect(errorCode(() => createCalendarEvent(db, 1, input({ requirementTypeId: firstAid, visibility: 'leaders' }), MAY))).toBe('event_requirement_audience')
    const hort = addFacility(db, 'Hort')
    expect(errorCode(() => createCalendarEvent(db, 1, input({ requirementTypeId: requirementTypeId(db, 'first_aid', hort) }), MAY)))
      .toBe('requirement_type_not_found')
    const event = createCalendarEvent(db, 1, input({ requirementTypeId: firstAid, visibility: 'groups', groupIds: [baeren] }), MAY)
    expect(event.requirement).toEqual({ typeId: firstAid, typeName: 'Erste-Hilfe-Kurs', confirmedAt: null })
    // An ordinary appointment has none (the key is absent).
    expect('requirement' in createCalendarEvent(db, 1, input({ title: 'Elternabend' }))).toBe(false)
  })

  it('cannot be changed or deleted without the right; a change without the field keeps it', () => {
    const event = createCalendarEvent(db, 1, input({ requirementTypeId: firstAid }), MAY)
    expect(errorCode(() => updateCalendarEvent(db, 1, event.id, input({ title: 'Neu' })))).toBe('forbidden')
    expect(errorCode(() => deleteCalendarEvent(db, 1, event.id))).toBe('forbidden')
    // Nor can someone without the right turn an ordinary appointment into one.
    const plain = createCalendarEvent(db, 1, input({ title: 'Elternabend' }))
    expect(errorCode(() => updateCalendarEvent(db, 1, plain.id, input({ requirementTypeId: firstAid })))).toBe('forbidden')
    updateCalendarEvent(db, 1, plain.id, input({ title: 'Elternabend neu' }))
    updateCalendarEvent(db, 1, event.id, input({ title: 'Erste Hilfe neu' }), MAY)
    expect(listCalendarEvents(db, 1, 2026).find(item => item.id === event.id)!.requirement?.typeId).toBe(firstAid)
    updateCalendarEvent(db, 1, event.id, input({ requirementTypeId: null }), MAY)
    expect(listCalendarEvents(db, 1, 2026).find(item => item.id === event.id)!.requirement).toBeUndefined()
  })

  it('is seen by its participants (the choice is theirs), without anyone\'s confirmation', () => {
    createCalendarEvent(db, 1, input({ requirementTypeId: firstAid, visibility: 'groups', groupIds: [baeren] }), MAY)
    const seen = getMyYearCalendar(db, annaUser, 2026).events
    expect(seen.map(event => event.title)).toEqual(['Erste Hilfe'])
    expect(seen[0]!.requirement).toEqual({ typeId: firstAid, typeName: 'Erste-Hilfe-Kurs', confirmedAt: null })
    expect(getMyYearCalendar(db, benUser, 2026).events).toEqual([])
  })

  it('becomes an ordinary appointment when its own kind is deleted', () => {
    const own = createRequirementType(db, 1, { name: 'Hygienebelehrung', intervalMonths: 12 })
    const event = createCalendarEvent(db, 1, input({ requirementTypeId: own.id }), MAY)
    deleteRequirementType(db, 1, own.id)
    expect(listCalendarEvents(db, 1, 2026).find(item => item.id === event.id)!.requirement).toBeUndefined()
  })
})

describe('participants', () => {
  it('are everyone, the home groups or the chosen people – not who left before the first day or starts after the last', () => {
    const left = addEmployee(db, 'Dora', { groupId: baeren, leftOn: '2026-10-13' })
    const lastDay = addEmployee(db, 'Emil', { groupId: baeren, leftOn: '2026-10-14' })
    const later = addEmployee(db, 'Fritz', { groupId: baeren, validFrom: '2026-11-01' })
    const staff = loadEmployees(db, 1)
    const names = (event: Parameters<typeof intendedParticipants>[1]) => intendedParticipants(staff, event).map(employee => employee.name)
    const base = { date: '2026-10-14', endDate: null, groupIds: [], employeeIds: [] }
    expect(names({ ...base, visibility: 'groups', groupIds: [baeren] })).toEqual(['Anna', 'Lea', 'Emil'])
    expect(names({ ...base, visibility: 'all' })).toEqual(['Anna', 'Ben', 'Carla', 'Lea', 'Emil'])
    expect(names({ ...base, visibility: 'employees', employeeIds: [ben, left, later] })).toEqual(['Ben'])
    expect(names({ ...base, visibility: 'leaders' })).toEqual([])
    // A longer appointment reaching the start counts.
    expect(names({ ...base, endDate: '2026-11-02', visibility: 'employees', employeeIds: [later, lastDay] })).toEqual(['Emil', 'Fritz'])
  })
})

describe('before the appointment: „geplant am …“', () => {
  it('shows at the kind of each participant until the last day, in the employee list too', () => {
    const event = createCalendarEvent(db, 1, input({ requirementTypeId: firstAid, visibility: 'groups', groupIds: [baeren], endDate: '2026-10-15' }), MAY)
    expect(kindOf(anna, BEFORE).planned).toEqual({ eventId: event.id, date: '2026-10-14', endDate: '2026-10-15' })
    expect(kindOf(ben, BEFORE).planned).toBeUndefined()
    // Other kinds stay without.
    expect(kindOf(anna, BEFORE, requirementTypeId(db, 'company_doctor')).planned).toBeUndefined()
    const extras = listEmployeeListExtras(db, 1, BEFORE, new Set(PERMISSION_KEYS))
    expect(extras.find(row => row.employeeId === anna)!.plannedRequirements)
      .toEqual([{ eventId: event.id, date: '2026-10-14', endDate: '2026-10-15', typeId: firstAid, typeName: 'Erste-Hilfe-Kurs' }])
    expect('plannedRequirements' in extras.find(row => row.employeeId === ben)!).toBe(false)
    // On the last day still, the day after no more.
    expect(plannedRequirements(db, 1, '2026-10-15').has(`${anna}:${firstAid}`)).toBe(true)
    expect(plannedRequirements(db, 1, '2026-10-16').size).toBe(0)
  })

  it('names the earliest appointment of a kind, and none once confirmed', () => {
    createCalendarEvent(db, 1, input({ date: '2026-11-20', requirementTypeId: firstAid }), MAY)
    const early = createCalendarEvent(db, 1, input({ date: '2026-10-14', requirementTypeId: firstAid }), MAY)
    expect(kindOf(ben, BEFORE).planned?.eventId).toBe(early.id)
    confirmEventAttendance(db, 1, early.id, [ben], '2026-10-14', NOW)
    expect(kindOf(ben, '2026-10-14').planned?.date).toBe('2026-11-20')
  })
})

describe('„Teilnahme bestätigen“', () => {
  it('is possible from the last day on and lists everyone meant for it, all ticked', () => {
    const event = createCalendarEvent(db, 1, input({ requirementTypeId: firstAid, endDate: '2026-10-15', visibility: 'groups', groupIds: [baeren, igel] }), MAY)
    expect(getEventAttendance(db, 1, event.id, '2026-10-14').canConfirm).toBe(false)
    expect(errorCode(() => confirmEventAttendance(db, 1, event.id, [anna], '2026-10-14', NOW))).toBe('event_not_over')
    const attendance = getEventAttendance(db, 1, event.id, '2026-10-15')
    expect(attendance).toMatchObject({ canConfirm: true, confirmedAt: null, recordDate: '2026-10-15', typeName: 'Erste-Hilfe-Kurs' })
    expect(attendance.people).toEqual([
      { employeeId: anna, name: 'Anna', groupName: 'Bären', attended: true, handEntered: false },
      { employeeId: ben, name: 'Ben', groupName: 'Igel', attended: true, handEntered: false },
      { employeeId: leitung.employeeId, name: 'Lea', groupName: 'Bären', attended: true, handEntered: false },
    ])
    // An ordinary appointment has nothing to confirm; another facility's is unknown.
    const plain = createCalendarEvent(db, 1, input({ title: 'Elternabend' }))
    expect(errorCode(() => getEventAttendance(db, 1, plain.id, AFTER))).toBe('event_not_requirement')
    expect(errorCode(() => getEventAttendance(db, addFacility(db, 'Hort'), event.id, AFTER))).toBe('event_not_found')
  })

  it('records the ticked people on the last day, as by hand: due dates follow, the others stay open', () => {
    const event = createCalendarEvent(db, 1, input({ requirementTypeId: firstAid, endDate: '2026-10-15' }), MAY)
    expect(kindOf(anna, AFTER).state).toBe('missing')
    confirmEventAttendance(db, 1, event.id, [anna, carla], AFTER, NOW)
    expect(entries(anna)).toEqual([{ date: '2026-10-15', eventId: event.id, note: null }])
    expect(entries(carla)).toEqual([{ date: '2026-10-15', eventId: event.id, note: null }])
    expect(entries(ben)).toEqual([])
    expect(kindOf(anna, AFTER)).toMatchObject({ state: 'ok', lastDate: '2026-10-15', dueOn: '2028-10-15' })
    expect(kindOf(ben, AFTER).state).toBe('missing')
    expect(listCalendarEvents(db, 1, 2026)[0]!.requirement!.confirmedAt).toBe(NOW.toISOString())
    // The staff never learn about the confirmation.
    expect(getMyYearCalendar(db, annaUser, 2026).events[0]!.requirement!.confirmedAt).toBeNull()
    // Afterwards the list shows what was saved.
    expect(people(event.id)).toEqual([['Anna', true], ['Ben', false], ['Carla', true], ['Lea', false]])
  })

  it('changes on a new confirmation only the entries it created; hand-entered ones stay', () => {
    const event = createCalendarEvent(db, 1, input({ requirementTypeId: firstAid }), MAY)
    addRequirementRecord(db, 1, anna, { typeId: firstAid, date: '2026-09-01', note: 'Kurs beim DRK' }, AFTER)
    confirmEventAttendance(db, 1, event.id, [anna, ben], AFTER, NOW)
    confirmEventAttendance(db, 1, event.id, [anna, ben], AFTER, NOW) // no duplicates
    expect(entries(anna)).toEqual([{ date: '2026-09-01', eventId: null, note: 'Kurs beim DRK' }, { date: '2026-10-14', eventId: event.id, note: null }])
    confirmEventAttendance(db, 1, event.id, [ben, carla], AFTER, NOW)
    expect(entries(anna)).toEqual([{ date: '2026-09-01', eventId: null, note: 'Kurs beim DRK' }])
    expect(entries(ben)).toEqual([{ date: '2026-10-14', eventId: event.id, note: null }])
    expect(entries(carla)).toEqual([{ date: '2026-10-14', eventId: event.id, note: null }])
    expect(kindOf(anna, AFTER)).toMatchObject({ lastDate: '2026-09-01' })
  })

  it('adds nothing where the day was entered by hand, and refuses people it does not list', () => {
    const event = createCalendarEvent(db, 1, input({ requirementTypeId: firstAid, visibility: 'groups', groupIds: [baeren] }), MAY)
    addRequirementRecord(db, 1, anna, { typeId: firstAid, date: '2026-10-14' }, AFTER)
    expect(getEventAttendance(db, 1, event.id, AFTER).people.find(person => person.employeeId === anna))
      .toMatchObject({ attended: true, handEntered: true })
    confirmEventAttendance(db, 1, event.id, [], AFTER, NOW)
    expect(entries(anna)).toEqual([{ date: '2026-10-14', eventId: null, note: null }])
    expect(errorCode(() => confirmEventAttendance(db, 1, event.id, [ben], AFTER, NOW))).toBe('attendance_person_invalid')
  })

  it('keeps someone recorded earlier on the list after they left the group, to untick', () => {
    const event = createCalendarEvent(db, 1, input({ requirementTypeId: firstAid, visibility: 'groups', groupIds: [baeren] }), MAY)
    confirmEventAttendance(db, 1, event.id, [anna], AFTER, NOW)
    db.update(employees).set({ groupId: igel }).where(eq(employees.id, anna)).run()
    expect(people(event.id)).toEqual([['Anna', true], ['Lea', false]])
    confirmEventAttendance(db, 1, event.id, [], AFTER, NOW)
    expect(entries(anna)).toEqual([])
  })

  it('stores no note on the Führungszeugnis', () => {
    const criminal = requirementTypeId(db, 'criminal_record')
    const event = createCalendarEvent(db, 1, input({ requirementTypeId: criminal, visibility: 'employees', employeeIds: [ben] }), MAY)
    confirmEventAttendance(db, 1, event.id, [ben], AFTER, NOW)
    expect(entries(ben, criminal)).toEqual([{ date: '2026-10-14', eventId: event.id, note: null }])
  })
})

describe('changing or deleting a confirmed appointment', () => {
  let event: number
  beforeEach(() => {
    event = createCalendarEvent(db, 1, input({ requirementTypeId: firstAid, visibility: 'employees', employeeIds: [anna, ben] }), MAY).id
    addRequirementRecord(db, 1, anna, { typeId: firstAid, date: '2026-09-01' }, AFTER)
    confirmEventAttendance(db, 1, event, [anna, ben], AFTER, NOW)
  })

  it('moves the entries to the new last day and kind, but not ahead of today', () => {
    const changed = input({ requirementTypeId: firstAid, visibility: 'employees', employeeIds: [anna, ben], date: '2026-10-12', endDate: '2026-10-13' })
    updateCalendarEvent(db, 1, event, changed, { ...MAY, today: AFTER })
    expect(entries(ben)).toEqual([{ date: '2026-10-13', eventId: event, note: null }])
    expect(entries(anna)).toEqual([{ date: '2026-09-01', eventId: null, note: null }, { date: '2026-10-13', eventId: event, note: null }])
    expect(listCalendarEvents(db, 1, 2026)[0]!.requirement!.confirmedAt).toBe(NOW.toISOString())
    expect(errorCode(() => updateCalendarEvent(db, 1, event, { ...changed, date: '2026-10-21', endDate: null }, { ...MAY, today: AFTER })))
      .toBe('event_confirmed_future')
    const doctor = requirementTypeId(db, 'company_doctor')
    updateCalendarEvent(db, 1, event, { ...changed, requirementTypeId: doctor }, { ...MAY, today: AFTER })
    expect(entries(ben)).toEqual([])
    expect(entries(ben, doctor)).toEqual([{ date: '2026-10-13', eventId: event, note: null }])
  })

  it('keeps the entries as entered by hand when „Pflichttermin“ is taken off or the appointment deleted', () => {
    updateCalendarEvent(db, 1, event, input({ requirementTypeId: null, visibility: 'all' }), { ...MAY, today: AFTER })
    expect(entries(ben)).toEqual([{ date: '2026-10-14', eventId: null, note: null }])
    expect(listCalendarEvents(db, 1, 2026)[0]!.requirement).toBeUndefined()
    expect(db.select({ at: calendarEvents.attendanceConfirmedAt }).from(calendarEvents).get()).toEqual({ at: null })
    const second = createCalendarEvent(db, 1, input({ requirementTypeId: firstAid, date: '2026-10-16' }), MAY)
    confirmEventAttendance(db, 1, second.id, [carla], AFTER, NOW)
    deleteCalendarEvent(db, 1, second.id, MAY)
    expect(entries(carla)).toEqual([{ date: '2026-10-16', eventId: null, note: null }])
    expect(kindOf(carla, AFTER).lastDate).toBe('2026-10-16')
  })

  it('lets a person who moves away keep the entries, no longer linked', () => {
    const hort = addFacility(db, 'Hort')
    moveEmployeeToFacility(db, addUser(db, 'traeger', 'provider'), ben, hort, NOW)
    expect(entries(ben, requirementTypeId(db, 'first_aid', hort))).toEqual([{ date: '2026-10-14', eventId: null, note: null }])
    confirmEventAttendance(db, 1, event, [], AFTER, NOW)
    expect(entries(ben, requirementTypeId(db, 'first_aid', hort))).toHaveLength(1)
  })
})

describe('„Offen für dich“', () => {
  it('lists the unconfirmed Pflichttermine from their last day on for whoever confirms, also without an employee', () => {
    const traeger = addUser(db, 'traeger', 'provider')
    createCalendarEvent(db, 1, input({ title: 'Elternabend', date: '2026-10-02' }))
    const event = createCalendarEvent(db, 1, input({ requirementTypeId: firstAid, endDate: '2026-10-15' }), MAY)
    createCalendarEvent(db, 1, input({ requirementTypeId: firstAid, date: '2026-12-01' }), MAY)
    expect(myOpenItems(db, leitung, '2026-10-14').attendance).toBeUndefined()
    expect(myOpenItems(db, leitung, '2026-10-15').attendance).toEqual({ count: 1, eventId: event.id, year: 2026 })
    expect(myOpenItems(db, traeger, '2026-10-15').attendance).toEqual({ count: 1, eventId: event.id, year: 2026 })
    // Staff never.
    expect(myOpenItems(db, annaUser, '2026-10-15').attendance).toBeUndefined()
    confirmEventAttendance(db, 1, event.id, [anna], '2026-10-15', NOW)
    expect(myOpenItems(db, leitung, '2026-10-15').attendance).toBeUndefined()
  })
})

describe('the year calendar', () => {
  it('carries the Pflichttermin of an appointment for the managers', () => {
    createCalendarEvent(db, 1, input({ requirementTypeId: firstAid, visibility: 'groups', groupIds: [igel] }), MAY)
    const calendar = getYearCalendar(db, 1, 2026, { eventAudience: { seesAll: true, employeeId: null, groupId: null } })
    expect(calendar.events[0]).toMatchObject({ visibility: 'groups', groupIds: [igel], requirement: { typeId: firstAid, confirmedAt: null } })
  })
})
