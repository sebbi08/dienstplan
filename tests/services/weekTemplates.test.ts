import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type { Db } from '../../server/db/client'
import { changeLog, entries, shiftTemplates, weekTemplateEntries } from '../../server/db/schema'
import { createClosure } from '../../server/services/closures'
import { addHours, updateEmployee } from '../../server/services/employees'
import { applyToCells } from '../../server/services/entries'
import { getMonthPlan } from '../../server/services/plan'
import { loadEntries } from '../../server/services/queries'
import { releaseMonth } from '../../server/services/release'
import {
  applyWeekTemplate, deleteWeekTemplate, listWeekTemplates, renameWeekTemplate, saveWeekTemplate, weekTemplateNames,
} from '../../server/services/weekTemplates'
import type { SessionUser } from '../../shared/types/api'
import {
  addEmployee, addFacility, addGroup, addHelpOut, addUser, codeId, createTestDb, errorCode, templateId,
} from '../helpers/fixtures'

// 2026-10-05 is a Monday; 2026-10-12 the Monday after.
const week = '2026-10-05'
const next = '2026-10-12'

describe('week templates', () => {
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
  const shift = (employeeId: number, date: string, label: string) =>
    applyToCells(db, admin, 1, [{ employeeId, date }], 'replace', { kind: 'shift', templateId: templateId(db, label) })
  const code = (employeeId: number, date: string, key: string, start?: number, end?: number) =>
    applyToCells(db, admin, 1, [{ employeeId, date }], 'replace', { kind: 'code', codeId: codeId(db, key), start, end })
  const cell = (employeeId: number, date: string) => loadEntries(db, { employeeId, from: date, to: date }).map(e => e.label)

  it('saves the working entries of Monday to Friday and leaves one-off absences out', () => {
    shift(anna, '2026-10-05', 'F1')
    shift(anna, '2026-10-06', 'M')
    applyToCells(db, admin, 1, [{ employeeId: anna, date: '2026-10-06' }], 'add', { kind: 'break', start: 900, end: 915 })
    code(anna, '2026-10-07', 'vacation')
    code(berta, '2026-10-05', 'prep_time', 450, 570)
    shift(berta, '2026-10-05', 'S')
    shift(berta, '2026-10-10', 'S') // Saturday: not part of a template
    const template = saveWeekTemplate(db, 1, { name: ' Woche A ', weekStart: week })
    expect(template.name).toBe('Woche A')
    expect(template.rows).toEqual([
      { employeeId: anna, name: 'Anna', days: ['F1', 'M + [15:00–15:15]', '', '', ''] },
      { employeeId: berta, name: 'Berta', days: ['VZ 7:30–9:30 + S', '', '', '', ''] },
    ])
  })

  it('fills only empty working days and skips holidays, closures, days off and staff who left', () => {
    shift(anna, '2026-10-05', 'F1')
    shift(anna, '2026-10-06', 'F1')
    shift(anna, '2026-10-07', 'F1')
    shift(berta, '2026-10-05', 'S')
    shift(berta, '2026-10-08', 'S')
    const template = saveWeekTemplate(db, 1, { name: 'Woche A', weekStart: week })

    code(anna, '2026-10-12', 'sick') // already filled: stays
    createClosure(db, admin, 1, { startDate: '2026-10-13', endDate: '2026-10-13', label: 'Konzeptionstag', mode: 'closure_day' })
    addHours(db, 1, berta, { weeklyMinutes: 1200, validFrom: '2026-10-12', workdays: 0b00111 }) // Berta: Mo–Mi from now on
    const result = applyWeekTemplate(db, admin, 1, template.id, next)

    expect(cell(anna, '2026-10-12')).toEqual(['Krank'])
    expect(cell(anna, '2026-10-13')).toEqual(['Schließtag'])
    expect(cell(anna, '2026-10-14')).toEqual(['7:00–13:15'])
    expect(cell(berta, '2026-10-12')).toEqual(['8:45–17:00'])
    expect(cell(berta, '2026-10-15')).toEqual([]) // Thursday is now her day off
    expect(result).toEqual({ filled: 2, skipped: 3 })

    updateEmployee(db, 1, anna, { name: 'Anna', shortName: 'An', leftOn: '2026-10-16' })
    expect(applyWeekTemplate(db, admin, 1, template.id, '2026-10-19')).toEqual({ filled: 1, skipped: 4 }) // only Berta's Monday
  })

  it('keeps changed times and breaks exactly and logs changes in a released month', () => {
    shift(anna, '2026-10-05', 'M')
    const [entry] = loadEntries(db, { employeeId: anna, from: '2026-10-05', to: '2026-10-05' })
    applyToCells(db, admin, 1, [{ employeeId: anna, date: '2026-10-05' }], 'add', { kind: 'break', start: 900, end: 910 })
    const template = saveWeekTemplate(db, 1, { name: 'Woche A', weekStart: week })
    releaseMonth(db, admin, 1, 2026, 10)
    const before = db.select().from(changeLog).all().length
    applyWeekTemplate(db, admin, 1, template.id, '2026-10-19')
    const copied = loadEntries(db, { employeeId: anna, from: '2026-10-19', to: '2026-10-19' })
    expect(copied.map(e => [e.kind, e.templateId, e.start, e.end, e.breakStart, e.breakEnd]))
      .toEqual([[entry!.kind, entry!.templateId, entry!.start, entry!.end, entry!.breakStart, entry!.breakEnd], ['break', null, 900, 910, null, null]])
    expect(db.select().from(changeLog).all().length).toBe(before + 1)
  })

  it('replaces a template saved again under the same name, renames and deletes', () => {
    shift(anna, '2026-10-05', 'F1')
    const first = saveWeekTemplate(db, 1, { name: 'Woche A', weekStart: week })
    shift(anna, '2026-10-12', 'S')
    const second = saveWeekTemplate(db, 1, { name: 'Woche A', weekStart: next })
    expect(second.id).toBe(first.id)
    expect(listWeekTemplates(db, 1).map(t => [t.name, t.rows[0]!.days[0]])).toEqual([['Woche A', 'S']])

    shift(berta, '2026-10-05', 'M')
    const other = saveWeekTemplate(db, 1, { name: 'Woche B', weekStart: week })
    expect(errorCode(() => renameWeekTemplate(db, 1, other.id, 'Woche A'))).toBe('name_taken')
    renameWeekTemplate(db, 1, other.id, 'Frühjahr')
    expect(listWeekTemplates(db, 1).map(t => t.name)).toEqual(['Frühjahr', 'Woche A'])
    deleteWeekTemplate(db, 1, first.id)
    expect(listWeekTemplates(db, 1).map(t => t.name)).toEqual(['Frühjahr'])
  })

  it('validates its input', () => {
    expect(errorCode(() => saveWeekTemplate(db, 1, { name: 'Leer', weekStart: week }))).toBe('empty_week')
    shift(anna, '2026-10-05', 'F1')
    expect(errorCode(() => saveWeekTemplate(db, 1, { name: ' ', weekStart: week }))).toBe('name_required')
    expect(errorCode(() => saveWeekTemplate(db, 1, { name: 'A', weekStart: '2026-10-06' }))).toBe('not_a_monday')
    const template = saveWeekTemplate(db, 1, { name: 'A', weekStart: week })
    expect(errorCode(() => applyWeekTemplate(db, admin, 1, template.id, '2026-10-06'))).toBe('not_a_monday')
    expect(errorCode(() => applyWeekTemplate(db, admin, 1, 999, next))).toBe('week_template_not_found')
    expect(errorCode(() => deleteWeekTemplate(db, 1, 999))).toBe('week_template_not_found')
  })
})

