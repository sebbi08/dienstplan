import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import {
  createCalendarEvent, deleteCalendarEvent, getSickYear, getStaffYearCalendar, getYearCalendar, listCalendarEvents, updateCalendarEvent,
} from '../../server/services/calendar'
import { computeBalances } from '../../server/services/balances'
import { setEntitlement } from '../../server/services/employees'
import { applyToCells } from '../../server/services/entries'
import { getLeaveAccount } from '../../server/services/leave'
import { loadEmployees } from '../../server/services/queries'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, codeId, createTestDb, errorCode, templateId } from '../helpers/fixtures'

describe('year calendar and sick days', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  let berta: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
    berta = addEmployee(db, 'Berta')
  })
  const enter = (employeeId: number, dates: string[], key: string) =>
    applyToCells(db, admin, 1, dates.map(date => ({ employeeId, date })), 'replace', { kind: 'code', codeId: codeId(db, key) })

  it('groups sick days per employee into periods over weekends and counts workdays', () => {
    enter(anna, ['2026-10-08', '2026-10-09', '2026-10-12'], 'sick') // Thu, Fri, Mon
    enter(anna, ['2026-11-20'], 'sick')
    enter(anna, ['2025-12-30'], 'sick') // other year
    enter(berta, ['2026-10-08'], 'vacation')
    const sick = getSickYear(db, 1, 2026)
    expect(sick.map(row => [row.name, row.total, row.ranges])).toEqual([
      ['Anna', 4, [{ from: '2026-10-08', to: '2026-10-12', days: 3 }, { from: '2026-11-20', to: '2026-11-20', days: 1 }]],
      ['Berta', 0, []],
    ])
  })
  it('marks each employee day with the strongest absence kind', () => {
    enter(anna, ['2026-10-08'], 'sick')
    enter(anna, ['2026-10-09'], 'vacation')
    enter(anna, ['2026-10-12'], 'training')
    enter(berta, ['2026-10-13'], 'school')
    enter(berta, ['2026-10-14'], 'closure_day')
    enter(berta, ['2026-10-16'], 'special_leave')
    applyToCells(db, admin, 1, [{ employeeId: berta, date: '2026-10-15' }], 'replace', { kind: 'shift', templateId: templateId(db, 'M') })
    const calendar = getYearCalendar(db, 1, 2026)
    expect(calendar.employees.map(e => e.name)).toEqual(['Anna', 'Berta'])
    expect(calendar.days[anna]).toEqual({ '2026-10-08': 'sick', '2026-10-09': 'vacation', '2026-10-12': 'training' })
    expect(calendar.days[berta]).toEqual({ '2026-10-13': 'training', '2026-10-14': 'closed', '2026-10-16': 'special_leave' })
    expect(calendar.otherEntries[berta]).toEqual(['2026-10-14', '2026-10-15'])
    expect(calendar.otherEntries[anna]).toEqual([])
    expect(calendar.absenceCodes.map(code => code.key)).toEqual(['vacation', 'special_leave', 'sick', 'training', 'school'])
  })
  it('manages appointments of the year', () => {
    const elternabend = createCalendarEvent(db, 1, { date: '2026-10-14', start: 1140, end: 1260, title: '  Elternabend ', visibleToStaff: true })
    createCalendarEvent(db, 1, { date: '2026-10-02', start: null, end: null, title: 'Teamtag', visibleToStaff: false })
    createCalendarEvent(db, 1, { date: '2027-01-05', start: null, end: null, title: 'später', visibleToStaff: false })
    expect(listCalendarEvents(db, 1, 2026).map(e => [e.date, e.start, e.end, e.title])).toEqual([
      ['2026-10-02', null, null, 'Teamtag'], ['2026-10-14', 1140, 1260, 'Elternabend'],
    ])
    updateCalendarEvent(db, 1, elternabend.id, { date: '2026-10-15', start: 1140, end: null, title: 'Elternabend', visibleToStaff: true })
    expect(getYearCalendar(db, 1, 2026).events.find(e => e.id === elternabend.id)).toMatchObject({ date: '2026-10-15', end: null })
    deleteCalendarEvent(db, 1, elternabend.id)
    expect(listCalendarEvents(db, 1, 2026)).toHaveLength(1)
  })
  it('validates appointments', () => {
    expect(errorCode(() => createCalendarEvent(db, 1, { date: '2026-10-14', start: null, end: null, title: ' ', visibleToStaff: false }))).toBe('title_required')
    expect(errorCode(() => createCalendarEvent(db, 1, { date: '2026-10-14', start: null, end: 600, title: 'x', visibleToStaff: false }))).toBe('span_end_before_start')
    expect(errorCode(() => createCalendarEvent(db, 1, { date: '2026-10-14', start: 600, end: 600, title: 'x', visibleToStaff: false }))).toBe('span_end_before_start')
    expect(errorCode(() => updateCalendarEvent(db, 1, 999, { date: '2026-10-14', start: null, end: null, title: 'x', visibleToStaff: false }))).toBe('event_not_found')
  })
})

