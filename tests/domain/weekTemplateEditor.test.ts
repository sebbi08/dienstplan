import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CodeDto, TemplateDto, WeekTemplateCoverageDto, WeekTemplateEntryDto, WeekTemplateStaffDto } from '../../shared/types/api'
import { TEMPLATE_WEEKDAYS } from '../../shared/domain/weekTemplates'
import {
  clearTemplateCells, draftTemplateEntry, enterIntoTemplateCells, hiddenTemplateEntries, previewDayCount, removeTemplateEntry, staffInScope,
  templateCoverage, templateDayKind, copyTemplateDay, dayHasEntries, readTemplateCompare, writeTemplateCompare, templateEntryInputs, templateWeekdays, templateWeekdayTarget, templateWeeklyMinutes, type TemplateCell,
  type TemplateEditorContext,
} from '../../app/utils/weekTemplateEditor'

const code = (id: number, key: CodeDto['key'], label: string, creditMode: CodeDto['creditMode'], color: CodeDto['color']): CodeDto =>
  ({ id, key, label, color, creditMode, requiresTimes: creditMode === 'timed', sortOrder: id })
const shift = (id: number, shortLabel: string, start: number, end: number, breakStart: number | null = null, breakEnd: number | null = null,
  countsAsStaff = true): TemplateDto =>
  ({ id, shortLabel, label: shortLabel, start, end, breakStart, breakEnd, countsAsStaff, pairsWithPrepTime: false, homeOffice: false, sortOrder: id })
const context: TemplateEditorContext = {
  templates: [shift(1, 'F1', 420, 795), shift(2, 'M', 465, 960, 700, 730), shift(3, 'HK', 660, 960, null, null, false)],
  codes: [code(10, 'vacation', 'Urlaub', 'daily_target', 'gray'), code(11, 'office', 'Büro', 'timed', 'yellow'), code(12, 'prep_time', 'VZ', 'timed', 'green')],
}
const person = (id: number, name: string, weeklyMinutes: number | null, workdays = 0b0011111, groupId: number | null = null): WeekTemplateStaffDto =>
  ({ id, name, shortName: name.slice(0, 2), groupId, weeklyMinutes, workdays })
const anna = person(1, 'Anna', 39 * 60)
const berta = person(2, 'Berta', 30 * 60, 0b0001111) // Monday to Thursday
const names = new Map([[1, 'Anna'], [2, 'Berta']])

/** Enters into the cells and returns the new entries (fails the test on a refusal). */
function enter(entries: WeekTemplateEntryDto[], cells: TemplateCell[], input: Parameters<typeof enterIntoTemplateCells>[2]) {
  const result = enterIntoTemplateCells(entries, cells, input, context, names)
  if ('error' in result) throw new Error(result.error)
  return result.entries
}
const labels = (entries: WeekTemplateEntryDto[], employeeId: number, weekday: number) =>
  entries.filter(e => e.employeeId === employeeId && e.weekday === weekday).map(e => e.shortLabel ?? e.label)

describe('an entry of the week template editor', () => {
  it('is shown like a plan chip: shift, special shift, break, VZ and a whole Büro day', () => {
    const cell = { employeeId: 1, weekday: 2 }
    expect(draftTemplateEntry({ kind: 'shift', templateId: 2, homeOffice: true }, cell, context, -1)).toMatchObject({
      id: -1, employeeId: 1, weekday: 2, date: '', kind: 'shift', templateId: 2, start: 465, end: 960, breakStart: 700, breakEnd: 730,
      label: '7:45–16:00', shortLabel: 'M', color: 'neutral', countsAsStaff: true, homeOffice: true, creditMode: 'timed', codeKey: null,
      groupId: null, helpFacilityId: null,
    })
    expect(draftTemplateEntry({ kind: 'shift', templateId: 3 }, cell, context, -2)).toMatchObject({ color: 'violet', countsAsStaff: false })
    expect(draftTemplateEntry({ kind: 'special', start: 480, end: 720, note: ' Ausflug ' }, cell, context, -3))
      .toMatchObject({ kind: 'special', label: '8:00–12:00', shortLabel: null, note: 'Ausflug', color: 'neutral' })
    expect(draftTemplateEntry({ kind: 'break', start: 900, end: 915 }, cell, context, -4))
      .toMatchObject({ kind: 'break', label: '[15:00–15:15]', color: 'red', countsAsStaff: false, breakStart: null })
    expect(draftTemplateEntry({ kind: 'code', codeId: 12, start: 480, end: 540 }, cell, context, -5))
      .toMatchObject({ kind: 'code', codeId: 12, codeKey: 'prep_time', creditMode: 'timed', label: 'VZ 8:00–9:00', color: 'green' })
    expect(draftTemplateEntry({ kind: 'code', codeId: 11, homeOffice: true }, cell, context, -6))
      .toMatchObject({ start: null, end: null, label: 'Büro (ganzer Tag)', color: 'yellow', homeOffice: true })
    expect(draftTemplateEntry({ kind: 'shift', templateId: 99 }, cell, context, -7)).toBeNull()
    // A home-office button carries its flag into the draft, as the server resolves it.
    const homeOfficeContext = { ...context, templates: [{ ...shift(4, 'HO', 480, 720), homeOffice: true }] }
    expect(draftTemplateEntry({ kind: 'shift', templateId: 4 }, cell, homeOfficeContext, -8)).toMatchObject({ homeOffice: true })
    expect(draftTemplateEntry({ kind: 'shift', templateId: 4, homeOffice: false }, cell, homeOfficeContext, -9)).toMatchObject({ homeOffice: false })
  })
})

