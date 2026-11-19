import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type { Db } from '../../server/db/client'
import { shiftTemplates, weekTemplateEntries, weekTemplates } from '../../server/db/schema'
import { ServiceError } from '../../server/lib/errors'
import { loadEntries } from '../../server/services/queries'
import {
  applyWeekTemplate, createWeekTemplate, getWeekTemplate, listWeekTemplates, replaceWeekTemplate, saveWeekTemplate,
  weekTemplateNames, weekTemplateStaff,
} from '../../server/services/weekTemplates'
import type { SessionUser, WeekTemplateEntryInput } from '../../shared/types/api'
import { templateEntryInputs } from '../../app/utils/weekTemplateEditor'
import {
  addEmployee, addFacility, addGroup, addHelpOut, addUser, codeId, createTestDb, errorCode, templateId,
} from '../helpers/fixtures'

// 2026-10-05 is a Monday.
const week = '2026-10-05'

/** The ServiceError fn throws (code and details), or null. */
function refusal(fn: () => unknown): { code: string; details?: Record<string, unknown> } | null {
  try {
    fn()
    return null
  }
  catch (error) {
    if (error instanceof ServiceError) return { code: error.code, details: error.details }
    throw error
  }
}

describe('week templates written in the editor', () => {
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
  const shift = (employeeId: number, weekday: number, label: string, extra: Partial<WeekTemplateEntryInput> = {}): WeekTemplateEntryInput =>
    ({ employeeId, weekday, kind: 'shift', templateId: templateId(db, label), ...extra })
  const code = (employeeId: number, weekday: number, key: string, start?: number, end?: number, extra: Partial<WeekTemplateEntryInput> = {}): WeekTemplateEntryInput =>
    ({ employeeId, weekday, kind: 'code', codeId: codeId(db, key), start, end, ...extra })
  const pause = (employeeId: number, weekday: number, start: number, end: number): WeekTemplateEntryInput =>
    ({ employeeId, weekday, kind: 'break', start, end })
  const create = (entries: WeekTemplateEntryInput[], name = 'Woche A', groupId: number | null = null) =>
    createWeekTemplate(db, 1, { name, groupId, entries })
  const rowsOf = (id: number) => db.select().from(weekTemplateEntries).where(eq(weekTemplateEntries.weekTemplateId, id)).all()

  it('creates a template from explicit entries, previews it like a saved week and shows its entries like plan chips', () => {
    const template = create([
      shift(anna, 0, 'F1'),
      shift(anna, 1, 'M', { homeOffice: true }),
      pause(anna, 1, 900, 915),
      code(anna, 2, 'office'), // a whole Büro day
      { employeeId: berta, weekday: 0, kind: 'special', start: 480, end: 720, note: ' Ausflug ' },
      code(berta, 0, 'prep_time', 480, 540), // VZ may lie inside a duty
      shift(berta, 4, 'S'),
    ], ' Woche A ')
    expect(template.name).toBe('Woche A')
    expect(template.groupId).toBeNull()
    expect(template.entries.map(e => [e.employeeId, e.weekday, e.kind, e.label, e.shortLabel, e.color, e.homeOffice, e.note])).toEqual([
      [anna, 0, 'shift', '7:00–13:15', 'F1', 'neutral', false, null],
      [berta, 0, 'special', '8:00–12:00', null, 'neutral', false, 'Ausflug'],
      [berta, 0, 'code', 'VZ 8:00–9:00', null, 'green', false, null],
      [anna, 1, 'shift', '7:45–16:00', 'M', 'neutral', true, null],
      [anna, 1, 'break', '[15:00–15:15]', null, 'red', false, null],
      [anna, 2, 'code', 'Büro (ganzer Tag)', null, 'yellow', false, null],
      [berta, 4, 'shift', '8:45–17:00', 'S', 'neutral', false, null],
    ])
    expect(template.entries.every(e => e.date === '' && e.groupId === null && e.helpFacilityId === null)).toBe(true)
    expect(listWeekTemplates(db, 1)).toEqual([{
      id: template.id, name: 'Woche A', groupId: null, updatedAt: template.updatedAt,
      rows: [
        { employeeId: anna, name: 'Anna', days: ['F1', 'M (Homeoffice) + [15:00–15:15]', 'Büro (ganzer Tag)', '', '', '', ''] },
        { employeeId: berta, name: 'Berta', days: ['8:00–12:00 + VZ 8:00–9:00', '', '', '', 'S', '', ''] },
      ],
    }])
    expect(getWeekTemplate(db, 1, template.id)).toEqual(template)
  })

  it('applies a template made in the editor like one saved from the plan', () => {
    const made = create([
      shift(anna, 0, 'F1'), shift(anna, 1, 'M', { homeOffice: true }), pause(anna, 1, 900, 915), code(anna, 2, 'office'),
      code(berta, 0, 'prep_time', 480, 540), shift(berta, 0, 'S'),
    ])
    expect(applyWeekTemplate(db, admin, 1, made.id, week)).toEqual({ filled: 4, skipped: 0, infosKept: [] })
    const cell = (employeeId: number, date: string) => loadEntries(db, { employeeId, from: date, to: date })
      .map(e => [e.kind, e.shortLabel ?? e.label, e.homeOffice])
    expect(cell(anna, '2026-10-05')).toEqual([['shift', 'F1', false]])
    expect(cell(anna, '2026-10-06')).toEqual([['shift', 'M', true], ['break', '[15:00–15:15]', false]])
    expect(cell(anna, '2026-10-07')).toEqual([['code', 'Büro (ganzer Tag)', false]])
    expect(cell(berta, '2026-10-05')).toEqual([['code', 'VZ 8:00–9:00', false], ['shift', 'S', false]])
    // Saving the filled week again gives the same template.
    const saved = saveWeekTemplate(db, 1, { name: 'Woche B', weekStart: week })
    expect(saved.rows).toEqual(listWeekTemplates(db, 1).find(t => t.id === made.id)!.rows)
    expect(Object.fromEntries(weekTemplateNames(db, 1, week, week))).toEqual({ [week]: { 0: 'Woche B' } })
  })

  it('replaces name, scope and entries of a template and keeps its id and its marks', () => {
    const template = create([shift(anna, 0, 'F1')])
    applyWeekTemplate(db, admin, 1, template.id, week)
    const changed = replaceWeekTemplate(db, 1, template.id, { name: 'Frühjahr', groupId: null, entries: [shift(berta, 3, 'S')] },
      new Date('2026-11-18T10:00:00Z'))
    expect(changed.id).toBe(template.id)
    expect(changed.name).toBe('Frühjahr')
    expect(changed.updatedAt).toBe('2026-11-18T10:00:00.000Z')
    expect(changed.entries.map(e => [e.employeeId, e.weekday, e.shortLabel])).toEqual([[berta, 3, 'S']])
    expect(rowsOf(template.id)).toHaveLength(1)
    expect(Object.fromEntries(weekTemplateNames(db, 1, week, week))).toEqual({ [week]: { 0: 'Frühjahr' } })
    // The own name may stay; another template's name may not be taken.
    expect(replaceWeekTemplate(db, 1, template.id, { name: 'Frühjahr', groupId: null, entries: [shift(anna, 0, 'M')] }).name).toBe('Frühjahr')
    create([shift(anna, 0, 'F1')], 'Herbst')
    expect(errorCode(() => replaceWeekTemplate(db, 1, template.id, { name: 'Herbst', groupId: null, entries: [shift(anna, 0, 'M')] })))
      .toBe('name_taken')
    expect(errorCode(() => replaceWeekTemplate(db, 1, 999, { name: 'X', groupId: null, entries: [shift(anna, 0, 'M')] })))
      .toBe('week_template_not_found')
  })

  it('refuses one-off entries: only shifts, special shifts, breaks, VZ and Büro', () => {
    for (const key of ['vacation', 'sick', 'training', 'school', 'closure_day', 'holiday', 'overtime_off', 'other']) {
      expect(errorCode(() => create([code(anna, 0, key)])), key).toBe('template_entry_not_allowed')
    }
    expect(db.select().from(weekTemplates).all()).toEqual([])
  })

  it('refuses employees of other facilities and helpers', () => {
    const hort = addFacility(db, 'Hort')
    const kim = addEmployee(db, 'Kim', { facilityId: hort })
    addHelpOut(db, kim, 1, 2026, 10)
    expect(refusal(() => create([shift(kim, 0, 'F1')]))).toEqual({ code: 'employee_not_found', details: undefined })
    expect(errorCode(() => create([shift(9999, 0, 'F1')]))).toBe('employee_not_found')
    // The other facility's template is not found from here.
    const theirs = createWeekTemplate(db, hort, { name: 'Hort A', groupId: null, entries: [shift(kim, 0, 'F1', { templateId: templateId(db, 'F1', hort) })] })
    expect(errorCode(() => getWeekTemplate(db, 1, theirs.id))).toBe('week_template_not_found')
    expect(errorCode(() => replaceWeekTemplate(db, 1, theirs.id, { name: 'X', groupId: null, entries: [shift(anna, 0, 'F1')] })))
      .toBe('week_template_not_found')
    // Another facility's service (Dienst) is no service here.
    expect(errorCode(() => create([shift(anna, 0, 'F1', { templateId: templateId(db, 'F1', hort) })]))).toBe('template_not_found')
  })

  it('names the refused cell when entries overlap or a break lies outside the duty', () => {
    expect(refusal(() => create([shift(anna, 0, 'F1'), shift(berta, 2, 'F1'), shift(berta, 2, 'S')])))
      .toEqual({ code: 'entries_overlap', details: { employeeId: berta, weekday: 2, name: 'Berta' } })
    // A whole Büro day stands alone.
    expect(refusal(() => create([code(anna, 1, 'office'), shift(anna, 1, 'F1')])))
      .toEqual({ code: 'entries_overlap', details: { employeeId: anna, weekday: 1, name: 'Anna' } })
    expect(refusal(() => create([code(anna, 1, 'office'), code(anna, 1, 'prep_time', 480, 540)]))?.code).toBe('entries_overlap')
    // A break next to a whole Büro day has no duty to lie in.
    expect(refusal(() => create([code(anna, 1, 'office'), pause(anna, 1, 600, 615)]))?.code).toBe('break_outside_work')
    expect(refusal(() => create([shift(anna, 3, 'F1'), pause(anna, 3, 800, 830)])))
      .toEqual({ code: 'break_outside_work', details: { employeeId: anna, weekday: 3, name: 'Anna' } })
    expect(refusal(() => create([pause(anna, 0, 600, 615)]))?.code).toBe('break_outside_work')
    // M has its break 11:40–12:10.
    expect(refusal(() => create([shift(anna, 0, 'M'), pause(anna, 0, 720, 750)]))?.code).toBe('break_overlap')
    // Two duties without overlap, VZ inside a duty and a break inside: fine.
    expect(create([
      { employeeId: anna, weekday: 0, kind: 'special', start: 420, end: 600 }, shift(anna, 0, 'HK'),
      code(anna, 0, 'office', 450, 500), pause(anna, 0, 700, 720),
    ]).entries).toHaveLength(4)
    expect(db.select().from(weekTemplates).all()).toHaveLength(1)
  })

  it('takes Saturday and Sunday', () => {
    const template = create([shift(anna, 5, 'F1'), shift(anna, 6, 'S')])
    expect(template.entries.map(e => e.weekday)).toEqual([5, 6])
    expect(listWeekTemplates(db, 1)[0]!.rows).toEqual([{ employeeId: anna, name: 'Anna', days: ['', '', '', '', '', 'F1', 'S'] }])
  })

  it('validates names, weekdays, times and the home-office mark', () => {
    expect(errorCode(() => create([shift(anna, 0, 'F1')], ' '))).toBe('name_required')
    expect(errorCode(() => create([]))).toBe('template_empty')
    expect(errorCode(() => create([shift(anna, 7, 'F1')]))).toBe('invalid_weekday')
    expect(errorCode(() => create([shift(anna, -1, 'F1')]))).toBe('invalid_weekday')
    expect(errorCode(() => create([{ employeeId: anna, weekday: 0, kind: 'special' }]))).toBe('times_required')
    expect(errorCode(() => create([{ employeeId: anna, weekday: 0, kind: 'special', start: 481, end: 600 }]))).toBe('span_not_on_grid')
    expect(errorCode(() => create([{ employeeId: anna, weekday: 0, kind: 'special', start: 600, end: 480 }]))).toBe('span_end_before_start')
    expect(errorCode(() => create([shift(anna, 0, 'F1'), { ...pause(anna, 0, 600, 615), homeOffice: true }]))).toBe('home_office_not_allowed')
    expect(errorCode(() => create([code(anna, 0, 'office', 480)]))).toBe('span_incomplete')
    create([shift(anna, 0, 'F1')])
    expect(errorCode(() => create([shift(berta, 0, 'F1')]))).toBe('name_taken')
    expect(errorCode(() => create([shift(berta, 0, 'F1')], 'Woche A', null))).toBe('name_taken')
    expect(listWeekTemplates(db, 1)).toHaveLength(1)
  })

  it('changes nothing when a replacement is refused', () => {
    const template = create([shift(anna, 0, 'F1')])
    expect(errorCode(() => replaceWeekTemplate(db, 1, template.id, {
      name: 'Neu', groupId: null, entries: [shift(anna, 1, 'F1'), code(anna, 2, 'vacation')],
    }))).toBe('template_entry_not_allowed')
    expect(getWeekTemplate(db, 1, template.id)).toEqual(template)
  })

  it('shows a shift whose service changed since as a special shift with the saved times, as filling a week does', () => {
    const template = create([shift(anna, 0, 'F1'), shift(anna, 1, 'S')])
    db.update(shiftTemplates).set({ start: 450 }).where(eq(shiftTemplates.shortLabel, 'F1')).run()
    expect(getWeekTemplate(db, 1, template.id).entries.map(e => [e.kind, e.templateId, e.shortLabel, e.label])).toEqual([
      ['special', null, null, '7:00–13:15'],
      ['shift', templateId(db, 'S'), 'S', '8:45–17:00'],
    ])
  })

  it('keeps whether each entry counts as staff when the editor opens and saves the template', () => {
    const template = create([shift(anna, 0, 'HK'), shift(anna, 1, 'F1'), { employeeId: berta, weekday: 0, kind: 'special', start: 480, end: 720 }])
    // HK (not counting as staff) got other times: it opens as a special shift that still does not count.
    db.update(shiftTemplates).set({ start: 690 }).where(eq(shiftTemplates.shortLabel, 'HK')).run()
    // F1 keeps its times but no longer counts as staff: the saved F1 duty still does.
    db.update(shiftTemplates).set({ countsAsStaff: false }).where(eq(shiftTemplates.shortLabel, 'F1')).run()
    const opened = getWeekTemplate(db, 1, template.id)
    expect(opened.entries.map(e => [e.kind, e.countsAsStaff, e.color])).toEqual([
      ['special', true, 'neutral'], ['special', false, 'violet'], ['shift', true, 'neutral'],
    ])
    // Edit something else (a duty for Berta on Friday) and save what the editor sends.
    const inputs = [...templateEntryInputs(opened.entries, new Set([anna, berta])), shift(berta, 4, 'S')]
    replaceWeekTemplate(db, 1, template.id, { name: opened.name, groupId: null, entries: inputs })
    const stored = rowsOf(template.id).map(row => [row.employeeId, row.weekday, row.kind, row.start, row.countsAsStaff])
    expect(stored).toEqual([
      [berta, 0, 'special', 480, true],
      [anna, 0, 'special', 660, false],
      [anna, 1, 'shift', 420, true],
      [berta, 4, 'shift', 525, true],
    ])
  })

  it('takes the counts-as-staff mark only for shifts and special shifts', () => {
    const template = create([
      { employeeId: anna, weekday: 0, kind: 'special', start: 480, end: 720, countsAsStaff: false },
      shift(anna, 1, 'HK', { countsAsStaff: true }),
      shift(anna, 2, 'F1'), { ...pause(anna, 2, 600, 615), countsAsStaff: true },
      code(anna, 3, 'office', 480, 600, { countsAsStaff: false }),
    ])
    expect(rowsOf(template.id).map(row => [row.kind, row.countsAsStaff])).toEqual([
      ['special', false], ['shift', true], ['shift', true], ['break', false], ['code', true],
    ])
  })

  it('names everyone who has entries in the template, also people who left or belong elsewhere', () => {
    const clara = addEmployee(db, 'Clara', { leftOn: '2026-10-31' })
    const template = create([shift(anna, 0, 'F1'), shift(clara, 1, 'F1')])
    expect(getWeekTemplate(db, 1, template.id).people).toEqual([{ id: anna, name: 'Anna' }, { id: clara, name: 'Clara' }])
  })

  it('lists the staff that can be planned: the facility\'s own employees who have not left, with their contract', () => {
    addEmployee(db, 'Clara', { leftOn: '2026-10-31' })
    addEmployee(db, 'Dora', { weeklyHours: 30, validFrom: '2026-12-01' })
    const hort = addFacility(db, 'Hort')
    addEmployee(db, 'Kim', { facilityId: hort })
    expect(weekTemplateStaff(db, 1, '2026-11-18').map(s => [s.name, s.groupId, s.weeklyMinutes, s.workdays])).toEqual([
      ['Anna', null, 39 * 60, 0b0011111],
      ['Berta', null, 39 * 60, 0b0011111],
      ['Dora', null, 30 * 60, 0b0011111], // starts later: her first contract
    ])
  })
})

