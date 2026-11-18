import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { changeLog, employees } from '../../server/db/schema'
import { getActiveUser } from '../../server/services/auth'
import { createClosure } from '../../server/services/closures'
import { addHours, bookMissingClosures, createEmployee } from '../../server/services/employees'
import { applyToCells } from '../../server/services/entries'
import { getLeaveAccount } from '../../server/services/leave'
import { loadEntries } from '../../server/services/queries'
import { releaseMonth } from '../../server/services/release'
import { saveUserRights } from '../../server/services/rights'
import { createUser } from '../../server/services/users'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addHelpOut, addUser, createTestDb, errorCode, templateId } from '../helpers/fixtures'

// 2026-03-02 is a Monday, 2026-05-25 Whit Monday (public holiday), 2026-08-10 a Monday, 2026-11-10 a Tuesday.
const teamDays = { startDate: '2026-03-02', endDate: '2026-03-03', label: 'Teamtage', mode: 'closure_day' as const }
const whitsun = { startDate: '2026-05-25', endDate: '2026-05-29', label: 'Pfingsten', mode: 'vacation' as const }
const summer = { startDate: '2026-08-10', endDate: '2026-08-16', label: 'Sommer', mode: 'vacation' as const }
const now = new Date('2026-11-18T10:00:00Z')
const today = '2026-11-18'

describe('closures follow an earlier start of the weekly hours', () => {
  let db: Db
  let admin: SessionUser
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    createClosure(db, admin, 1, teamDays, now)
    createClosure(db, admin, 1, whitsun, now)
    createClosure(db, admin, 1, summer, now)
  })

  const create = (validFrom = '2026-11-10', vacationDays = 30) => createEmployee(db, admin, 1, {
    name: 'Nora', shortName: 'No', weeklyMinutes: 2340, validFrom, vacationDays,
  }, now)
  /** The person's code entries as [date, code key]. */
  const codes = (employeeId: number) => loadEntries(db, { employeeId }).filter(entry => entry.kind === 'code')
    .map(entry => [entry.date, entry.codeKey])
  const vacation = (...dates: string[]) => dates.map(date => [date, 'vacation'])
  const closureDays = (...dates: string[]) => dates.map(date => [date, 'closure_day'])

  it('books the closures between the new and the old start (leave and closure days), counted as taken leave', () => {
    const nora = create()
    expect(codes(nora)).toEqual([])
    releaseMonth(db, admin, 1, 2026, 8, now)
    addHours(db, 1, nora, { weeklyMinutes: 2340, validFrom: '2026-01-01' }, admin, now)
    expect(codes(nora)).toEqual([
      ...closureDays('2026-03-02', '2026-03-03'),
      ...vacation('2026-05-26', '2026-05-27', '2026-05-28', '2026-05-29'),
      ...vacation('2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14'),
    ])
    expect(getLeaveAccount(db, nora, 2026, today).account.taken).toBe(9)
    // Logged like any booking of a closure (the change log keeps released months only).
    expect(db.select().from(changeLog).all().filter(row => row.employeeId === nora).map(row => row.date))
      .toEqual(['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14'])
    // Never moved: the facility's days were the person's own all along (nothing to move).
    expect(db.select({ since: employees.facilitySince }).from(employees).where(eq(employees.id, nora)).get()!.since).toBeNull()
  })

  it('books only working days by the new hours', () => {
    const nora = create()
    // Monday to Wednesday.
    addHours(db, 1, nora, { weeklyMinutes: 1200, validFrom: '2026-01-01', workdays: 0b00111 }, admin, now)
    expect(codes(nora)).toEqual([
      ...closureDays('2026-03-02', '2026-03-03'),
      ...vacation('2026-05-26', '2026-05-27'),
      ...vacation('2026-08-10', '2026-08-11', '2026-08-12'),
    ])
  })

  it('leaves cells with entries and help-out days untouched', () => {
    const krippe = addFacility(db, 'Krippe')
    const leitungB = addUser(db, 'leitung-b', 'admin', null, krippe)
    const nora = create()
    applyToCells(db, admin, 1, [{ employeeId: nora, date: '2026-08-11' }], 'replace', { kind: 'shift', templateId: templateId(db, 'M') })
    addHelpOut(db, nora, krippe, 2026, 8)
    applyToCells(db, leitungB, krippe, [{ employeeId: nora, date: '2026-08-12' }], 'replace',
      { kind: 'shift', templateId: templateId(db, 'M', krippe) })
    addHours(db, 1, nora, { weeklyMinutes: 2340, validFrom: '2026-08-01' }, admin, now)
    const august = loadEntries(db, { employeeId: nora, from: '2026-08-01', to: '2026-08-31' })
      .map(entry => [entry.date, entry.kind === 'code' ? entry.codeKey : entry.kind, entry.helpFacilityId])
    expect(august).toEqual([
      ['2026-08-10', 'vacation', null], ['2026-08-11', 'shift', null], ['2026-08-12', 'shift', krippe],
      ['2026-08-13', 'vacation', null], ['2026-08-14', 'vacation', null],
    ])
  })

  it('keeps the limit of a joiner: only the leave left, the rest closure days', () => {
    const nora = create('2026-11-10', 2)
    addHours(db, 1, nora, { weeklyMinutes: 2340, validFrom: '2026-08-01' }, admin, now)
    expect(codes(nora)).toEqual([
      ...vacation('2026-08-10', '2026-08-11'),
      ...closureDays('2026-08-12', '2026-08-13', '2026-08-14'),
    ])
  })

  it('books only from the day someone moved in', () => {
    const nora = create()
    db.update(employees).set({ facilitySince: '2026-07-01' }).where(eq(employees.id, nora)).run()
    addHours(db, 1, nora, { weeklyMinutes: 2340, validFrom: '2026-01-01' }, admin, now)
    expect(codes(nora)).toEqual(vacation('2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14'))
    expect(db.select({ since: employees.facilitySince }).from(employees).where(eq(employees.id, nora)).get()!.since).toBe('2026-07-01')
  })

  it('books nothing new for a later period or a changed period at the same start', () => {
    const nora = create()
    addHours(db, 1, nora, { weeklyMinutes: 1950, validFrom: '2026-12-01' }, admin, now)
    addHours(db, 1, nora, { weeklyMinutes: 1950, validFrom: '2026-11-10' }, admin, now)
    expect(codes(nora)).toEqual([])
  })
})