describe('entering into template cells (the plan\'s always-add rule)', () => {
  const monday = { employeeId: 1, weekday: 0 }
  it('adds a second duty next to the first and refuses an overlap naming the cell, changing nothing', () => {
    const entries = enter([], [monday, { employeeId: 2, weekday: 0 }], { kind: 'shift', templateId: 1 })
    expect(labels(enter(entries, [monday], { kind: 'special', start: 840, end: 900 }), 1, 0)).toEqual(['F1', '14:00–15:00'])
    // 13:00–15:00 overlaps F1 (until 13:15) on Monday: refused as a whole, Berta's Tuesday stays empty too.
    const refused = enterIntoTemplateCells(entries, [{ employeeId: 2, weekday: 1 }, monday], { kind: 'special', start: 780, end: 900 }, context, names)
    expect(refused).toEqual({ error: 'entries_overlap', message: expect.stringContaining('Anna, Montag: überschneidet sich') })
  })

  it('keeps both of two duties that do not overlap, and VZ inside a duty', () => {
    let entries = enter([], [monday], { kind: 'shift', templateId: 1 })
    entries = enter(entries, [monday], { kind: 'special', start: 840, end: 960 })
    entries = enter(entries, [monday], { kind: 'code', codeId: 12, start: 450, end: 510 })
    expect(labels(entries, 1, 0)).toEqual(['F1', 'VZ 7:30–8:30', '14:00–16:00'])
  })

  it('lets a whole Büro day replace the cell and a duty replace the whole day', () => {
    let entries = enter([], [monday], { kind: 'shift', templateId: 2 })
    entries = enter(entries, [monday], { kind: 'break', start: 900, end: 915 })
    entries = enter(entries, [monday], { kind: 'code', codeId: 11 })
    expect(labels(entries, 1, 0)).toEqual(['Büro (ganzer Tag)'])
    entries = enter(entries, [monday], { kind: 'shift', templateId: 1 })
    expect(labels(entries, 1, 0)).toEqual(['F1'])
  })

  it('gives the break text for a break next to a whole Büro day', () => {
    const entries = enter([], [monday], { kind: 'code', codeId: 11 })
    expect(enterIntoTemplateCells(entries, [monday], { kind: 'break', start: 600, end: 615 }, context, names))
      .toMatchObject({ error: 'break_outside_work', message: expect.stringMatching(/^Anna, Montag: Die Pause/) })
  })

  it('needs a duty for a break', () => {
    const refused = enterIntoTemplateCells([], [monday], { kind: 'break', start: 600, end: 615 }, context, names)
    expect(refused).toMatchObject({ error: 'break_outside_work', message: expect.stringMatching(/^Anna, Montag: /) })
    const entries = enter([], [monday], { kind: 'shift', templateId: 2 })
    expect(enterIntoTemplateCells(entries, [monday], { kind: 'break', start: 720, end: 750 }, context, names))
      .toMatchObject({ error: 'break_overlap' })
  })

  it('clears cells and removes single entries unless a break would be left without its duty', () => {
    let entries = enter([], [monday, { employeeId: 1, weekday: 1 }], { kind: 'shift', templateId: 2 })
    entries = enter(entries, [monday], { kind: 'break', start: 900, end: 915 })
    const duty = entries.find(e => e.weekday === 0 && e.kind === 'shift')!
    expect(removeTemplateEntry(entries, duty.id, names)).toMatchObject({ error: 'break_outside_work' })
    const pause = entries.find(e => e.kind === 'break')!
    const removed = removeTemplateEntry(entries, pause.id, names)
    expect('entries' in removed && labels(removed.entries, 1, 0)).toEqual(['M'])
    expect(clearTemplateCells(entries, [monday]).map(e => e.weekday)).toEqual([1])
  })
})

