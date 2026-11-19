import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { earlySickLeaves, entries, timeRecords } from '../../server/db/schema'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { getYearCalendar } from '../../server/services/calendar'
import { createClosure } from '../../server/services/closures'
import { applyToCells } from '../../server/services/entries'
import { getMonthPlan, getMyPlan } from '../../server/services/plan'
import { releaseMonth } from '../../server/services/release'
import { getTimeMonth } from '../../server/services/timeTracking'
import { buildDayOverview } from '../../shared/domain/dayOverview'
import type { EntryDto, SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, codeId, createTestDb, errorCode } from '../helpers/fixtures'

// „Alles Private als ‚abwesend‘“ (user decision 2026-11-19): Krank, Kind krank, Mutterschutz and Beschäftigungsverbot
// look the same to everybody without employees.sickness, and always at the tablet.

const TODAY = '2026-11-19'
const SICK_DAY = '2026-11-17'
const MATERNITY_DAY = '2026-11-18'
const SECRETS = /\bsick\b|child_sick|maternity|employment_ban|Krank|Kind krank|Mutterschutz|Beschäftigungsverbot/

let db: Db
let leitung: SessionUser
let anna: number
let annaUser: SessionUser
let ben: number
let benUser: SessionUser
let tablet: SessionUser
let editor: SessionUser

const codeOn = (employeeId: number, date: string, key: string) =>
  db.insert(entries).values({ employeeId, date, kind: 'code', absenceCodeId: codeId(db, key), note: 'privat', updatedAt: '2026-11-01T00:00:00.000Z' }).run()
/** An entry without what tells it apart from another day (id, day). */
const shape = ({ id: _id, date: _date, ...rest }: EntryDto) => rest
const entryOf = (list: EntryDto[], date: string) => list.find(entry => entry.employeeId === anna && entry.date === date)!

beforeEach(() => {
  db = createTestDb()
  const lea = addEmployee(db, 'Lea Leitung')
  leitung = addUser(db, 'leitung', 'admin', lea)
  anna = addEmployee(db, 'Anna Muster')
  annaUser = addUser(db, 'anna', 'observer', anna)
  ben = addEmployee(db, 'Ben Beispiel')
  benUser = addUser(db, 'ben', 'observer', ben)
  tablet = addUser(db, 'tablet', 'terminal')
  editor = { ...leitung, permissions: new Set([...leitung.permissions].filter(key => key !== 'employees.sickness')) } as SessionUser
  codeOn(anna, SICK_DAY, 'sick')
  codeOn(anna, MATERNITY_DAY, 'maternity')
  codeOn(anna, '2026-11-19', 'child_sick')
  codeOn(anna, '2026-11-20', 'employment_ban')
})

describe('a closure leaves every private absence as it is (Q1)', () => {
  it('a sick day and a Mutterschutz day stay alike for staff, and no leave is used during sickness', () => {
    createClosure(db, leitung, 1, { startDate: '2026-11-16', endDate: '2026-11-20', label: 'Herbst', mode: 'vacation' })
    releaseMonth(db, leitung, 1, 2026, 11)
    const plan = getMonthPlan(db, benUser, 1, 2026, 11, TODAY)
    const sick = shape(entryOf(plan.entries, SICK_DAY))
    expect(sick).toMatchObject({ label: 'abwesend', codeKey: null })
    for (const date of [MATERNITY_DAY, '2026-11-19', '2026-11-20']) expect(shape(entryOf(plan.entries, date))).toEqual(sick)
    // Only the free Monday became the closure; the private days kept their codes.
    const own = getMonthPlan(db, leitung, 1, 2026, 11, TODAY).entries.filter(entry => entry.employeeId === anna && entry.date >= '2026-11-16' && entry.date <= '2026-11-20')
    expect(own.map(entry => [entry.date, entry.codeKey])).toEqual([
      ['2026-11-16', 'vacation'], [SICK_DAY, 'sick'], [MATERNITY_DAY, 'maternity'], ['2026-11-19', 'child_sick'], ['2026-11-20', 'employment_ban'],
    ])
  })
})

describe('„Im Dienst erkrankt“ without the right: the neutral „zählt nach Plan“ (Q2)', () => {
  it('appears on the marked day like on a whole Büro day; the marker only for the right holders', () => {
    db.insert(entries).values({ employeeId: ben, date: '2026-11-10', kind: 'special', start: 480, end: 960, updatedAt: 'x' }).run()
    db.insert(entries).values({ employeeId: ben, date: '2026-11-11', kind: 'code', absenceCodeId: codeId(db, 'office'), updatedAt: 'x' }).run()
    for (const date of ['2026-11-10', '2026-11-11']) db.insert(timeRecords).values({ employeeId: ben, date, start: 480, end: 600, source: 'terminal', createdAt: 'x' }).run()
    db.insert(earlySickLeaves).values({ employeeId: ben, date: '2026-11-10', createdAt: 'x' }).run()
    setTimeTrackingFrom(db, 1, '2026-11-01')
    const masked = getTimeMonth(db, 1, ben, 2026, 11, TODAY, 600, false).days
    const day = (list: typeof masked, date: string) => list.find(item => item.date === date)!
    expect([day(masked, '2026-11-10'), day(masked, '2026-11-11')].map(item => [item.planCounted, item.sickLeave])).toEqual([[true, null], [true, null]])
    const full = getTimeMonth(db, 1, ben, 2026, 11, TODAY, 600).days
    expect(day(full, '2026-11-10').sickLeave).not.toBeNull()
    expect(day(full, '2026-11-12').planCounted).toBe(false)
  })
})