describe('„Schließzeiten nachtragen“', () => {
  let db: Db
  let admin: SessionUser
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    createClosure(db, admin, 1, teamDays, now)
    createClosure(db, admin, 1, whitsun, now)
    createClosure(db, admin, 1, summer, now)
  })

  it('books the missing closure days from the first hours start, only empty cells, and is idempotent', () => {
    // Added without the closures (as an hours period moved earlier by hand would leave it).
    const nora = addEmployee(db, 'Nora', { validFrom: '2026-01-01' })
    applyToCells(db, admin, 1, [{ employeeId: nora, date: '2026-08-11' }], 'replace', { kind: 'shift', templateId: templateId(db, 'M') })
    expect(bookMissingClosures(db, admin, 1, nora, now)).toBe(10)
    expect(loadEntries(db, { employeeId: nora, from: '2026-08-11', to: '2026-08-11' })[0]!.kind).toBe('shift')
    expect(getLeaveAccount(db, nora, 2026, today).account.taken).toBe(8)
    expect(bookMissingClosures(db, admin, 1, nora, now)).toBe(0)
  })

  it('books only from the day someone moved in', () => {
    const nora = addEmployee(db, 'Nora', { validFrom: '2026-01-01' })
    db.update(employees).set({ facilitySince: '2026-07-01' }).where(eq(employees.id, nora)).run()
    expect(bookMissingClosures(db, admin, 1, nora, now)).toBe(5)
  })

  it('refuses another facility\'s employee (404) and the own account of a Mitarbeiter with time rights (403)', () => {
    const krippe = addFacility(db, 'Krippe')
    const kim = addEmployee(db, 'Kim', { facilityId: krippe })
    expect(errorCode(() => bookMissingClosures(db, admin, 1, kim, now))).toBe('employee_not_found')
    const provider = addUser(db, 'traeger', 'provider')
    const nora = addEmployee(db, 'Nora', { validFrom: '2026-01-01' })
    const own = createUser(db, admin, { username: 'nora', password: 'start-1234', role: 'observer', employeeId: nora })
    saveUserRights(db, provider, own.id, [{ bundle: 'timeManage', effect: 'grant' }])
    const editor = getActiveUser(db, own.id)!
    expect(errorCode(() => bookMissingClosures(db, editor, 1, nora, now))).toBe('own_account')
    expect(loadEntries(db, { employeeId: nora })).toEqual([])
  })
})
