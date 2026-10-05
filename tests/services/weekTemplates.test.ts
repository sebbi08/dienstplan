import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type { Db } from '../../server/db/client'
import { changeLog, shiftTemplates } from '../../server/db/schema'
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
import { addEmployee, addUser, codeId, createTestDb, errorCode, templateId } from '../helpers/fixtures'

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
    applyToCells(db, admin, [{ employeeId, date }], 'replace', { kind: 'shift', templateId: templateId(db, label) })
  const code = (employeeId: number, date: string, key: string, start?: number, end?: number) =>
    applyToCells(db, admin, [{ employeeId, date }], 'replace', { kind: 'code', codeId: codeId(db, key), start, end })
  const cell = (employeeId: number, date: string) => loadEntries(db, { employeeId, from: date, to: date }).map(e => e.label)

  it('saves the working entries of Monday to Friday and leaves one-off absences out', () => {
    shift(anna, '2026-10-05', 'F1')
    shift(anna, '2026-10-06', 'M')
    applyToCells(db, admin, [{ employeeId: anna, date: '2026-10-06' }], 'add', { kind: 'break', start: 900, end: 915 })
    code(anna, '2026-10-07', 'vacation')
    code(berta, '2026-10-05', 'prep_time', 450, 570)
    shift(berta, '2026-10-05', 'S')
    shift(berta, '2026-10-10', 'S') // Saturday: not part of a template
    const template = saveWeekTemplate(db, { name: ' Woche A ', weekStart: week })
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
    const template = saveWeekTemplate(db, { name: 'Woche A', weekStart: week })

    code(anna, '2026-10-12', 'sick') // already filled: stays
    createClosure(db, admin, { startDate: '2026-10-13', endDate: '2026-10-13', label: 'Konzeptionstag', mode: 'closure_day' })
    addHours(db, berta, { weeklyMinutes: 1200, validFrom: '2026-10-12', workdays: 0b00111 }) // Berta: Mo–Mi from now on
    const result = applyWeekTemplate(db, admin, template.id, next)

    expect(cell(anna, '2026-10-12')).toEqual(['Krank'])
    expect(cell(anna, '2026-10-13')).toEqual(['Schließtag'])
    expect(cell(anna, '2026-10-14')).toEqual(['7:00–13:15'])
    expect(cell(berta, '2026-10-12')).toEqual(['8:45–17:00'])
    expect(cell(berta, '2026-10-15')).toEqual([]) // Thursday is now her day off
    expect(result).toEqual({ filled: 2, skipped: 3 })

    updateEmployee(db, anna, { name: 'Anna', shortName: 'An', leftOn: '2026-10-16' })
    expect(applyWeekTemplate(db, admin, template.id, '2026-10-19')).toEqual({ filled: 1, skipped: 4 }) // only Berta's Monday
  })

  it('keeps changed times and breaks exactly and logs changes in a released month', () => {
    shift(anna, '2026-10-05', 'M')
    const [entry] = loadEntries(db, { employeeId: anna, from: '2026-10-05', to: '2026-10-05' })
    applyToCells(db, admin, [{ employeeId: anna, date: '2026-10-05' }], 'add', { kind: 'break', start: 900, end: 910 })
    const template = saveWeekTemplate(db, { name: 'Woche A', weekStart: week })
    releaseMonth(db, admin, 2026, 10)
    const before = db.select().from(changeLog).all().length
    applyWeekTemplate(db, admin, template.id, '2026-10-19')
    const copied = loadEntries(db, { employeeId: anna, from: '2026-10-19', to: '2026-10-19' })
    expect(copied.map(e => [e.kind, e.templateId, e.start, e.end, e.breakStart, e.breakEnd]))
      .toEqual([[entry!.kind, entry!.templateId, entry!.start, entry!.end, entry!.breakStart, entry!.breakEnd], ['break', null, 900, 910, null, null]])
    expect(db.select().from(changeLog).all().length).toBe(before + 1)
  })

  it('replaces a template saved again under the same name, renames and deletes', () => {
    shift(anna, '2026-10-05', 'F1')
    const first = saveWeekTemplate(db, { name: 'Woche A', weekStart: week })
    shift(anna, '2026-10-12', 'S')
    const second = saveWeekTemplate(db, { name: 'Woche A', weekStart: next })
    expect(second.id).toBe(first.id)
    expect(listWeekTemplates(db).map(t => [t.name, t.rows[0]!.days[0]])).toEqual([['Woche A', 'S']])

    shift(berta, '2026-10-05', 'M')
    const other = saveWeekTemplate(db, { name: 'Woche B', weekStart: week })
    expect(errorCode(() => renameWeekTemplate(db, other.id, 'Woche A'))).toBe('name_taken')
    renameWeekTemplate(db, other.id, 'Frühjahr')
    expect(listWeekTemplates(db).map(t => t.name)).toEqual(['Frühjahr', 'Woche A'])
    deleteWeekTemplate(db, first.id)
    expect(listWeekTemplates(db).map(t => t.name)).toEqual(['Frühjahr'])
  })

  it('validates its input', () => {
    expect(errorCode(() => saveWeekTemplate(db, { name: 'Leer', weekStart: week }))).toBe('empty_week')
    shift(anna, '2026-10-05', 'F1')
    expect(errorCode(() => saveWeekTemplate(db, { name: ' ', weekStart: week }))).toBe('name_required')
    expect(errorCode(() => saveWeekTemplate(db, { name: 'A', weekStart: '2026-10-06' }))).toBe('not_a_monday')
    const template = saveWeekTemplate(db, { name: 'A', weekStart: week })
    expect(errorCode(() => applyWeekTemplate(db, admin, template.id, '2026-10-06'))).toBe('not_a_monday')
    expect(errorCode(() => applyWeekTemplate(db, admin, 999, next))).toBe('week_template_not_found')
    expect(errorCode(() => deleteWeekTemplate(db, 999))).toBe('week_template_not_found')
  })
})

