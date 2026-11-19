import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { earlySickLeaves, entries } from '../../server/db/schema'
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
    expect(errorCode(() => applyToCells(db, editor, 1, [{ employeeId: ben, date: SICK_DAY }], 'replace', { kind: 'code', codeId: codeId(db, 'sick') })))
      .toBe('protected_cell')
    // A closure manager without the right is neither refused nor told (a sick day becomes the closure, as before).
    expect(errorCode(() => createClosure(db, editor, 1, { startDate: '2026-11-17', endDate: '2026-11-17', label: 'Brücke', mode: 'closure_day' })))
      .toBeNull()
  })
})