describe('the counts-as-staff mark of an entry', () => {
  const cell = { employeeId: 1, weekday: 0 }
  it('follows the input, else the service; the chip color follows it', () => {
    expect(draftTemplateEntry({ kind: 'special', start: 480, end: 600, countsAsStaff: false }, cell, context, -1))
      .toMatchObject({ countsAsStaff: false, color: 'violet' })
    expect(draftTemplateEntry({ kind: 'special', start: 480, end: 600 }, cell, context, -1)).toMatchObject({ countsAsStaff: true, color: 'neutral' })
    expect(draftTemplateEntry({ kind: 'shift', templateId: 3, countsAsStaff: true }, cell, context, -1))
      .toMatchObject({ countsAsStaff: true, color: 'neutral' })
    expect(draftTemplateEntry({ kind: 'shift', templateId: 1, countsAsStaff: false }, cell, context, -1))
      .toMatchObject({ countsAsStaff: false, color: 'violet' })
  })
  it('is saved as it was opened: a special shift that does not count stays so', () => {
    const opened = draftTemplateEntry({ kind: 'special', start: 660, end: 960, countsAsStaff: false }, cell, context, 7)!
    expect(templateEntryInputs([opened], new Set([1]))).toEqual([
      { employeeId: 1, weekday: 0, kind: 'special', start: 660, end: 960, breakStart: null, breakEnd: null, countsAsStaff: false, note: null, homeOffice: false },
    ])
  })
})

describe('entries the editor does not show', () => {
  it('names the people whose entries are not saved and counts their entries', () => {
    const entries = enter([], [{ employeeId: 1, weekday: 0 }, { employeeId: 1, weekday: 1 }, { employeeId: 2, weekday: 0 }, { employeeId: 3, weekday: 0 }],
      { kind: 'shift', templateId: 1 })
    const people = new Map([[1, 'Anna'], [2, 'Berta'], [3, 'Clara']])
    expect(hiddenTemplateEntries(entries, new Set([2]), people)).toEqual({ names: ['Anna', 'Clara'], count: 3 })
    expect(hiddenTemplateEntries(entries, new Set([1, 2, 3]), people)).toEqual({ names: [], count: 0 })
  })
})

describe('what the editor saves', () => {
  it('sends each entry as the plan input of its weekday and employee', () => {
    let entries = enter([], [{ employeeId: 1, weekday: 0 }], { kind: 'shift', templateId: 2, homeOffice: true })
    entries = enter(entries, [{ employeeId: 1, weekday: 0 }], { kind: 'break', start: 900, end: 915 })
    entries = enter(entries, [{ employeeId: 2, weekday: 3 }], { kind: 'code', codeId: 11 })
    entries = enter(entries, [{ employeeId: 2, weekday: 4 }], { kind: 'special', start: 480, end: 720, breakStart: 600, breakEnd: 615, note: 'x' })
    expect(templateEntryInputs(entries, new Set([1, 2]))).toEqual([
      { employeeId: 1, weekday: 0, kind: 'shift', templateId: 2, countsAsStaff: true, note: null, homeOffice: true },
      { employeeId: 1, weekday: 0, kind: 'break', start: 900, end: 915 },
      { employeeId: 2, weekday: 3, kind: 'code', codeId: 11, start: null, end: null, breakStart: null, breakEnd: null, note: null, homeOffice: false },
      { employeeId: 2, weekday: 4, kind: 'special', start: 480, end: 720, breakStart: 600, breakEnd: 615, countsAsStaff: true, note: 'x', homeOffice: false },
    ])
    // Only the employees shown (the template's scope).
    expect(templateEntryInputs(entries, new Set([2])).map(e => e.employeeId)).toEqual([2, 2])
  })

  it('offers the facility\'s staff or the group\'s members', () => {
    const staff = [person(1, 'Anna', 2340, 31, 7), person(2, 'Berta', 1800, 31, 8), person(3, 'Sven', 1800)]
    expect(staffInScope(staff, null).map(s => s.name)).toEqual(['Anna', 'Berta', 'Sven'])
    expect(staffInScope(staff, 7).map(s => s.name)).toEqual(['Anna'])
  })
})

