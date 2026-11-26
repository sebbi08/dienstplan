import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { calendarEventEmployees, calendarEventGroups, calendarEvents, employees } from '../../server/db/schema'
import {
  calendarEventAudience, createCalendarEvent, deleteCalendarEvent, eventAudienceOf, getMyYearCalendar, getStaffYearCalendar,
  getYearCalendar, listCalendarEvents, updateCalendarEvent, type CalendarEventInput,
} from '../../server/services/calendar'
import { deleteLeftEmployee } from '../../server/services/employeeDeletion'
import { deleteGroup } from '../../server/services/groups'
import { getMonthPlan, getMyPlan } from '../../server/services/plan'
import { releaseMonth } from '../../server/services/release'
import { saveBundleOverride } from '../../server/services/permissions'
import { toSessionUser } from '../../server/services/auth'
import { eventCovers, eventRangeText, eventVisibleTo, PUBLIC_AUDIENCE } from '../../shared/domain/calendarEvents'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addGroup, addUser, createTestDb, errorCode } from '../helpers/fixtures'
import { users } from '../../server/db/schema'

const TODAY = '2026-10-01'

/** An appointment of facility 1 (one day, no time, „Alle“) with the given changes. */
const input = (changes: Partial<CalendarEventInput> = {}): CalendarEventInput => ({
  date: '2026-10-14', endDate: null, start: null, end: null, title: 'Termin', visibility: 'all', groupIds: [], employeeIds: [], ...changes,
})

let db: Db
let baeren: number
let igel: number
let anna: number // Bären
let ben: number // Igel
let carla: number // no group
let leitung: SessionUser
let traeger: SessionUser
let annaUser: SessionUser
let benUser: SessionUser
let carlaUser: SessionUser
let tablet: SessionUser

/** Who sees which of the five appointments (by title), in the year calendar. */
const titles = (events: { title: string }[]) => events.map(event => event.title)

beforeEach(() => {
  db = createTestDb()
  baeren = addGroup(db, 1, 'Bären')
  igel = addGroup(db, 1, 'Igel')
  anna = addEmployee(db, 'Anna', { groupId: baeren })
  ben = addEmployee(db, 'Ben', { groupId: igel })
  carla = addEmployee(db, 'Carla')
  leitung = addUser(db, 'leitung', 'admin')
  traeger = addUser(db, 'traeger', 'provider')
  annaUser = addUser(db, 'anna', 'observer', anna)
  benUser = addUser(db, 'ben', 'observer', ben)
  carlaUser = addUser(db, 'carla', 'observer', carla)
  tablet = addUser(db, 'tablet', 'terminal')
  createCalendarEvent(db, 1, input({ date: '2026-10-05', title: 'Für alle', start: 1140, end: 1260 }))
  createCalendarEvent(db, 1, input({ date: '2026-10-06', title: 'Für Bären', visibility: 'groups', groupIds: [baeren] }))
  createCalendarEvent(db, 1, input({ date: '2026-10-07', title: 'Für Carla', visibility: 'employees', employeeIds: [carla] }))
  createCalendarEvent(db, 1, input({ date: '2026-10-08', title: 'Nur Leitung', visibility: 'leaders' }))
  createCalendarEvent(db, 1, input({ date: '2026-10-12', endDate: '2026-10-14', title: 'Fortbildungstage', start: 540, end: 960 }))
})

