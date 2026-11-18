import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { changeLog, employees } from '../../server/db/schema'
import { createClosure, listClosures, updateClosure } from '../../server/services/closures'
import { createEmployee, moveEmployeeToFacility } from '../../server/services/employees'
import { applyToCells } from '../../server/services/entries'
import { getLeaveAccount } from '../../server/services/leave'
import { loadEntries } from '../../server/services/queries'
import { releaseMonth } from '../../server/services/release'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addHelpOut, addUser, codeId, createTestDb, errorCode, templateId } from '../helpers/fixtures'

// 2026-08-07 is a Friday, 2026-08-17 a Monday: working days 7, 10–14 and 17 August.
const summer = { startDate: '2026-08-07', endDate: '2026-08-17', label: 'Sommerschließzeit', mode: 'vacation' as const }
const now = new Date('2026-07-01T10:00:00Z')

describe('updateClosure', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  let ben: number
  let closureId: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
    ben = addEmployee(db, 'Ben')
    closureId = createClosure(db, admin, 1, summer, now).id
  })
  /** The person's entries as [date, code key or kind]. */
  const cells = (employeeId: number) => loadEntries(db, { employeeId }).map(entry => [entry.date, entry.codeKey ?? entry.kind])
  const linked = (employeeId: number) => loadEntries(db, { employeeId, closureId }).map(entry => entry.date)
  const update = (changes: Partial<typeof summer>) => updateClosure(db, admin, 1, closureId, { ...summer, ...changes }, now)
  /** The change log as [employee, date, before, after], by date and employee. */
  const loggedDates = () => db.select().from(changeLog).all()
    .sort((a, b) => a.date.localeCompare(b.date) || Number(a.employeeId) - Number(b.employeeId))
    .map(row => [row.employeeId, row.date, row.before, row.after])

  it('changes only the label when the dates and mode stay', () => {
    const before = loadEntries(db)
    releaseMonth(db, admin, 1, 2026, 8, now)
    const closure = update({ label: 'Sommerferien' })
    expect(closure).toEqual({ id: closureId, ...summer, label: 'Sommerferien' })
    expect(listClosures(db, 1).map(entry => entry.label)).toEqual(['Sommerferien'])
    expect(loadEntries(db)).toEqual(before)
    expect(loggedDates()).toEqual([])
  })

  it('removes the linked entries of the days a shorter closure no longer covers', () => {
    releaseMonth(db, admin, 1, 2026, 8, now)
    update({ startDate: '2026-08-10', endDate: '2026-08-14' })
    const week = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14']
    expect(cells(anna)).toEqual(week.map(date => [date, 'vacation']))
    expect(linked(ben)).toEqual(week)
    expect(getLeaveAccount(db, anna, 2026, '2026-07-01').account.planned).toBe(5)
    // Only the real differences are logged, not the days that stayed.
    expect(loggedDates().map(([employeeId, date]) => [employeeId, date]))
      .toEqual([[anna, '2026-08-07'], [ben, '2026-08-07'], [anna, '2026-08-17'], [ben, '2026-08-17']])
    expect(loggedDates().every(([, , before, after]) => before === 'Urlaub' && after === '—')).toBe(true)
  })

  it('books the days a longer closure adds, only in empty cells', () => {
    applyToCells(db, admin, 1, [{ employeeId: anna, date: '2026-08-19' }], 'replace', { kind: 'shift', templateId: templateId(db, 'M') })
    releaseMonth(db, admin, 1, 2026, 8, now)
    update({ endDate: '2026-08-19' })
    expect(linked(anna)).toEqual(['2026-08-07', '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-17', '2026-08-18'])
    expect(cells(anna).at(-1)).toEqual(['2026-08-19', 'shift'])
    expect(linked(ben).slice(-2)).toEqual(['2026-08-18', '2026-08-19'])
    expect(cells(ben).every(([, code]) => code === 'vacation')).toBe(true)
    expect(loggedDates().map(([employeeId, date]) => [employeeId, date]))
      .toEqual([[anna, '2026-08-18'], [ben, '2026-08-18'], [ben, '2026-08-19']])
  })

  it('rebooks all linked days when the mode switches, and back', () => {
    update({ mode: 'closure_day' })
    expect(new Set(cells(anna).map(([, code]) => code))).toEqual(new Set(['closure_day']))
    expect(linked(ben)).toHaveLength(7)
    expect(getLeaveAccount(db, anna, 2026, '2026-07-01').account.planned).toBe(0)
    update({ mode: 'vacation' })
    expect(new Set(cells(ben).map(([, code]) => code))).toEqual(new Set(['vacation']))
    expect(getLeaveAccount(db, ben, 2026, '2026-07-01').account.planned).toBe(7)
  })

  it('leaves days changed by hand alone, also a cleared one', () => {
    applyToCells(db, admin, 1, [{ employeeId: anna, date: '2026-08-11' }], 'replace', { kind: 'shift', templateId: templateId(db, 'F2') })
    applyToCells(db, admin, 1, [{ employeeId: anna, date: '2026-08-12' }], 'clear', null)
    update({ mode: 'closure_day' })
    expect(cells(anna).filter(([date]) => date === '2026-08-11' || date === '2026-08-12')).toEqual([['2026-08-11', 'shift']])
    update({ startDate: '2026-08-12', mode: 'vacation' })
    expect(cells(anna).find(([date]) => date === '2026-08-11')).toEqual(['2026-08-11', 'shift'])
    expect(cells(anna).some(([date]) => date === '2026-08-12')).toBe(false)
    expect(cells(ben).map(([date]) => date)).toEqual(['2026-08-12', '2026-08-13', '2026-08-14', '2026-08-17'])
  })

  it('keeps a joiner within their leave left', () => {
    const dora = createEmployee(db, admin, 1, { name: 'Dora', shortName: '', weeklyMinutes: 2340, validFrom: '2026-08-01', vacationDays: 3 }, now)
    expect(cells(dora).filter(([, code]) => code === 'vacation').map(([date]) => date)).toEqual(['2026-08-07', '2026-08-10', '2026-08-11'])
    update({ startDate: '2026-08-10', endDate: '2026-08-19' })
    // The days staying keep their entries; the leave day freed on 7 August goes to the first new day.
    expect(cells(dora)).toEqual([
      ['2026-08-10', 'vacation'], ['2026-08-11', 'vacation'], ['2026-08-12', 'closure_day'],
      ['2026-08-13', 'closure_day'], ['2026-08-14', 'closure_day'], ['2026-08-17', 'closure_day'],
      ['2026-08-18', 'vacation'], ['2026-08-19', 'closure_day'],
    ])
    expect(getLeaveAccount(db, dora, 2026, '2026-07-01').account.available).toBe(0)
  })

  it('limits a joiner per year when the closure grows across the turn of the year', () => {
    const dora = createEmployee(db, admin, 1, { name: 'Dora', shortName: '', weeklyMinutes: 2340, validFrom: '2026-12-01', vacationDays: 2 }, now)
    const winter = createClosure(db, admin, 1, { startDate: '2026-12-21', endDate: '2026-12-23', label: 'Winter', mode: 'closure_day' }, now)
    updateClosure(db, admin, 1, winter.id, { startDate: '2026-12-21', endDate: '2027-01-08', label: 'Winter', mode: 'vacation' }, now)
    const winterCells = loadEntries(db, { employeeId: dora, closureId: winter.id }).map(entry => [entry.date, entry.codeKey])
    // The kept days come first: 21 and 22 December take the two leave days of the joining year, the rest of 2026 are
    // closure days; 2027 has no limit (she worked there from 1 January).
    expect(winterCells.filter(([date]) => date!.startsWith('2026-'))).toEqual([
      ['2026-12-21', 'vacation'], ['2026-12-22', 'vacation'],
      ...winterCells.filter(([date]) => date!.startsWith('2026-') && date! > '2026-12-22').map(([date]) => [date, 'closure_day']),
    ])
    expect(winterCells.filter(([date]) => date!.startsWith('2026-')).length).toBeGreaterThan(3)
    const next = winterCells.filter(([date]) => date!.startsWith('2027-'))
    expect(next.length).toBeGreaterThan(0)
    expect(next.every(([, code]) => code === 'vacation')).toBe(true)
    expect(getLeaveAccount(db, dora, 2026, '2026-12-01').account.available).toBe(0)
  })

  it('keeps a hand-added entry next to the closure\'s day when that day stays, and switches only the closure\'s code', () => {
    applyToCells(db, admin, 1, [{ employeeId: anna, date: '2026-08-12' }], 'add', { kind: 'code', codeId: codeId(db, 'sick') })
    const day = () => loadEntries(db, { employeeId: anna, from: '2026-08-12', to: '2026-08-12' }).map(entry => entry.codeKey).sort()
    const linkedCode = () => loadEntries(db, { employeeId: anna, closureId, from: '2026-08-12', to: '2026-08-12' }).map(entry => entry.codeKey)
    expect(day()).toEqual(['sick', 'vacation'])
    update({ endDate: '2026-08-19' })
    expect(day()).toEqual(['sick', 'vacation'])
    expect(linkedCode()).toEqual(['vacation'])
    update({ endDate: '2026-08-19', mode: 'closure_day' })
    expect(day()).toEqual(['closure_day', 'sick'])
    expect(linkedCode()).toEqual(['closure_day'])
  })

  it('books new days and creates closures only from the day someone moved in', () => {
    applyToCells(db, admin, 1, [{ employeeId: ben, date: '2026-08-04' }], 'replace', { kind: 'shift', templateId: templateId(db, 'M') })
    db.update(employees).set({ facilitySince: '2026-08-05' }).where(eq(employees.id, ben)).run()
    update({ startDate: '2026-08-03' })
    expect(linked(anna).slice(0, 4)).toEqual(['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06'])
    expect(linked(ben).slice(0, 3)).toEqual(['2026-08-05', '2026-08-06', '2026-08-07'])
    // Creating a closure does not book or replace anything before that day either.
    const spring = createClosure(db, admin, 1, { startDate: '2026-08-03', endDate: '2026-08-04', label: 'Teamtage', mode: 'closure_day' }, now)
    expect(loadEntries(db, { employeeId: ben, closureId: spring.id })).toEqual([])
    expect(cells(ben)[0]).toEqual(['2026-08-04', 'shift'])
  })

  it('skips a help-out day among the new days', () => {
    const krippe = addFacility(db, 'Krippe')
    const leitungB = addUser(db, 'leitung-b', 'admin', null, krippe)
    addHelpOut(db, anna, krippe, 2026, 8)
    applyToCells(db, leitungB, krippe, [{ employeeId: anna, date: '2026-08-18' }], 'replace', { kind: 'shift', templateId: templateId(db, 'M', krippe) })
    update({ endDate: '2026-08-19' })
    expect(loadEntries(db, { employeeId: anna, from: '2026-08-18', to: '2026-08-18' }).map(entry => [entry.kind, entry.helpFacilityId]))
      .toEqual([['shift', krippe]])
    expect(linked(anna).slice(-2)).toEqual(['2026-08-17', '2026-08-19'])
  })

  it('treats someone who moved away like the staff on a mode change, but books no new days for them', () => {
    const provider = addUser(db, 'traeger', 'provider')
    const krippe = addFacility(db, 'Krippe')
    moveEmployeeToFacility(db, provider, ben, krippe, new Date('2026-08-12T10:00:00Z'))
    expect(linked(ben)).toEqual(['2026-08-07', '2026-08-10', '2026-08-11'])
    update({ mode: 'closure_day' })
    expect(cells(ben)).toEqual([['2026-08-07', 'closure_day'], ['2026-08-10', 'closure_day'], ['2026-08-11', 'closure_day']])
    expect(getLeaveAccount(db, ben, 2026, '2026-07-01').account.planned).toBe(0)
    update({ startDate: '2026-08-10', endDate: '2026-08-19' })
    expect(cells(ben)).toEqual([['2026-08-10', 'vacation'], ['2026-08-11', 'vacation']])
    expect(getLeaveAccount(db, ben, 2026, '2026-07-01').account.planned).toBe(2)
  })

  it('validates like creating and refuses another facility\'s closure', () => {
    expect(errorCode(() => update({ endDate: '2026-08-01' }))).toBe('invalid_range')
    expect(errorCode(() => update({ endDate: '2027-08-17' }))).toBe('invalid_range')
    expect(errorCode(() => update({ label: ' ' }))).toBe('label_required')
    const krippe = addFacility(db, 'Krippe')
    const leitungB = addUser(db, 'leitung-b', 'admin', null, krippe)
    const other = createClosure(db, leitungB, krippe, summer, now)
    expect(errorCode(() => updateClosure(db, admin, 1, other.id, summer, now))).toBe('closure_not_found')
    expect(errorCode(() => updateClosure(db, admin, 1, 999, summer, now))).toBe('closure_not_found')
    expect(listClosures(db, krippe).map(entry => entry.label)).toEqual([summer.label])
  })
})
