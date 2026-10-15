import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { employees } from '../../server/db/schema'
import { createClosure, deleteClosure, listClosures } from '../../server/services/closures'
import { createEmployee, setEntitlement } from '../../server/services/employees'
import { applyToCells } from '../../server/services/entries'
import { updateFacility } from '../../server/services/facilities'
import type { GermanState } from '../../shared/domain/states'
import { getLeaveAccount } from '../../server/services/leave'
import { getMonthPlan } from '../../server/services/plan'
import { loadEntries } from '../../server/services/queries'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, createTestDb, errorCode, templateId } from '../helpers/fixtures'

const summer = { startDate: '2026-08-07', endDate: '2026-08-17', label: 'Sommerschließzeit', mode: 'vacation' as const }
const inRange = (db: Db) => loadEntries(db, { from: summer.startDate, to: summer.endDate })

describe('closures service', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  let ben: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
    ben = addEmployee(db, 'Ben')
  })

  it('writes the chosen code for every employee on every working day', () => {
    applyToCells(db, admin, 1, [{ employeeId: anna, date: '2026-08-10' }], 'replace', { kind: 'shift', templateId: templateId(db, 'M') })
    const closure = createClosure(db, admin, 1, summer)
    const rows = inRange(db)
    expect(rows).toHaveLength(14)
    expect(rows.every(entry => entry.codeKey === 'vacation')).toBe(true)
    expect(rows.some(entry => entry.date === '2026-08-08')).toBe(false)
    expect(listClosures(db, 1)).toEqual([closure])
    expect(getLeaveAccount(db, anna, 2026, '2026-08-01').account.planned).toBe(7)
  })
  it('uses the closure-day code in closure-day mode', () => {
    createClosure(db, admin, 1, { ...summer, mode: 'closure_day' })
    expect(new Set(inRange(db).map(entry => entry.codeKey))).toEqual(new Set(['closure_day']))
  })
  it('keeps admin overrides when the closure is deleted', () => {
    const closure = createClosure(db, admin, 1, summer)
    applyToCells(db, admin, 1, [{ employeeId: anna, date: '2026-08-11' }], 'replace', { kind: 'shift', templateId: templateId(db, 'F2') })
    deleteClosure(db, admin, 1, closure.id)
    expect(inRange(db).map(entry => [entry.employeeId, entry.date, entry.label])).toEqual([[anna, '2026-08-11', '7:30–15:45']])
    expect(listClosures(db, 1)).toEqual([])
  })
  it('suppresses warnings on closure days', () => {
    createClosure(db, admin, 1, summer)
    applyToCells(db, admin, 1, [{ employeeId: ben, date: '2026-08-12' }], 'clear', null)
    const warnings = getMonthPlan(db, admin, 1, 2026, 8, '2026-08-01').admin!.warnings
    expect(warnings.filter(w => w.date === '2026-08-12')).toEqual([])
  })
  it('validates the range and label', () => {
    expect(errorCode(() => createClosure(db, admin, 1, { ...summer, endDate: '2026-08-01' }))).toBe('invalid_range')
    expect(errorCode(() => createClosure(db, admin, 1, { ...summer, label: ' ' }))).toBe('label_required')
    expect(errorCode(() => deleteClosure(db, admin, 1, 999))).toBe('closure_not_found')
  })
})

describe('closures and part-time working days', () => {
  it('books the closure only on each employee’s working days', () => {
    const db = createTestDb()
    const admin = addUser(db, 'leitung', 'admin')
    const clara = createEmployee(db, admin, 1, { name: 'Clara', shortName: '', weeklyMinutes: 1200, validFrom: '2026-01-01', workdays: 0b00111 })
    createClosure(db, admin, 1, { startDate: '2026-08-10', endDate: '2026-08-14', label: 'Schließwoche', mode: 'vacation' })
    expect(loadEntries(db, { employeeId: clara }).map(entry => entry.date)).toEqual(['2026-08-10', '2026-08-11', '2026-08-12'])
  })
})