describe('„Wer sieht den Termin?“', () => {
  it('shows the Leitung, the Träger and whoever manages the calendar every appointment, with the chosen lists', () => {
    const all = ['Für alle', 'Für Bären', 'Für Carla', 'Nur Leitung', 'Fortbildungstage']
    for (const viewer of [leitung, traeger]) {
      expect(eventAudienceOf(db, viewer).seesAll).toBe(true)
      const calendar = getYearCalendar(db, 1, 2026, { eventAudience: eventAudienceOf(db, viewer) })
      expect(titles(calendar.events)).toEqual(all)
      expect(calendar.events.find(event => event.title === 'Für Bären')!.groupIds).toEqual([baeren])
      expect(calendar.events.find(event => event.title === 'Für Carla')!.employeeIds).toEqual([carla])
    }
    // A Mitarbeiter with the exception „Termine und Schließzeiten bearbeiten“ manages the calendar: sees all as well.
    saveBundleOverride(db, benUser.id, 'calendarEdit', 'grant')
    const benEditor = toSessionUser(db, db.select().from(users).where(eq(users.id, benUser.id)).get()!)
    expect(titles(getMyYearCalendar(db, benEditor, 2026).events)).toEqual(all)
  })

  it('shows everyone else only what is meant for them, without the lists', () => {
    expect(titles(getMyYearCalendar(db, annaUser, 2026).events)).toEqual(['Für alle', 'Für Bären', 'Fortbildungstage'])
    expect(titles(getMyYearCalendar(db, benUser, 2026).events)).toEqual(['Für alle', 'Fortbildungstage'])
    expect(titles(getMyYearCalendar(db, carlaUser, 2026).events)).toEqual(['Für alle', 'Für Carla', 'Fortbildungstage'])
    for (const event of getMyYearCalendar(db, annaUser, 2026).events) expect([event.groupIds, event.employeeIds]).toEqual([[], []])
    // The staff calendar without a viewer (and the tablet) only „Alle“.
    expect(titles(getStaffYearCalendar(db, 1, 2026, null).events)).toEqual(['Für alle', 'Fortbildungstage'])
    expect(eventAudienceOf(db, tablet)).toEqual(PUBLIC_AUDIENCE)
    // Nothing of the others' appointments reaches them: no title, no count.
    const forBen = JSON.stringify(getMyYearCalendar(db, benUser, 2026))
    expect(forBen).not.toMatch(/Für Bären|Für Carla|Nur Leitung/)
  })

  it('follows the home group as it is now', () => {
    db.update(employees).set({ groupId: baeren }).where(eq(employees.id, ben)).run()
    expect(titles(getMyYearCalendar(db, benUser, 2026).events)).toContain('Für Bären')
  })

  it('decides by the audience alone (shared rule)', () => {
    const event = { visibility: 'groups' as const, groupIds: [1], employeeIds: [] }
    expect(eventVisibleTo(event, { seesAll: false, employeeId: 5, groupId: 1 })).toBe(true)
    expect(eventVisibleTo(event, { seesAll: false, employeeId: 5, groupId: null })).toBe(false)
    expect(eventVisibleTo({ ...event, groupIds: [] }, { seesAll: false, employeeId: 5, groupId: 1 })).toBe(false)
    expect(eventVisibleTo({ visibility: 'leaders', groupIds: [], employeeIds: [] }, { seesAll: true, employeeId: null, groupId: null })).toBe(true)
  })
})