describe('special leave', () => {
  it('counts as a full working day but does not use up leave', () => {
    const db = createTestDb()
    const admin = addUser(db, 'leitung', 'admin')
    const anna = addEmployee(db, 'Anna')
    setEntitlement(db, 1, anna, 2026, { days: 30, carriedOverDays: 0 })
    const monthEnd = () => computeBalances(db, 1, loadEmployees(db, 1), '2026-10-31', '2026-10-31')[0]!.monthEnd
    const before = monthEnd()
    applyToCells(db, admin, 1, [{ employeeId: anna, date: '2026-10-08' }], 'replace', { kind: 'code', codeId: codeId(db, 'special_leave') })
    expect(monthEnd() - before).toBe(468) // the daily target of 39 h / 5 days
    expect(getLeaveAccount(db, anna, 2026, '2026-10-01').account.available).toBe(30)
  })
})

describe('year calendar for employees', () => {
  it('shows everyone\'s leave and training, sick days only of the viewer, and only shared appointments', () => {
    const db = createTestDb()
    const admin = addUser(db, 'leitung', 'admin')
    const anna = addEmployee(db, 'Anna')
    const berta = addEmployee(db, 'Berta')
    const enter = (employeeId: number, date: string, key: string) =>
      applyToCells(db, admin, 1, [{ employeeId, date }], 'replace', { kind: 'code', codeId: codeId(db, key) })
    enter(anna, '2026-10-08', 'sick')
    enter(anna, '2026-10-09', 'vacation')
    enter(berta, '2026-10-08', 'sick')
    enter(berta, '2026-10-12', 'training')
    enter(berta, '2026-10-13', 'special_leave')
    createCalendarEvent(db, 1, { date: '2026-10-14', start: null, end: null, title: 'Elternabend', visibleToStaff: true })
    createCalendarEvent(db, 1, { date: '2026-10-15', start: null, end: null, title: 'Personalgespräch', visibleToStaff: false })

    const forAnna = getStaffYearCalendar(db, 1, 2026, anna)
    expect(forAnna.days[anna]).toEqual({ '2026-10-08': 'sick', '2026-10-09': 'vacation' })
    expect(forAnna.days[berta]).toEqual({ '2026-10-12': 'training', '2026-10-13': 'special_leave' })
    expect(forAnna.events.map(event => event.title)).toEqual(['Elternabend'])
    expect([forAnna.otherEntries, forAnna.absenceCodes]).toEqual([{}, []])
    expect(getStaffYearCalendar(db, 1, 2026, null).days[anna]).toEqual({ '2026-10-09': 'vacation' })
    expect(getYearCalendar(db, 1, 2026).days[berta]!['2026-10-08']).toBe('sick') // the Leitung still sees everything
  })
})