describe('the weekly hours of a template per employee', () => {
  it('adds the working time of each day: breaks off, VZ inside a duty once', () => {
    let entries = enter([], [0, 1, 2, 3, 4].map(weekday => ({ employeeId: 1, weekday })), { kind: 'shift', templateId: 2 }) // 7:45 each
    entries = enter(entries, [{ employeeId: 1, weekday: 0 }], { kind: 'code', codeId: 12, start: 480, end: 540 })
    entries = enter(entries, [{ employeeId: 1, weekday: 0 }], { kind: 'break', start: 900, end: 915 })
    expect(templateWeeklyMinutes(entries, anna)).toBe(5 * 465 - 15)
    expect(templateWeeklyMinutes(entries, berta)).toBe(0)
  })

  it('counts a whole Büro day with the daily target of the contract, none on a day off', () => {
    expect(templateWeekdayTarget(berta, 0)).toBe(450)
    expect(templateWeekdayTarget(berta, 4)).toBe(0)
    expect(templateWeekdayTarget(person(5, 'Ohne', null), 0)).toBe(0)
    let entries = enter([], [0, 1, 2, 3].map(weekday => ({ employeeId: 2, weekday })), { kind: 'code', codeId: 11 })
    expect(templateWeeklyMinutes(entries, berta)).toBe(30 * 60)
    entries = enter(entries, [{ employeeId: 2, weekday: 4 }], { kind: 'code', codeId: 11 })
    expect(templateWeeklyMinutes(entries, berta)).toBe(30 * 60)
  })

  it('leaves out days that are no working day of the contract, as filling a week skips them', () => {
    // Berta works Monday to Thursday: a duty on Friday is never written into the plan.
    const entries = enter([], [{ employeeId: 2, weekday: 0 }, { employeeId: 2, weekday: 4 }], { kind: 'shift', templateId: 1 })
    expect(templateWeeklyMinutes(entries, berta)).toBe(375)
    expect(templateWeeklyMinutes(entries, person(2, 'Berta', null))).toBe(0)
  })
})

describe('Saturday and Sunday in the week template editor', () => {
  it('has seven days, Monday to Sunday', () => {
    expect(TEMPLATE_WEEKDAYS).toBe(7)
    expect(templateWeekdays()).toEqual(['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'])
  })

  it('enters into Saturday and Sunday like into a weekday and sends them with their weekday', () => {
    const weekend = [{ employeeId: 1, weekday: 5 }, { employeeId: 1, weekday: 6 }]
    let entries = enter([], weekend, { kind: 'special', start: 540, end: 780, breakStart: null, breakEnd: null })
    entries = enter(entries, [{ employeeId: 1, weekday: 0 }], { kind: 'shift', templateId: 1 })
    expect(entries.map(e => e.weekday)).toEqual([0, 5, 6])
    expect(templateEntryInputs(entries, new Set([1])).map(e => e.weekday)).toEqual([0, 5, 6])
    expect(clearTemplateCells(entries, weekend).map(e => e.weekday)).toEqual([0])
  })

  it('counts a duty on the weekend with its time, also outside the contract days (filling a week writes it)', () => {
    expect(templateWeekdayTarget(anna, 5)).toBe(0)
    expect(templateWeekdayTarget(person(4, 'Sa', 30 * 60, 0b0111110), 5)).toBe(360)
    const entries = enter([], [{ employeeId: 1, weekday: 0 }, { employeeId: 1, weekday: 5 }], { kind: 'shift', templateId: 1 })
    expect(templateWeeklyMinutes(entries, anna)).toBe(2 * 375)
    // A whole Büro day on a Saturday off is never written: nothing to count.
    const office = enter([], [{ employeeId: 1, weekday: 6 }], { kind: 'code', codeId: 11 })
    expect(templateWeeklyMinutes(office, anna)).toBe(0)
    expect(templateWeeklyMinutes(entries, person(1, 'Anna', null))).toBe(0)
  })

  it('tells the days of the grid apart: a contract day, a free weekend day or a weekday off', () => {
    expect(templateDayKind(anna, 0)).toBe('workday')
    expect(templateDayKind(anna, 5)).toBe('weekend')
    expect(templateDayKind(berta, 4)).toBe('day_off')
    expect(templateDayKind(person(4, 'Sa', 30 * 60, 0b0111110), 5)).toBe('workday')
  })

  it('shows Saturday and Sunday in the preview only when the template has something there', () => {
    const template = (days: string[]) => ({ id: 1, name: 'A', groupId: null, updatedAt: '', rows: [{ employeeId: 1, name: 'Anna', days }] })
    expect(previewDayCount(template(['F1', '', '', '', '', '', '']))).toBe(5)
    expect(previewDayCount(template(['F1', '', '', '', '', '', 'S']))).toBe(7)
    expect(previewDayCount({ ...template([]), rows: [] })).toBe(5)
  })
})