describe('appointments in the plan', () => {
  const dayEvents = (days: { date: string; events: { title: string }[] }[], date: string) => titles(days.find(day => day.date === date)!.events)

  it('show on their days in the plan of the Leitung, of the staff, at the tablet, in the print and in „Mein Dienstplan“', () => {
    const draft = getMonthPlan(db, leitung, 1, 2026, 10, TODAY)
    expect(dayEvents(draft.days, '2026-10-06')).toEqual(['Für Bären'])
    expect(dayEvents(draft.days, '2026-10-08')).toEqual(['Nur Leitung'])
    // Several days: on each of them, weekend included.
    for (const date of ['2026-10-12', '2026-10-13', '2026-10-14']) expect(dayEvents(draft.days, date)).toEqual(['Fortbildungstage'])
    expect(dayEvents(draft.days, '2026-10-15')).toEqual([])

    releaseMonth(db, leitung, 1, 2026, 10, new Date('2026-09-25T10:00:00Z'))
    const forAnna = getMonthPlan(db, annaUser, 1, 2026, 10, TODAY)
    expect(dayEvents(forAnna.days, '2026-10-06')).toEqual(['Für Bären'])
    expect(dayEvents(forAnna.days, '2026-10-07')).toEqual([])
    expect(dayEvents(forAnna.days, '2026-10-08')).toEqual([])
    const atTablet = getMonthPlan(db, tablet, 1, 2026, 10, TODAY)
    expect(atTablet.days.flatMap(day => titles(day.events))).toEqual(['Für alle', 'Fortbildungstage', 'Fortbildungstage', 'Fortbildungstage'])
    expect(JSON.stringify(atTablet)).not.toMatch(/Für Bären|Für Carla|Nur Leitung/)

    const mine = getMyPlan(db, carlaUser, 2026, 10, TODAY)
    expect(dayEvents(mine.days, '2026-10-07')).toEqual(['Für Carla'])
    expect(dayEvents(mine.days, '2026-10-06')).toEqual([])
    expect(JSON.stringify(mine)).not.toMatch(/Für Bären|Nur Leitung/)
  })

  it('are not part of the release: a new appointment changes nothing to release', () => {
    releaseMonth(db, leitung, 1, 2026, 10, new Date('2026-09-25T10:00:00Z'))
    createCalendarEvent(db, 1, input({ date: '2026-10-20', title: 'Neu' }))
    const plan = getMonthPlan(db, leitung, 1, 2026, 10, TODAY)
    expect(plan.release.pendingCount).toBe(0)
    expect(dayEvents(plan.days, '2026-10-20')).toEqual(['Neu'])
    expect(dayEvents(getMonthPlan(db, annaUser, 1, 2026, 10, TODAY).days, '2026-10-20')).toEqual(['Neu'])
  })

  it('across months and years: shown in each month and year it touches', () => {
    createCalendarEvent(db, 1, input({ date: '2026-12-30', endDate: '2027-01-02', title: 'Jahreswechsel' }))
    expect(titles(listCalendarEvents(db, 1, 2027))).toEqual(['Jahreswechsel'])
    expect(titles(listCalendarEvents(db, 1, 2026))).toContain('Jahreswechsel')
    const january = getMonthPlan(db, leitung, 1, 2027, 1, TODAY)
    expect(january.days.filter(day => day.events.length).map(day => day.date)).toEqual(['2027-01-01', '2027-01-02'])
    expect(eventRangeText({ date: '2026-12-30', endDate: '2027-01-02' })).toBe('30.12.2026–2.1.2027')
    expect(eventRangeText({ date: '2026-03-10', endDate: '2026-03-12' })).toBe('10.–12.3.')
    expect(eventRangeText({ date: '2026-03-30', endDate: '2026-04-02' })).toBe('30.3.–2.4.')
    expect(eventCovers({ date: '2026-03-10', endDate: null }, '2026-03-11')).toBe(false)
  })
})