describe('closures for employees who join later', () => {
  let db: Db
  let admin: SessionUser
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
  })
  const codes = (employeeId: number) => loadEntries(db, { employeeId }).map(entry => [entry.date, entry.codeKey])

  it('books existing closures for a new employee from their first day', () => {
    const closure = createClosure(db, admin, 1, summer)
    const dora = createEmployee(db, admin, 1, { name: 'Dora', shortName: '', weeklyMinutes: 2340, validFrom: '2026-08-12', vacationDays: 30 })
    expect(codes(dora)).toEqual(['2026-08-12', '2026-08-13', '2026-08-14', '2026-08-17'].map(date => [date, 'vacation']))
    // linked to the closure, so deleting the closure removes them again
    expect(loadEntries(db, { employeeId: dora, closureId: closure.id })).toHaveLength(4)
  })
  it('never takes a joiner below zero leave in the joining year: the rest become closure days', () => {
    createClosure(db, admin, 1, summer)
    const dora = createEmployee(db, admin, 1, { name: 'Dora', shortName: '', weeklyMinutes: 2340, validFrom: '2026-08-01', vacationDays: 2 })
    expect(codes(dora).map(([, code]) => code)).toEqual(['vacation', 'vacation', 'closure_day', 'closure_day', 'closure_day', 'closure_day', 'closure_day'])
    expect(getLeaveAccount(db, dora, 2026, '2026-08-01').account.available).toBe(0)
  })
  it('applies the same limit to a closure entered after the joiner', () => {
    const dora = createEmployee(db, admin, 1, { name: 'Dora', shortName: '', weeklyMinutes: 2340, validFrom: '2026-08-01', vacationDays: 3 })
    createClosure(db, admin, 1, summer)
    expect(codes(dora).filter(([, code]) => code === 'vacation')).toHaveLength(3)
    expect(getLeaveAccount(db, dora, 2026, '2026-08-01').account.available).toBe(0)
  })
  it('lets staff employed since the start of the year go below zero', () => {
    const anna = addEmployee(db, 'Anna')
    setEntitlement(db, 1, anna, 2026, { days: 2, carriedOverDays: 0 })
    createClosure(db, admin, 1, summer)
    expect(getLeaveAccount(db, anna, 2026, '2026-08-01').account.available).toBe(-5)
  })
  it('books leave normally in a year without a recorded entitlement', () => {
    createClosure(db, admin, 1, { startDate: '2027-01-04', endDate: '2027-01-08', label: 'Winter', mode: 'vacation' })
    const dora = createEmployee(db, admin, 1, { name: 'Dora', shortName: '', weeklyMinutes: 2340, validFrom: '2026-12-01', vacationDays: 1 })
    expect(new Set(codes(dora).map(([, code]) => code))).toEqual(new Set(['vacation']))
  })
})

describe('closures when the facility\'s holidays change', () => {
  // 2028-08-15 is a Tuesday (Assumption Day in Bavaria with the flag on), 2028-01-06 a Thursday (Epiphany in BW).
  const august = { startDate: '2028-08-07', endDate: '2028-08-18', label: 'Sommerschließzeit', mode: 'vacation' as const }
  const assumption = '2028-08-15'
  let db: Db
  let admin: SessionUser
  let provider: SessionUser
  let anna: number
  let ben: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    provider = addUser(db, 'traeger', 'provider')
    anna = addEmployee(db, 'Anna')
    ben = addEmployee(db, 'Ben')
  })
  const setRules = (state: GermanState, assumptionDay: boolean) =>
    updateFacility(db, provider, 1, { name: 'Kindergarten', state, assumptionDay })
  const codeOn = (employeeId: number, date: string) =>
    loadEntries(db, { employeeId, from: date, to: date }).map(entry => entry.codeKey)

  it('books a day that became a working day inside an existing closure, charging leave in vacation mode', () => {
    setRules('BY', true)
    const closure = createClosure(db, admin, 1, august)
    expect(codeOn(anna, assumption)).toEqual([])
    expect(getLeaveAccount(db, anna, 2028, '2028-08-01').account.planned).toBe(9)
    setRules('BY', false)
    expect(codeOn(anna, assumption)).toEqual(['vacation'])
    expect(codeOn(ben, assumption)).toEqual(['vacation'])
    expect(loadEntries(db, { employeeId: anna, closureId: closure.id })).toHaveLength(10)
    expect(getLeaveAccount(db, anna, 2028, '2028-08-01').account.planned).toBe(10)
  })

  it('books closure days in closure-day mode after a change of state', () => {
    createClosure(db, admin, 1, { startDate: '2028-01-03', endDate: '2028-01-07', label: 'Winter', mode: 'closure_day' })
    expect(codeOn(anna, '2028-01-06')).toEqual([])
    setRules('NI', true)
    expect(codeOn(anna, '2028-01-06')).toEqual(['closure_day'])
    expect(codeOn(ben, '2028-01-06')).toEqual(['closure_day'])
  })

  it('never overwrites an entry on a day that became a working day', () => {
    setRules('BY', true)
    createClosure(db, admin, 1, august)
    applyToCells(db, admin, 1, [{ employeeId: anna, date: assumption }], 'replace', { kind: 'shift', templateId: templateId(db, 'M') })
    // A cleared closure day stays empty: only days that just became working days are filled.
    applyToCells(db, admin, 1, [{ employeeId: anna, date: '2028-08-16' }], 'clear', null)
    setRules('BY', false)
    expect(loadEntries(db, { employeeId: anna, from: assumption, to: assumption }).map(entry => entry.kind)).toEqual(['shift'])
    expect(codeOn(anna, '2028-08-16')).toEqual([])
    expect(codeOn(ben, assumption)).toEqual(['vacation'])
  })

  it('books nothing when the rules stay the same', () => {
    createClosure(db, admin, 1, august)
    applyToCells(db, admin, 1, [{ employeeId: anna, date: '2028-08-16' }], 'clear', null)
    const before = loadEntries(db)
    updateFacility(db, provider, 1, { name: 'Kita Sonnenschein', state: 'BW', assumptionDay: false })
    expect(loadEntries(db)).toEqual(before)
  })

  it('leaves days before someone moved in alone', () => {
    setRules('BY', true)
    createClosure(db, admin, 1, august)
    db.update(employees).set({ facilitySince: '2028-08-16' }).where(eq(employees.id, ben)).run()
    setRules('BY', false)
    expect(codeOn(ben, assumption)).toEqual([])
    expect(codeOn(anna, assumption)).toEqual(['vacation'])
  })
})