describe('„Tag übernehmen“ from a compared template', () => {
  const shown = new Set([1, 2])
  const source = () => {
    let entries = enter([], [{ employeeId: 1, weekday: 2 }, { employeeId: 3, weekday: 2 }], { kind: 'shift', templateId: 2 })
    entries = enter(entries, [{ employeeId: 2, weekday: 2 }], { kind: 'special', start: 480, end: 720, countsAsStaff: false })
    entries = enter(entries, [{ employeeId: 1, weekday: 2 }], { kind: 'break', start: 900, end: 915 })
    return enter(entries, [{ employeeId: 1, weekday: 3 }], { kind: 'shift', templateId: 1 })
  }

  it('copies the day of the people shown, replacing the draft\'s day, other days and people untouched', () => {
    let draft = enter([], [{ employeeId: 2, weekday: 2 }, { employeeId: 2, weekday: 0 }], { kind: 'shift', templateId: 1 })
    draft = enter(draft, [{ employeeId: 3, weekday: 2 }], { kind: 'special', start: 600, end: 700 })
    expect(dayHasEntries(draft, 2, shown)).toBe(true)
    expect(dayHasEntries(draft, 1, shown)).toBe(false)
    // Clara (3) is not shown: her entry in the draft stays, hers in the source is not copied.
    expect(dayHasEntries(draft.filter(e => e.employeeId === 3), 2, shown)).toBe(false)
    const result = copyTemplateDay(draft, source(), 2, shown, context, names)
    if ('error' in result) throw new Error(result.error)
    expect(labels(result.entries, 1, 2)).toEqual(['M', '[15:00–15:15]'])
    expect(labels(result.entries, 2, 2)).toEqual(['8:00–12:00'])
    expect(result.entries.find(e => e.employeeId === 2 && e.weekday === 2)).toMatchObject({ kind: 'special', countsAsStaff: false })
    expect(labels(result.entries, 2, 0)).toEqual(['F1'])
    expect(labels(result.entries, 3, 2)).toEqual(['10:00–11:40'])
    expect(labels(result.entries, 1, 3)).toEqual([])
    // New ids of the draft (negative, unsaved), none taken from the other template.
    const ids = result.entries.map(e => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(result.entries.filter(e => e.weekday === 2 && e.employeeId !== 3).every(e => e.id < 0)).toBe(true)
  })

  it('refuses like a manual entry: a service that no longer exists, or a cell against the rules, changing nothing', () => {
    const gone = source().map(e => (e.kind === 'shift' ? { ...e, templateId: 99 } : e))
    expect(copyTemplateDay([], gone, 2, shown, context, names)).toEqual({ error: 'template_not_found', message: expect.stringContaining('Anna, Mittwoch') })
    const broken = source().filter(e => e.kind !== 'shift' || e.employeeId !== 1)
    expect(copyTemplateDay([], broken, 2, shown, context, names)).toMatchObject({ error: 'break_outside_work', message: expect.stringContaining('Anna, Mittwoch') })
    const urlaub = [draftTemplateEntry({ kind: 'code', codeId: 10 }, { employeeId: 1, weekday: 2 }, context, 5)!]
    expect(copyTemplateDay([], urlaub, 2, shown, context, names)).toMatchObject({ error: 'template_entry_not_allowed' })
  })
})

describe('„Andere Vorlagen anzeigen“ remembered on the device', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('is off until switched on, and remembered', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    })
    expect(readTemplateCompare()).toBe(false)
    writeTemplateCompare(true)
    expect(readTemplateCompare()).toBe(true)
    writeTemplateCompare(false)
    expect(store.size).toBe(0)
  })
  it('stays off without storage', () => {
    const blocked = () => { throw new Error('blocked') }
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked })
    expect(readTemplateCompare()).toBe(false)
    expect(() => writeTemplateCompare(true)).not.toThrow()
  })
})

