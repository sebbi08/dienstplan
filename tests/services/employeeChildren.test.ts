import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { absenceCodes, employeeChildren, employeeHours, employees, entries } from '../../server/db/schema'
import { getYearCalendar, getStaffYearCalendar } from '../../server/services/calendar'
import {
  getChildSickSettings, getChildSickYear, getEmployeeChildren, MAX_CHILDREN, setChildSickSettings, setEmployeeChildren,
} from '../../server/services/employeeChildren'
import { getPayrollView } from '../../server/services/employeePayroll'
import { applyToCells } from '../../server/services/entries'
import { getMonthPlan } from '../../server/services/plan'
import { loadEmployee, loadEntries } from '../../server/services/queries'
import { computeDay } from '../../shared/domain/balance'
import { CHILD_SICK_DEFAULTS } from '../../shared/domain/childSickDays'
import type { PermissionKey } from '../../shared/domain/permissions'
import type { EmployeeChildrenInput, SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addUser, codeId, createTestDb, errorCode, permissionsOf } from '../helpers/fixtures'

const today = '2026-11-19'

let db: Db
let leitung: SessionUser
let anna: number
beforeEach(() => {
  db = createTestDb()
  leitung = addUser(db, 'leitung', 'admin')
  anna = addEmployee(db, 'Anna')
})

const LEITUNG = permissionsOf('admin')
const save = (input: EmployeeChildrenInput, employeeId = anna, permissions: ReadonlySet<PermissionKey> = LEITUNG, facilityId = 1) =>
  setEmployeeChildren(db, facilityId, employeeId, input, permissions, today)
const child = (birthDate: string, extra: { firstName?: string | null; disabledDependent?: boolean; id?: number } = {}) =>
  ({ firstName: extra.firstName ?? null, birthDate, disabledDependent: extra.disabledDependent ?? false, ...(extra.id ? { id: extra.id } : {}) })
const childSick = (date: string, employeeChildId: number | null = null, employeeId = anna) =>
  applyToCells(db, leitung, 1, [{ employeeId, date }], 'replace', { kind: 'code', codeId: codeId(db, 'child_sick'), employeeChildId })

describe('the code „Kind krank“', () => {
  it('exists after Krank, credits the daily target like Krank and has no times', () => {
    const codes = db.select().from(absenceCodes).all().sort((a, b) => a.sortOrder - b.sortOrder)
    const keys = codes.map(code => code.key)
    expect(keys.indexOf('child_sick')).toBe(keys.indexOf('sick') + 1)
    expect(codes.find(code => code.key === 'child_sick'))
      .toMatchObject({ label: 'Kind krank', creditMode: 'daily_target', requiresTimes: false })
    expect(new Set(codes.map(code => code.sortOrder)).size).toBe(codes.length)
  })

  it('is neutral for the hours account: the day credits its target, no minus hours', () => {
    childSick('2026-11-17')
    const info = loadEmployee(db, anna)!.info
    const day = computeDay(info, '2026-11-17', loadEntries(db, { employeeId: anna }))
    expect(day.target).toBe(468)
    expect(day.credit).toBe(day.target)
  })

  it('shows as Krank in the year calendar, and colleagues do not see it', () => {
    childSick('2026-11-17')
    expect(getYearCalendar(db, 1, 2026).days[anna]!['2026-11-17']).toBe('sick')
    const ben = addEmployee(db, 'Ben')
    expect(getStaffYearCalendar(db, 1, 2026, ben).days[anna]!['2026-11-17']).toBeUndefined()
    expect(getStaffYearCalendar(db, 1, 2026, anna).days[anna]!['2026-11-17']).toBe('sick')
  })
})