describe('entering appointments', () => {
  it('validates the days, the times and the lists', () => {
    expect(errorCode(() => createCalendarEvent(db, 1, input({ endDate: '2026-10-13' })))).toBe('event_end_before_start')
    expect(errorCode(() => createCalendarEvent(db, 1, input({ endDate: '2027-10-15' })))).toBe('event_too_long')
    expect(errorCode(() => createCalendarEvent(db, 1, input({ visibility: 'groups' })))).toBe('event_groups_required')
    expect(errorCode(() => createCalendarEvent(db, 1, input({ visibility: 'employees' })))).toBe('event_employees_required')
    // Another facility's group or employee is no choice here.
    const hort = addFacility(db, 'Hort')
    const hortGroup = addGroup(db, hort, 'Hortgruppe')
    const hortEmployee = addEmployee(db, 'Hanna', { facilityId: hort })
    expect(errorCode(() => createCalendarEvent(db, 1, input({ visibility: 'groups', groupIds: [hortGroup] })))).toBe('event_groups_required')
    expect(errorCode(() => createCalendarEvent(db, 1, input({ visibility: 'employees', employeeIds: [hortEmployee] })))).toBe('event_employees_required')
    // Several days: the start is on the first day, the end on the last, so an end before the start is fine.
    const event = createCalendarEvent(db, 1, input({ endDate: '2026-10-16', start: 900, end: 600 }))
    expect(event).toMatchObject({ endDate: '2026-10-16', start: 900, end: 600 })
    // The same day as last day is one day; a list of another choice is not kept.
    expect(createCalendarEvent(db, 1, input({ endDate: '2026-10-14', groupIds: [baeren] }))).toMatchObject({ endDate: null, groupIds: [] })
  })

  it('changes the choice and its list', () => {
    const id = createCalendarEvent(db, 1, input({ title: 'Wechsel', visibility: 'groups', groupIds: [baeren, igel] })).id
    const stored = () => listCalendarEvents(db, 1, 2026).find(event => event.id === id)!
    updateCalendarEvent(db, 1, id, input({ title: 'Wechsel', visibility: 'employees', employeeIds: [anna, carla] }))
    expect(stored()).toMatchObject({ visibility: 'employees', groupIds: [], employeeIds: [anna, carla] })
    updateCalendarEvent(db, 1, id, input({ title: 'Wechsel', visibility: 'groups', groupIds: [igel] }))
    expect(stored()).toMatchObject({ visibility: 'groups', groupIds: [igel], employeeIds: [] })
    updateCalendarEvent(db, 1, id, input({ title: 'Wechsel', visibility: 'all' }))
    expect(stored()).toMatchObject({ visibility: 'all', groupIds: [], employeeIds: [] })
    deleteCalendarEvent(db, 1, id)
    expect(db.select().from(calendarEventGroups).where(eq(calendarEventGroups.eventId, id)).all()).toEqual([])
  })

  it('offers the facility\'s groups and the staff who have not left', () => {
    addEmployee(db, 'Dora', { leftOn: '2026-09-30' })
    const audience = calendarEventAudience(db, 1, TODAY)
    expect(audience.groups.map(group => group.name)).toEqual(['Bären', 'Igel'])
    expect(audience.employees.map(employee => employee.name)).toEqual(['Anna', 'Ben', 'Carla'])
  })
})

describe('deleting a group or an employee', () => {
  const visibility = (title: string) => db.select({ visibility: calendarEvents.visibility }).from(calendarEvents)
    .where(eq(calendarEvents.title, title)).get()!.visibility

  it('takes the group out of the list; an emptied list becomes „Nur Leitung und Träger“, never wider', () => {
    const both = createCalendarEvent(db, 1, input({ title: 'Beide', visibility: 'groups', groupIds: [baeren, igel] }))
    db.update(employees).set({ groupId: null }).where(eq(employees.id, ben)).run()
    deleteGroup(db, 1, igel, TODAY)
    expect(listCalendarEvents(db, 1, 2026).find(event => event.id === both.id)).toMatchObject({ visibility: 'groups', groupIds: [baeren] })
    db.update(employees).set({ groupId: null }).where(eq(employees.id, anna)).run()
    deleteGroup(db, 1, baeren, TODAY)
    expect(visibility('Beide')).toBe('leaders')
    expect(visibility('Für Bären')).toBe('leaders')
    expect(titles(getMyYearCalendar(db, annaUser, 2026).events)).toEqual(['Für alle', 'Fortbildungstage'])
    expect(visibility('Für alle')).toBe('all')
  })

  it('takes a deleted employee out of the list; an emptied list becomes „Nur Leitung und Träger“', () => {
    const shared = createCalendarEvent(db, 1, input({ title: 'Zwei', visibility: 'employees', employeeIds: [ben, carla] }))
    db.update(employees).set({ leftOn: '2026-09-15' }).where(eq(employees.id, carla)).run()
    db.delete(users).where(eq(users.id, carlaUser.id)).run()
    deleteLeftEmployee(db, leitung, 1, carla, 'Carla', TODAY)
    expect(db.select().from(calendarEventEmployees).where(eq(calendarEventEmployees.employeeId, carla)).all()).toEqual([])
    expect(listCalendarEvents(db, 1, 2026).find(event => event.id === shared.id)).toMatchObject({ visibility: 'employees', employeeIds: [ben] })
    expect(visibility('Für Carla')).toBe('leaders')
  })
})