describe('a sick day and a Mutterschutz day look the same without the right', () => {
  it('in the draft plan, with the same neutral shape, no marker, no code to enter', () => {
    db.insert(earlySickLeaves).values({ employeeId: ben, date: SICK_DAY, createdAt: 'x' }).run()
    const plan = getMonthPlan(db, editor, 1, 2026, 11, TODAY)
    expect(JSON.stringify(plan)).not.toMatch(SECRETS)
    const sick = shape(entryOf(plan.entries, SICK_DAY))
    for (const date of [MATERNITY_DAY, '2026-11-19', '2026-11-20']) expect(shape(entryOf(plan.entries, date))).toEqual(sick)
    expect(sick).toMatchObject({ kind: 'code', codeKey: null, codeId: null, label: 'abwesend', color: 'gray', note: null, shortLabel: null })
    expect(plan.admin!.sickLeaves).toEqual({})
    expect(plan.codes.map(code => code.key)).toEqual(expect.not.arrayContaining(['sick', 'child_sick', 'maternity', 'employment_ban']))
    // The Leitung sees everything.
    const full = getMonthPlan(db, leitung, 1, 2026, 11, TODAY)
    expect(entryOf(full.entries, SICK_DAY).label).toBe('Krank')
    expect(Object.keys(full.admin!.sickLeaves)).toEqual([`${ben}|${SICK_DAY}`])
  })

  it('in the released plan and its changes, for staff and the tablet; the person herself keeps her own', () => {
    releaseMonth(db, leitung, 1, 2026, 11)
    db.delete(entries).run()
    releaseMonth(db, leitung, 1, 2026, 11)
    for (const viewer of [benUser, tablet]) {
      const plan = getMonthPlan(db, viewer, 1, 2026, 11, TODAY)
      expect(JSON.stringify(plan)).not.toMatch(SECRETS)
      expect(plan.changes[`${anna}|${SICK_DAY}`]![0]!.before).toBe('abwesend')
      expect(plan.changes[`${anna}|${MATERNITY_DAY}`]![0]!.before).toBe('abwesend')
    }
    expect(getMyPlan(db, annaUser, 2026, 11, TODAY).days.find(day => day.date === SICK_DAY)!.changes[0]!.before).toBe('Krank · privat')
  })

  it('in the year calendar, the time sheet and the day overview', () => {
    const calendar = getYearCalendar(db, 1, 2026, { showsProtected: false })
    expect(['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'].map(date => calendar.days[anna]![date])).toEqual(Array(4).fill('absent'))
    expect(JSON.stringify(calendar)).not.toMatch(SECRETS)
    db.insert(earlySickLeaves).values({ employeeId: anna, date: '2026-11-16', createdAt: 'x' }).run()
    const sheet = getTimeMonth(db, 1, anna, 2026, 11, TODAY, 600, false)
    expect(JSON.stringify(sheet)).not.toMatch(SECRETS)
    expect(sheet.days.filter(day => day.date >= SICK_DAY && day.date <= '2026-11-20').map(day => day.plan)).toEqual(Array(4).fill('abwesend'))
    expect(sheet.days.find(day => day.date === '2026-11-16')!.sickLeave).toBeNull()
    const plan = getMonthPlan(db, editor, 1, 2026, 11, TODAY)
    const overview = buildDayOverview([
      { employeeId: 1, entries: [entryOf(plan.entries, SICK_DAY)] }, { employeeId: 2, entries: [entryOf(plan.entries, MATERNITY_DAY)] },
    ], false)
    expect(overview.rows[0]!.states).toEqual(overview.rows[1]!.states)
    expect(overview.rows[0]!.states.every(state => state === 'absent')).toBe(true)
  })

  it('without the „Kind krank“ hint, and without changing such a day; a closure still books for everybody', () => {
    // More „Kind krank“ than the entitlement (none): the hint only with the right.
    const hintTypes = (viewer: SessionUser) => getMonthPlan(db, viewer, 1, 2026, 11, TODAY).admin!.warnings.map(warning => warning.type)
    expect(hintTypes(leitung)).toContain('child_sick_days')
    expect(hintTypes(editor)).not.toContain('child_sick_days')
    expect(errorCode(() => applyToCells(db, editor, 1, [{ employeeId: anna, date: SICK_DAY }], 'replace', { kind: 'special', start: 480, end: 720 })))
      .toBe('protected_cell')
    expect(errorCode(() => applyToCells(db, editor, 1, [{ employeeId: ben, date: SICK_DAY }], 'replace', { kind: 'code', codeId: codeId(db, 'child_sick') })))
      .toBe('protected_cell')
    // „Krank melden“ (tests/services/reportSick.test.ts): Krank itself onto a day without a private code.
    expect(errorCode(() => applyToCells(db, editor, 1, [{ employeeId: ben, date: SICK_DAY }], 'replace', { kind: 'code', codeId: codeId(db, 'sick') })))
      .toBeNull()
    // A closure manager without the right is neither refused nor told.
    expect(errorCode(() => createClosure(db, editor, 1, { startDate: '2026-11-17', endDate: '2026-11-18', label: 'Brücke', mode: 'closure_day' })))
      .toBeNull()
  })
})