describe('the section „Kinder“ of the personnel file', () => {
  it('starts empty and saves, changes and removes the children at once, sorted by birth date', () => {
    expect(getEmployeeChildren(db, 1, anna)).toEqual({ singleParent: false, children: [] })
    const saved = save({ singleParent: true, children: [child('2020-05-04', { firstName: '  Lena ' }), child('2016-01-10')] })
    expect(saved).toMatchObject({
      singleParent: true,
      children: [
        { firstName: null, birthDate: '2016-01-10', disabledDependent: false },
        { firstName: 'Lena', birthDate: '2020-05-04', disabledDependent: false },
      ],
    })
    const [older, lena] = saved.children as [{ id: number }, { id: number }]
    const changed = save({ singleParent: false, children: [child('2020-05-04', { id: lena.id, firstName: 'Lena', disabledDependent: true })] })
    expect(changed).toEqual({
      singleParent: false, children: [{ id: lena.id, firstName: 'Lena', birthDate: '2020-05-04', disabledDependent: true }],
    })
    expect(db.select().from(employeeChildren).where(eq(employeeChildren.id, older.id)).all()).toEqual([])
  })

  it('checks the birth dates, the number and the ids', () => {
    expect(errorCode(() => save({ singleParent: false, children: [child('2026-02-30')] }))).toBe('child_birth_date_invalid')
    expect(errorCode(() => save({ singleParent: false, children: [child('2026-11-20')] }))).toBe('child_birth_date_invalid')
    expect(errorCode(() => save({ singleParent: false, children: [child('1899-12-31')] }))).toBe('child_birth_date_invalid')
    const many = Array.from({ length: MAX_CHILDREN + 1 }, () => child('2020-01-01'))
    expect(errorCode(() => save({ singleParent: false, children: many }))).toBe('too_many_children')
    const ben = addEmployee(db, 'Ben')
    const bens = save({ singleParent: false, children: [child('2019-01-01')] }, ben).children[0]!
    expect(errorCode(() => save({ singleParent: false, children: [child('2019-01-01', { id: bens.id })] }))).toBe('employee_child_not_found')
    // Nothing was written by the refused requests.
    expect(getEmployeeChildren(db, 1, anna).children).toEqual([])
  })

  it('needs employees.personal to change, and an employee of the facility', () => {
    const observer = permissionsOf('observer')
    expect(errorCode(() => save({ singleParent: true, children: [] }, anna, observer))).toBe('forbidden')
    const withoutPersonal = new Set([...LEITUNG].filter(key => key !== 'employees.personal'))
    expect(errorCode(() => save({ singleParent: true, children: [] }, anna, withoutPersonal))).toBe('forbidden')
    const elsewhere = addEmployee(db, 'Fremd', { facilityId: addFacility(db, 'Hort') })
    expect(errorCode(() => getEmployeeChildren(db, 1, elsewhere))).toBe('employee_not_found')
    expect(errorCode(() => save({ singleParent: true, children: [] }, elsewhere))).toBe('employee_not_found')
    expect(db.select({ singleParent: employees.singleParent }).from(employees).where(eq(employees.id, anna)).get()!.singleParent).toBe(false)
  })

  it('goes with the employee', () => {
    save({ singleParent: false, children: [child('2020-01-01')] })
    db.delete(employeeHours).where(eq(employeeHours.employeeId, anna)).run()
    db.delete(employees).where(eq(employees.id, anna)).run()
    expect(db.select().from(employeeChildren).all()).toEqual([])
  })
})

describe('„Kind krank“ with the child', () => {
  it('stores the chosen child of the employee; another employee\'s child is refused', () => {
    const lena = save({ singleParent: false, children: [child('2020-05-04', { firstName: 'Lena' })] }).children[0]!
    childSick('2026-11-17', lena.id)
    expect(db.select({ child: entries.employeeChildId }).from(entries).where(eq(entries.employeeId, anna)).all()).toEqual([{ child: lena.id }])
    const ben = addEmployee(db, 'Ben')
    expect(errorCode(() => childSick('2026-11-18', lena.id, ben))).toBe('employee_child_invalid')
    // Two employees at once with one child: refused too.
    expect(errorCode(() => applyToCells(db, leitung, 1, [{ employeeId: anna, date: '2026-11-18' }, { employeeId: ben, date: '2026-11-18' }],
      'replace', { kind: 'code', codeId: codeId(db, 'child_sick'), employeeChildId: lena.id }))).toBe('employee_child_invalid')
  })

  it('ignores a child on any other code, and keeps the day when the child is removed', () => {
    const lena = save({ singleParent: false, children: [child('2020-05-04')] }).children[0]!
    applyToCells(db, leitung, 1, [{ employeeId: anna, date: '2026-11-16' }], 'replace',
      { kind: 'code', codeId: codeId(db, 'sick'), employeeChildId: lena.id })
    childSick('2026-11-17', lena.id)
    save({ singleParent: false, children: [] })
    expect(db.select({ date: entries.date, child: entries.employeeChildId }).from(entries).where(eq(entries.employeeId, anna)).all())
      .toEqual([{ date: '2026-11-16', child: null }, { date: '2026-11-17', child: null }])
  })

  it('never puts the child into the plan\'s entries', () => {
    const lena = save({ singleParent: false, children: [child('2020-05-04', { firstName: 'Lena' })] }).children[0]!
    childSick('2026-11-17', lena.id)
    const plan = getMonthPlan(db, leitung, 1, 2026, 11, today)
    const entry = plan.entries.find(candidate => candidate.employeeId === anna)!
    expect(entry.label).toBe('Kind krank')
    expect(JSON.stringify(plan)).not.toContain('Lena')
    expect(Object.keys(entry)).not.toContain('employeeChildId')
  })
})