describe('the coverage warnings of the editor (as the plan warns)', () => {
  const open = { open: 390, close: 1020, closed: false }
  const closed = { open: null, close: null, closed: true }
  const coverage: WeekTemplateCoverageDto = {
    rules: [{ id: 3, label: 'Spätdienst 16:00–17:00', start: 960, end: 1020, minCount: 1, weekdays: 4 }],
    hours: {
      facility: { days: [open, open, open, open, closed], minAtOpening: 1, minAtClosing: 1 },
      groups: [{ groupId: 7, groupName: 'Bären', hours: { days: [open, open, open, open, closed], minAtOpening: 1, minAtClosing: 1 } }],
    },
  }
  const anna7 = person(1, 'Anna', 39 * 60, 0b0011111, 7)
  const berta8 = person(2, 'Berta', 30 * 60, 0b0011111, 8)
  const allDay = (employeeId: number, weekday: number) =>
    draftTemplateEntry({ kind: 'special', start: 390, end: 1020 }, { employeeId, weekday }, context, -(employeeId * 10 + weekday))!

  it('lists per weekday what is missing in the plan\'s words, live from the draft, Friday closed', () => {
    const entries = [0, 1, 2, 3].map(day => allDay(2, day))
    expect(templateCoverage(entries, [anna7, berta8], null, coverage)).toEqual([
      { weekday: 0, text: 'Mo: Bären – 6:30 Öffnung: niemand eingeplant' },
      { weekday: 0, text: 'Mo: Bären – 17:00 Schließung: niemand eingeplant' },
      { weekday: 1, text: 'Di: Bären – 6:30 Öffnung: niemand eingeplant' },
      { weekday: 1, text: 'Di: Bären – 17:00 Schließung: niemand eingeplant' },
      { weekday: 2, text: 'Mi: Spätdienst 16:00–17:00: 0× eingetragen (1 benötigt)' },
      { weekday: 2, text: 'Mi: Bären – 6:30 Öffnung: niemand eingeplant' },
      { weekday: 2, text: 'Mi: Bären – 17:00 Schließung: niemand eingeplant' },
      { weekday: 3, text: 'Do: Bären – 6:30 Öffnung: niemand eingeplant' },
      { weekday: 3, text: 'Do: Bären – 17:00 Schließung: niemand eingeplant' },
    ])
    const covered = [...[0, 1, 2, 3].map(day => allDay(1, day)), ...entries,
      draftTemplateEntry({ kind: 'special', start: 960, end: 1020 }, { employeeId: 1, weekday: 2 }, context, -99)!]
    // Anna's whole days overlap the late duty, but the check counts what is entered (the cell rule is the editor's own).
    expect(templateCoverage(covered, [anna7, berta8], null, coverage)).toEqual([])
  })

  it('counts only the people shown, and nothing without the coverage data', () => {
    const entries = [0, 1, 2, 3].map(day => allDay(1, day))
    expect(templateCoverage(entries, [berta8], null, coverage).filter(item => item.weekday === 0)).toHaveLength(4)
    expect(templateCoverage(entries, [anna7], null, null)).toEqual([])
  })

  it('gives a group template only its group\'s warnings', () => {
    const groupCoverage = { ...coverage, rules: [...coverage.rules, { id: 4, label: 'Früh', start: 390, end: null, minCount: 1, groupId: 8, groupName: 'Mäuse' }] }
    const result = templateCoverage([], [anna7], 7, groupCoverage)
    expect(result.every(item => item.text.includes('Bären'))).toBe(true)
    expect(result).toHaveLength(8)
  })
})