describe('week templates written in the editor for a group', () => {
  let db: Db
  let admin: SessionUser
  let maeuse: number
  let baeren: number
  let anna: number
  let carl: number
  let sven: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    maeuse = addGroup(db, 1, 'Mäuse')
    baeren = addGroup(db, 1, 'Bären')
    anna = addEmployee(db, 'Anna', { groupId: maeuse })
    carl = addEmployee(db, 'Carl', { groupId: baeren })
    sven = addEmployee(db, 'Sven') // Springer
  })
  const shift = (employeeId: number, weekday: number): WeekTemplateEntryInput =>
    ({ employeeId, weekday, kind: 'shift', templateId: templateId(db, 'F1') })

  it('takes only the group\'s members and refuses everyone else', () => {
    const template = createWeekTemplate(db, 1, { name: 'Mäuse A', groupId: maeuse, entries: [shift(anna, 0)] })
    expect(template.groupId).toBe(maeuse)
    expect(errorCode(() => createWeekTemplate(db, 1, { name: 'X', groupId: maeuse, entries: [shift(carl, 0)] }))).toBe('employee_not_found')
    expect(errorCode(() => createWeekTemplate(db, 1, { name: 'X', groupId: maeuse, entries: [shift(sven, 0)] }))).toBe('employee_not_found')
    // Switching the scope to the Bären: Anna no longer fits.
    expect(errorCode(() => replaceWeekTemplate(db, 1, template.id, { name: 'Mäuse A', groupId: baeren, entries: [shift(anna, 0)] })))
      .toBe('employee_not_found')
    applyWeekTemplate(db, admin, 1, template.id, week)
    expect(Object.fromEntries(weekTemplateNames(db, 1, week, week))).toEqual({ [week]: { [maeuse]: 'Mäuse A' } })
    const bears = replaceWeekTemplate(db, 1, template.id, { name: 'Bären A', groupId: baeren, entries: [shift(carl, 1)] })
    expect([bears.name, bears.groupId, bears.entries.map(e => e.employeeId)]).toEqual(['Bären A', baeren, [carl]])
    // The week was filled for the Mäuse: its mark goes with the new scope.
    expect(Object.fromEntries(weekTemplateNames(db, 1, week, week))).toEqual({})
    // The whole facility takes everyone, the Springer too.
    expect(replaceWeekTemplate(db, 1, template.id, { name: 'Haus', groupId: null, entries: [shift(anna, 0), shift(carl, 0), shift(sven, 0)] })
      .entries).toHaveLength(3)
  })

  it('refuses a group of another facility', () => {
    const krippe = addFacility(db, 'Krippe')
    const foxes = addGroup(db, krippe, 'Füchse')
    expect(errorCode(() => createWeekTemplate(db, 1, { name: 'X', groupId: foxes, entries: [shift(anna, 0)] }))).toBe('group_not_found')
  })
})