describe('Kinderkrankentage per year', () => {
  it('counts the working days with „Kind krank“ against the entitlement', () => {
    expect(getChildSickYear(db, 1, anna, 2026)).toEqual({ year: 2026, taken: 0, entitlement: 0, eligibleChildren: 0 })
    save({ singleParent: false, children: [child('2020-05-04'), child('2010-01-01'), child('2005-01-01', { disabledDependent: true })] })
    childSick('2026-11-16')
    childSick('2026-11-17')
    // A Saturday is no working day: it takes nothing.
    childSick('2026-11-21')
    expect(getChildSickYear(db, 1, anna, 2026)).toEqual({ year: 2026, taken: 2, entitlement: 30, eligibleChildren: 2 })
    expect(getChildSickYear(db, 1, anna, 2025).taken).toBe(0)
  })

  it('gives single parents the higher entitlement and follows the Träger\'s values', () => {
    save({ singleParent: true, children: [child('2020-05-04')] })
    expect(getChildSickYear(db, 1, anna, 2026).entitlement).toBe(30)
    setChildSickSettings(db, { perChild: 10, maxPerYear: 25, singleParentPerChild: 20, singleParentMax: 50 })
    expect(getChildSickYear(db, 1, anna, 2026).entitlement).toBe(20)
  })

  it('keeps the statutory defaults until the Träger stores own values, and checks them', () => {
    expect(getChildSickSettings(db)).toEqual(CHILD_SICK_DEFAULTS)
    expect(errorCode(() => setChildSickSettings(db, { ...CHILD_SICK_DEFAULTS, perChild: 2.5 }))).toBe('child_sick_settings_invalid')
    expect(errorCode(() => setChildSickSettings(db, { ...CHILD_SICK_DEFAULTS, singleParentMax: 10 }))).toBe('child_sick_settings_invalid')
    // An emptied field (sent as '') gets the same message, not a generic error.
    expect(errorCode(() => setChildSickSettings(db, { ...CHILD_SICK_DEFAULTS, maxPerYear: '' }))).toBe('child_sick_settings_invalid')
    expect(getChildSickSettings(db)).toEqual(CHILD_SICK_DEFAULTS)
    expect(setChildSickSettings(db, { perChild: 20, maxPerYear: 40, singleParentPerChild: 40, singleParentMax: 80 }))
      .toEqual({ perChild: 20, maxPerYear: 40, singleParentPerChild: 40, singleParentMax: 80 })
  })

  it('warns in the plan on the last „Kind krank“ day once the days exceed the entitlement, never blocking', () => {
    const warnings = (month: number) => getMonthPlan(db, leitung, 1, 2026, month, today).admin!.warnings
      .filter(warning => warning.type === 'child_sick_days')
    setChildSickSettings(db, { perChild: 2, maxPerYear: 35, singleParentPerChild: 30, singleParentMax: 70 })
    save({ singleParent: false, children: [child('2020-05-04')] })
    childSick('2026-10-29')
    childSick('2026-10-30')
    expect(warnings(10)).toEqual([])
    childSick('2026-11-02')
    childSick('2026-11-03')
    expect(warnings(10)).toEqual([])
    expect(warnings(11)).toEqual([{ type: 'child_sick_days', date: '2026-11-03', employeeId: anna, taken: 4, entitlement: 2 }])
    // Without eligible children every day is over.
    save({ singleParent: false, children: [] })
    expect(warnings(10)).toEqual([{ type: 'child_sick_days', date: '2026-10-30', employeeId: anna, taken: 2, entitlement: 0 }])
  })

  it('leaves the numbers out of the warning for plan editors who may not see the children', () => {
    save({ singleParent: true, children: [child('2020-05-04')] })
    for (const date of ['2026-11-02', '2026-11-03', '2026-11-04']) childSick(date)
    setChildSickSettings(db, { perChild: 1, maxPerYear: 35, singleParentPerChild: 2, singleParentMax: 70 })
    const editor: SessionUser = { ...leitung, permissions: new Set([...leitung.permissions].filter(key => key !== 'employees.personal')) }
    const of = (viewer: SessionUser) => getMonthPlan(db, viewer, 1, 2026, 11, today).admin!.warnings
      .filter(warning => warning.type === 'child_sick_days')
    expect(of(leitung)).toEqual([{ type: 'child_sick_days', date: '2026-11-04', employeeId: anna, taken: 3, entitlement: 2 }])
    expect(of(editor)).toEqual([{ type: 'child_sick_days', date: '2026-11-04', employeeId: anna, taken: null, entitlement: null }])
  })
})

describe('the parent status in „Lohn und Steuer“', () => {
  it('derives „Elterneigenschaft“ and the children under 25 from the children, as of today', () => {
    expect(getPayrollView(db, 1, anna, today)).toMatchObject({ taxId: null, parentStatus: { parent: false, childrenUnder25: 0 } })
    save({ singleParent: false, children: [child('2001-11-20'), child('1999-03-01'), child('2015-06-06')] })
    expect(getPayrollView(db, 1, anna, today).parentStatus).toEqual({ parent: true, childrenUnder25: 2 })
    // The child turning 25 tomorrow counts today, not tomorrow.
    expect(getPayrollView(db, 1, anna, '2026-11-20').parentStatus).toEqual({ parent: true, childrenUnder25: 1 })
  })
})