describe('week templates and changed services', () => {
  it('inserts a shift whose service changed since saving as a special shift with the saved times', () => {
    const db = createTestDb()
    const admin = addUser(db, 'leitung', 'admin')
    const anna = addEmployee(db, 'Anna')
    applyToCells(db, admin, 1, [{ employeeId: anna, date: week }, { employeeId: anna, date: '2026-10-06' }], 'replace', { kind: 'shift', templateId: templateId(db, 'F1') })
    applyToCells(db, admin, 1, [{ employeeId: anna, date: '2026-10-07' }], 'replace', { kind: 'shift', templateId: templateId(db, 'M') })
    const template = saveWeekTemplate(db, 1, { name: 'A', weekStart: week })
    db.update(shiftTemplates).set({ start: 450 }).where(eq(shiftTemplates.shortLabel, 'F1')).run()
    applyWeekTemplate(db, admin, 1, template.id, next)
    expect(loadEntries(db, { employeeId: anna, from: next, to: '2026-10-14' }).map(e => [e.kind, e.shortLabel, e.start]))
      .toEqual([['special', null, 420], ['special', null, 420], ['shift', 'M', 465]])
  })
})

describe('template names in the plan and the preview', () => {
  it('marks the saved and the filled week with the template name, follows renames and forgets deleted templates', () => {
    const db = createTestDb()
    const admin = addUser(db, 'leitung', 'admin')
    const anna = addEmployee(db, 'Anna')
    applyToCells(db, admin, 1, [{ employeeId: anna, date: week }], 'replace', { kind: 'shift', templateId: templateId(db, 'F1') })
    const template = saveWeekTemplate(db, 1, { name: 'Woche A', weekStart: week })
    applyWeekTemplate(db, admin, 1, template.id, next)
    const names = () => Object.fromEntries(weekTemplateNames(db, 1, '2026-09-28', '2026-10-31'))
    expect(names()).toEqual({ [week]: { 0: 'Woche A' }, [next]: { 0: 'Woche A' } })
    expect(getMonthPlan(db, admin, 1, 2026, 10, '2026-10-01').admin!.weeks.map(w => w.templateName))
      .toEqual([null, 'Woche A', 'Woche A', null, null])
    renameWeekTemplate(db, 1, template.id, 'Frühjahr')
    expect(names()[next]).toEqual({ 0: 'Frühjahr' })
    deleteWeekTemplate(db, 1, template.id)
    expect(names()).toEqual({})
  })
  it('shows a shift whose service changed since saving by its saved times instead of the short label', () => {
    const db = createTestDb()
    const admin = addUser(db, 'leitung', 'admin')
    const anna = addEmployee(db, 'Anna')
    applyToCells(db, admin, 1, [{ employeeId: anna, date: week }], 'replace', { kind: 'shift', templateId: templateId(db, 'S') })
    applyToCells(db, admin, 1, [{ employeeId: anna, date: '2026-10-06' }], 'replace', { kind: 'shift', templateId: templateId(db, 'F1') })
    expect(saveWeekTemplate(db, 1, { name: 'A', weekStart: week }).rows[0]!.days.slice(0, 2)).toEqual(['S', 'F1'])
    db.update(shiftTemplates).set({ start: 450 }).where(eq(shiftTemplates.shortLabel, 'F1')).run()
    const [changed] = listWeekTemplates(db, 1)
    expect(changed!.rows[0]!.days.slice(0, 2)).toEqual(['S', '7:00–13:15'])
  })
})