describe('week templates and changed services', () => {
  it('inserts a shift whose service changed since saving as a special shift with the saved times', () => {
    const db = createTestDb()
    const admin = addUser(db, 'leitung', 'admin')
    const anna = addEmployee(db, 'Anna')
    applyToCells(db, admin, [{ employeeId: anna, date: week }, { employeeId: anna, date: '2026-10-06' }], 'replace', { kind: 'shift', templateId: templateId(db, 'F1') })
    applyToCells(db, admin, [{ employeeId: anna, date: '2026-10-07' }], 'replace', { kind: 'shift', templateId: templateId(db, 'M') })
    const template = saveWeekTemplate(db, { name: 'A', weekStart: week })
    db.update(shiftTemplates).set({ start: 450 }).where(eq(shiftTemplates.shortLabel, 'F1')).run()
    applyWeekTemplate(db, admin, template.id, next)
    expect(loadEntries(db, { employeeId: anna, from: next, to: '2026-10-14' }).map(e => [e.kind, e.shortLabel, e.start]))
      .toEqual([['special', null, 420], ['special', null, 420], ['shift', 'M', 465]])
  })
})

describe('template names in the plan and the legend', () => {
  it('marks the saved and the filled week with the template name, follows renames and forgets deleted templates', () => {
    const db = createTestDb()
    const admin = addUser(db, 'leitung', 'admin')
    const anna = addEmployee(db, 'Anna')
    applyToCells(db, admin, [{ employeeId: anna, date: week }], 'replace', { kind: 'shift', templateId: templateId(db, 'F1') })
    const template = saveWeekTemplate(db, { name: 'Woche A', weekStart: week })
    applyWeekTemplate(db, admin, template.id, next)
    const names = () => Object.fromEntries(weekTemplateNames(db, '2026-09-28', '2026-10-31'))
    expect(names()).toEqual({ [week]: 'Woche A', [next]: 'Woche A' })
    expect(getMonthPlan(db, admin, 2026, 10, '2026-10-01').admin!.weeks.map(w => w.templateName))
      .toEqual([null, 'Woche A', 'Woche A', null, null])
    renameWeekTemplate(db, template.id, 'Frühjahr')
    expect(names()[next]).toBe('Frühjahr')
    deleteWeekTemplate(db, template.id)
    expect(names()).toEqual({})
  })
  it('lists the services used with their times and shows changed services by their saved times', () => {
    const db = createTestDb()
    const admin = addUser(db, 'leitung', 'admin')
    const anna = addEmployee(db, 'Anna')
    applyToCells(db, admin, [{ employeeId: anna, date: week }], 'replace', { kind: 'shift', templateId: templateId(db, 'S') })
    applyToCells(db, admin, [{ employeeId: anna, date: '2026-10-06' }], 'replace', { kind: 'shift', templateId: templateId(db, 'F1') })
    const template = saveWeekTemplate(db, { name: 'A', weekStart: week })
    expect(template.legend).toEqual([
      { shortLabel: 'F1', label: 'Frühdienst', start: 420, end: 795, breakStart: null, breakEnd: null },
      { shortLabel: 'S', label: 'Spätdienst', start: 525, end: 1020, breakStart: 730, breakEnd: 760 },
    ])
    db.update(shiftTemplates).set({ start: 450 }).where(eq(shiftTemplates.shortLabel, 'F1')).run()
    const [changed] = listWeekTemplates(db)
    expect(changed!.rows[0]!.days.slice(0, 2)).toEqual(['S', '7:00–13:15'])
    expect(changed!.legend.map(item => item.shortLabel)).toEqual(['S'])
  })
})