describe('week templates per group', () => {
  let db: Db
  let admin: SessionUser
  let maeuse: number
  let baeren: number
  /** Mäuse: Anna and Berta; Bären: Carl; Springer: Sven; Kim helps out from the Hort. */
  let anna: number
  let berta: number
  let carl: number
  let sven: number
  let kim: number
  let krippe: number
  let leitungKrippe: SessionUser
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    maeuse = addGroup(db, 1, 'Mäuse')
    baeren = addGroup(db, 1, 'Bären')
    anna = addEmployee(db, 'Anna', { groupId: maeuse })
    berta = addEmployee(db, 'Berta', { groupId: maeuse })
    carl = addEmployee(db, 'Carl', { groupId: baeren })
    sven = addEmployee(db, 'Sven')
    const hort = addFacility(db, 'Hort')
    kim = addEmployee(db, 'Kim', { facilityId: hort })
    addHelpOut(db, kim, 1, 2026, 10)
    krippe = addFacility(db, 'Krippe')
    leitungKrippe = addUser(db, 'krippe', 'admin', null, krippe)
    addHelpOut(db, berta, krippe, 2026, 10)
  })
  const shift = (employeeId: number, date: string, label: string, groupId: number | null = null) =>
    applyToCells(db, admin, 1, [{ employeeId, date }], 'replace', { kind: 'shift', templateId: templateId(db, label), groupId })
  const labels = (employeeId: number, date: string) =>
    loadEntries(db, { employeeId, from: date, to: date }).map(e => e.shortLabel ?? e.label)
  const rowsOf = (employeeId: number, date: string) => db.select().from(entries).all()
    .filter(entry => entry.employeeId === employeeId && entry.date === date)
  /** A Mäuse week with duties of the other group, the Springer and the helper around it. */
  const fillWeek = () => {
    shift(anna, '2026-10-05', 'F1')
    shift(anna, '2026-10-06', 'M')
    applyToCells(db, admin, 1, [{ employeeId: anna, date: '2026-10-06' }], 'add', { kind: 'break', start: 900, end: 915 })
    shift(anna, '2026-10-07', 'F1', baeren) // counts for the Bären: stays out
    shift(berta, '2026-10-05', 'S')
    shift(berta, '2026-10-06', 'S', maeuse) // the home group named explicitly
    shift(carl, '2026-10-05', 'M', maeuse) // counts for the Mäuse, but Carl is no member
    shift(sven, '2026-10-05', 'F1', maeuse) // Springer
    shift(kim, '2026-10-05', 'F1', maeuse) // helper
  }

  it('saves only the duties of the group\'s current members that count for the group', () => {
    fillWeek()
    const template = saveWeekTemplate(db, 1, { name: 'Mäuse A', weekStart: week, groupId: maeuse })
    expect(template.groupId).toBe(maeuse)
    expect(template.rows).toEqual([
      { employeeId: anna, name: 'Anna', days: ['F1', 'M + [15:00–15:15]', '', '', ''] },
      { employeeId: berta, name: 'Berta', days: ['S', 'S', '', '', ''] },
    ])
    expect(listWeekTemplates(db, 1).map(t => [t.name, t.groupId])).toEqual([['Mäuse A', maeuse]])
    expect(errorCode(() => saveWeekTemplate(db, 1, { name: 'Bären A', weekStart: next, groupId: baeren }))).toBe('empty_week')
  })

  it('fills only empty days of the group\'s current members and leaves everyone else alone', () => {
    fillWeek()
    const template = saveWeekTemplate(db, 1, { name: 'Mäuse A', weekStart: week, groupId: maeuse })
    applyToCells(db, admin, 1, [{ employeeId: anna, date: '2026-10-12' }], 'replace', { kind: 'code', codeId: codeId(db, 'sick') })
    // Berta helps out in the Krippe on Tuesday: that day belongs to the Krippe's plan.
    applyToCells(db, leitungKrippe, krippe, [{ employeeId: berta, date: '2026-10-13' }], 'replace',
      { kind: 'shift', templateId: templateId(db, 'F1', krippe) })
    const helpOutDay = rowsOf(berta, '2026-10-13')

    expect(applyWeekTemplate(db, admin, 1, template.id, next)).toEqual({ filled: 2, skipped: 2 })
    expect(labels(anna, '2026-10-12')).toEqual(['Krank'])
    expect(labels(anna, '2026-10-13')).toEqual(['M', '[15:00–15:15]'])
    expect(labels(berta, '2026-10-12')).toEqual(['S'])
    expect(rowsOf(berta, '2026-10-13')).toEqual(helpOutDay)
    for (const other of [carl, sven, kim]) expect(loadEntries(db, { employeeId: other, from: next, to: '2026-10-16' })).toEqual([])
    expect(loadEntries(db, { homeFacilityId: 1, from: next, to: '2026-10-16' }).every(entry => entry.groupId === null)).toBe(true)

    // Berta moved to the Bären since: the Mäuse template no longer fills her days.
    updateEmployee(db, 1, berta, { name: 'Berta', shortName: 'Be', leftOn: null, groupId: baeren })
    expect(applyWeekTemplate(db, admin, 1, template.id, '2026-10-19')).toEqual({ filled: 2, skipped: 2 })
    expect(loadEntries(db, { employeeId: berta, from: '2026-10-19', to: '2026-10-23' })).toEqual([])
  })

  it('keeps facility templates as they were: everything of the own staff, marked for the whole facility', () => {
    fillWeek()
    const template = saveWeekTemplate(db, 1, { name: 'Haus', weekStart: week })
    expect(template.groupId).toBeNull()
    expect(template.rows.map(row => row.name)).toEqual(['Anna', 'Berta', 'Carl', 'Sven'])
    expect(template.rows[0]!.days).toEqual(['F1', 'M + [15:00–15:15]', 'F1', '', ''])
    expect(db.select().from(weekTemplateEntries).all()).toHaveLength(8)
    expect(applyWeekTemplate(db, admin, 1, template.id, next)).toEqual({ filled: 7, skipped: 0 })
    expect(Object.fromEntries(weekTemplateNames(db, 1, week, next))).toEqual({ [week]: { 0: 'Haus' }, [next]: { 0: 'Haus' } })
  })

  it('shows the names of the facility template and of each group\'s template in the week', () => {
    fillWeek()
    shift(carl, '2026-10-06', 'S')
    saveWeekTemplate(db, 1, { name: 'Haus', weekStart: week })
    const mice = saveWeekTemplate(db, 1, { name: 'Mäuse A', weekStart: week, groupId: maeuse })
    const bears = saveWeekTemplate(db, 1, { name: 'Bären A', weekStart: week, groupId: baeren })
    expect(bears.rows).toEqual([{ employeeId: carl, name: 'Carl', days: ['', 'S', '', '', ''] }])
    applyWeekTemplate(db, admin, 1, mice.id, next)
    expect(Object.fromEntries(weekTemplateNames(db, 1, week, next))).toEqual({
      [week]: { 0: 'Haus', [maeuse]: 'Mäuse A', [baeren]: 'Bären A' },
      [next]: { [maeuse]: 'Mäuse A' },
    })
    const weeks = getMonthPlan(db, admin, 1, 2026, 10, '2026-10-01').admin!.weeks
    expect(weeks.map(w => [w.templateName, w.templateNames])).toEqual([
      [null, {}],
      ['Haus', { 0: 'Haus', [maeuse]: 'Mäuse A', [baeren]: 'Bären A' }],
      [null, { [maeuse]: 'Mäuse A' }],
      [null, {}],
      [null, {}],
    ])
  })

  it('refuses a group of another facility and a name another template already uses', () => {
    fillWeek()
    shift(carl, '2026-10-06', 'S')
    const foxes = addGroup(db, krippe, 'Füchse')
    expect(errorCode(() => saveWeekTemplate(db, 1, { name: 'X', weekStart: week, groupId: foxes }))).toBe('group_not_found')
    const house = saveWeekTemplate(db, 1, { name: 'Woche A', weekStart: week })
    expect(errorCode(() => saveWeekTemplate(db, 1, { name: 'Woche A', weekStart: week, groupId: maeuse }))).toBe('name_taken')
    const mice = saveWeekTemplate(db, 1, { name: 'Mäuse A', weekStart: week, groupId: maeuse })
    expect(errorCode(() => saveWeekTemplate(db, 1, { name: 'Mäuse A', weekStart: week, groupId: baeren }))).toBe('name_taken')
    expect(errorCode(() => saveWeekTemplate(db, 1, { name: 'Mäuse A', weekStart: week }))).toBe('name_taken')
    expect(saveWeekTemplate(db, 1, { name: 'Mäuse A', weekStart: week, groupId: maeuse }).id).toBe(mice.id)
    expect(saveWeekTemplate(db, 1, { name: 'Woche A', weekStart: week, groupId: null }).id).toBe(house.id)
    expect(listWeekTemplates(db, 1).map(t => [t.name, t.groupId])).toEqual([['Mäuse A', maeuse], ['Woche A', null]])
    expect(db.select().from(weekTemplateEntries).all().filter(row => row.weekTemplateId === mice.id)).toHaveLength(5)
  })
})
