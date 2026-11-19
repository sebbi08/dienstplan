import { canBeHomeOffice, dayCredit, isFullDayTimed, isWorkEntry } from '#shared/domain/balance'
import { validateSpan } from '#shared/domain/time'
import { describeEntry } from '#shared/domain/describe'
import { isTargetGapCode } from '#shared/domain/warnings'
import { workdayCount, worksOnWeekday } from '#shared/domain/targets'
import {
  isTemplateWeekend, planEntryColor, TEMPLATE_WEEKDAYS, templateCellConflict, templateCoverageWarnings,
} from '#shared/domain/weekTemplates'
import type {
  CodeDto, EntryInput, TemplateDto, WeekTemplateCoverageDto, WeekTemplateDto, WeekTemplateEntryDto, WeekTemplateEntryInput,
  WeekTemplateStaffDto,
} from '#shared/types/api'
import { de } from '~/locales/de'
import { entryApplyMode } from './applyMode'
import { templateCellMessage } from './errors'
import { warningText } from './warnings'

/**
 * The week template editor's rules, pure so a test can load them: the entries live in the page until „Speichern“ sends
 * the whole template. Entering follows the plan (applyToCells): a duty is added next to what a cell holds, a whole
 * Büro/VZ day replaces the cell, a duty replaces a whole day, and every cell keeps the server's rules
 * (templateCellConflict), so what the editor accepts is what the server accepts.
 */

/** One cell of the editor: an employee's weekday (0 = Monday … 6 = Sunday). */
export interface TemplateCell {
  employeeId: number
  weekday: number
}

/** The facility's services (Dienste) and codes, to show and check what is entered. */
export interface TemplateEditorContext {
  templates: TemplateDto[]
  codes: CodeDto[]
}

/** A refusal of the editor: the server's error code and the German text naming the cell. */
export interface TemplateRefusal {
  error: string
  message: string
}

export const templateCellOf = (entry: TemplateCell): string => `${entry.employeeId}|${entry.weekday}`
const inCell = (cell: TemplateCell) => (entry: TemplateCell) => entry.employeeId === cell.employeeId && entry.weekday === cell.weekday

/** By weekday and start (a whole day first), as the server lists a template; entered order otherwise. */
function sorted(entries: WeekTemplateEntryDto[]): WeekTemplateEntryDto[] {
  return [...entries].sort((a, b) => a.weekday - b.weekday || (a.start ?? -1) - (b.start ?? -1))
}

/**
 * The entry the input gives in the cell, shown like a plan chip (as the server resolves it: a shift takes its service's
 * times). `id` is the editor's own (negative for entries not saved yet). Null for a service that does not exist.
 */
export function draftTemplateEntry(
  input: EntryInput & { countsAsStaff?: boolean }, cell: TemplateCell, context: TemplateEditorContext, id: number,
): WeekTemplateEntryDto | null {
  const base = {
    id, employeeId: cell.employeeId, weekday: cell.weekday, date: '', groupId: null, helpFacilityId: null,
    note: input.note?.trim() || null, homeOffice: input.homeOffice ?? false, templateId: null, codeId: null, codeKey: null,
    shortLabel: null, creditMode: 'timed' as const,
  }
  if (input.kind === 'shift') {
    const shift = context.templates.find(candidate => candidate.id === input.templateId)
    if (!shift) return null
    const { start, end, breakStart, breakEnd } = shift
    const countsAsStaff = input.countsAsStaff ?? shift.countsAsStaff
    return {
      ...base, kind: 'shift', templateId: shift.id, start, end, breakStart, breakEnd, countsAsStaff,
      homeOffice: input.homeOffice ?? shift.homeOffice,
      label: describeEntry({ kind: 'shift', start, end }, null, null), shortLabel: shift.shortLabel || null,
      color: planEntryColor({ kind: 'shift', countsAsStaff }, null),
    }
  }
  const start = input.start ?? null
  const end = input.end ?? null
  if (input.kind === 'break') {
    return {
      ...base, kind: 'break', start, end, breakStart: null, breakEnd: null, countsAsStaff: false, homeOffice: false,
      label: describeEntry({ kind: 'break', start, end }, null, null), color: 'red',
    }
  }
  const span = { start, end, breakStart: input.breakStart ?? null, breakEnd: input.breakEnd ?? null }
  if (input.kind === 'special') {
    const countsAsStaff = input.countsAsStaff ?? true
    return {
      ...base, kind: 'special', ...span, countsAsStaff, label: describeEntry({ kind: 'special', start, end }, null, null),
      color: planEntryColor({ kind: 'special', countsAsStaff }, null),
    }
  }
  const code = context.codes.find(candidate => candidate.id === input.codeId)
  if (!code) return null
  return {
    ...base, kind: 'code', ...span, countsAsStaff: true, codeId: code.id, codeKey: code.key, creditMode: code.creditMode,
    label: describeEntry({ kind: 'code', start, end }, code.label, code.creditMode), color: code.color,
  }
}

/** The first cell among `cells` that breaks the server's rules, as a refusal naming it; null when all are fine. */
function refusalOf(entries: WeekTemplateEntryDto[], cells: TemplateCell[], names: Map<number, string>): TemplateRefusal | null {
  for (const cell of cells) {
    const error = templateCellConflict(entries.filter(inCell(cell)))
    if (error) return { error, message: templateCellMessage(error, names.get(cell.employeeId) ?? '', cell.weekday) }
  }
  return null
}

/**
 * Enters the input into every cell like the plan does (entryApplyMode): 'replace' (a whole Büro/VZ day) empties the
 * cell first; 'add' keeps it, except that a duty with times replaces a whole day. If any cell would break the rules,
 * nothing changes and the refusal names the first such cell.
 */
export function enterIntoTemplateCells(
  entries: WeekTemplateEntryDto[], cells: TemplateCell[], input: EntryInput, context: TemplateEditorContext,
  names: Map<number, string>,
): { entries: WeekTemplateEntryDto[] } | TemplateRefusal {
  const mode = entryApplyMode(input, context.codes)
  let next = entries
  let nextId = Math.min(0, ...entries.map(entry => entry.id)) - 1
  for (const cell of cells) {
    const entry = draftTemplateEntry(input, cell, context, nextId--)
    if (!entry) return { error: 'template_not_found', message: templateCellMessage('template_not_found', names.get(cell.employeeId) ?? '', cell.weekday) }
    const addsWork = entry.kind !== 'break' && entry.start !== null
    next = next.filter(other => !inCell(cell)(other) || (mode === 'add' && !(addsWork && isFullDayTimed(other))))
    next = [...next, entry]
  }
  const refusal = refusalOf(next, cells, names)
  return refusal ?? { entries: sorted(next) }
}

/** The times the entry dialog gives; `homeOffice` only when its mark changed. */
export interface TemplateEntryTimes {
  start: number
  end: number
  breakStart: number | null
  breakEnd: number | null
  homeOffice?: boolean
}

/**
 * Whether changing a shift-button entry to these times detaches it from its button on that day (a special shift with
 * the times). In the plan only another start or end does; a template stores a button's shift by its service, so a
 * changed break detaches it too (otherwise saving would bring back the service's break).
 */
export function detachesFromButton(entry: WeekTemplateEntryDto, times: TemplateEntryTimes): boolean {
  return entry.kind === 'shift' && (times.start !== entry.start || times.end !== entry.end
    || times.breakStart !== entry.breakStart || times.breakEnd !== entry.breakEnd)
}

/**
 * Changes the times of one timed entry (its chip clicked), like the plan's entry dialog: the span is checked
 * (span_* as the server), a break keeps no break of its own, home office only on working time
 * (home_office_not_allowed), a shift-button entry with other times becomes a special shift of that day
 * (detachesFromButton) keeping whether it counts as staff, and the cell must keep the rules (an overlap or a break
 * without its duty is refused naming the cell). Nothing changes on a refusal.
 */
export function editTemplateEntry(
  entries: WeekTemplateEntryDto[], id: number, times: TemplateEntryTimes, context: TemplateEditorContext, names: Map<number, string>,
): { entries: WeekTemplateEntryDto[] } | TemplateRefusal {
  const entry = entries.find(candidate => candidate.id === id)
  if (!entry) return { entries }
  const refuse = (error: string): TemplateRefusal =>
    ({ error, message: templateCellMessage(error, names.get(entry.employeeId) ?? '', entry.weekday) })
  if (entry.start === null || entry.end === null) return refuse('not_a_timed_entry')
  const isBreak = entry.kind === 'break'
  const span = {
    start: times.start, end: times.end, breakStart: isBreak ? null : times.breakStart, breakEnd: isBreak ? null : times.breakEnd,
  }
  const spanError = validateSpan(span)
  if (spanError) return refuse(`span_${spanError}`)
  if (times.homeOffice && !(isWorkEntry(entry) && canBeHomeOffice(entry.codeKey))) return refuse('home_office_not_allowed')
  const kind = detachesFromButton(entry, span) ? 'special' : entry.kind
  const code = entry.kind === 'code' ? context.codes.find(candidate => candidate.id === entry.codeId) : undefined
  const changed: WeekTemplateEntryDto = {
    ...entry, ...span, kind, homeOffice: times.homeOffice ?? entry.homeOffice,
    label: describeEntry({ kind, start: span.start, end: span.end }, code?.label ?? null, entry.creditMode),
    ...(kind === entry.kind ? {} : { templateId: null, shortLabel: null, color: planEntryColor({ kind, countsAsStaff: entry.countsAsStaff }, null) }),
  }
  const next = entries.map(candidate => (candidate.id === id ? changed : candidate))
  return refusalOf(next, [entry], names) ?? { entries: sorted(next) }
}

/** Whether the draft has entries on the weekday for the people shown („Tag übernehmen“ asks before replacing them). */
export function dayHasEntries(entries: WeekTemplateEntryDto[], weekday: number, shown: ReadonlySet<number>): boolean {
  return entries.some(entry => entry.weekday === weekday && shown.has(entry.employeeId))
}

/**
 * „Tag übernehmen“: the weekday of the people shown becomes the compared template's day (their entries there are
 * replaced; other days, and people not shown, stay). The copies get new draft ids and are checked like a manual entry:
 * a service that no longer exists (template_not_found), anything but VZ/Büro among the codes
 * (template_entry_not_allowed) and every cell against the rules (templateCellConflict) refuse the whole day, naming
 * the first such cell.
 */
export function copyTemplateDay(
  entries: WeekTemplateEntryDto[], source: WeekTemplateEntryDto[], weekday: number, shown: ReadonlySet<number>,
  context: TemplateEditorContext, names: Map<number, string>,
): { entries: WeekTemplateEntryDto[] } | TemplateRefusal {
  const copied = source.filter(entry => entry.weekday === weekday && shown.has(entry.employeeId))
  const refuse = (error: string, entry: TemplateCell): TemplateRefusal =>
    ({ error, message: templateCellMessage(error, names.get(entry.employeeId) ?? '', entry.weekday) })
  for (const entry of copied) {
    if (entry.kind === 'shift' && !context.templates.some(shift => shift.id === entry.templateId)) return refuse('template_not_found', entry)
    if (entry.kind === 'code' && !isTargetGapCode(entry.codeKey)) return refuse('template_entry_not_allowed', entry)
  }
  let nextId = Math.min(0, ...entries.map(entry => entry.id)) - 1
  const kept = entries.filter(entry => entry.weekday !== weekday || !shown.has(entry.employeeId))
  const next = [...kept, ...copied.map(entry => ({ ...entry, id: nextId-- }))]
  const cells = [...new Map(copied.map(entry => [templateCellOf(entry), { employeeId: entry.employeeId, weekday }])).values()]
  return refusalOf(next, cells, names) ?? { entries: sorted(next) }
}

const COMPARE_KEY = 'dienstplan.weekTemplateCompare'

/** Whether „Andere Vorlagen anzeigen“ is on on this device (off when storage is unavailable). */
export function readTemplateCompare(): boolean {
  try {
    return localStorage.getItem(COMPARE_KEY) === '1'
  }
  catch {
    return false
  }
}

export function writeTemplateCompare(on: boolean): void {
  try {
    if (on) localStorage.setItem(COMPARE_KEY, '1')
    else localStorage.removeItem(COMPARE_KEY)
  }
  catch {
    // Not remembered; the switch still works on this page.
  }
}

/** „Leeren“: the cells lose all their entries. */
export function clearTemplateCells(entries: WeekTemplateEntryDto[], cells: TemplateCell[]): WeekTemplateEntryDto[] {
  const keys = new Set(cells.map(templateCellOf))
  return entries.filter(entry => !keys.has(templateCellOf(entry)))
}

/** Removes one entry (× on its chip), unless that leaves its cell against the rules (a break without its duty). */
export function removeTemplateEntry(
  entries: WeekTemplateEntryDto[], id: number, names: Map<number, string>,
): { entries: WeekTemplateEntryDto[] } | TemplateRefusal {
  const removed = entries.find(entry => entry.id === id)
  if (!removed) return { entries }
  const next = entries.filter(entry => entry.id !== id)
  return refusalOf(next, [removed], names) ?? { entries: next }
}

/**
 * What „Speichern“ sends: each entry of the employees shown as the plan input of its weekday. Shifts and special
 * shifts carry their countsAsStaff, so an entry is saved exactly as it was opened (a changed HK shift, opened as a
 * special shift, keeps not counting as staff).
 */
export function templateEntryInputs(entries: WeekTemplateEntryDto[], shown: ReadonlySet<number>): WeekTemplateEntryInput[] {
  return entries.filter(entry => shown.has(entry.employeeId)).map((entry): WeekTemplateEntryInput => {
    const cell = { employeeId: entry.employeeId, weekday: entry.weekday }
    if (entry.kind === 'break') return { ...cell, kind: 'break', start: entry.start, end: entry.end }
    const extra = { note: entry.note, homeOffice: entry.homeOffice }
    if (entry.kind === 'shift') return { ...cell, kind: 'shift', templateId: entry.templateId, countsAsStaff: entry.countsAsStaff, ...extra }
    const span = { start: entry.start, end: entry.end, breakStart: entry.breakStart, breakEnd: entry.breakEnd }
    return entry.kind === 'code'
      ? { ...cell, kind: 'code', codeId: entry.codeId, ...span, ...extra }
      : { ...cell, kind: 'special', ...span, countsAsStaff: entry.countsAsStaff, ...extra }
  })
}

/** The entries not shown (another group, or no longer in the facility) that „Speichern“ leaves out: whose and how many. */
export function hiddenTemplateEntries(
  entries: WeekTemplateEntryDto[], shown: ReadonlySet<number>, names: Map<number, string>,
): { names: string[]; count: number } {
  const hidden = entries.filter(entry => !shown.has(entry.employeeId))
  const people = [...new Set(hidden.map(entry => entry.employeeId))].map(id => names.get(id) ?? '').filter(Boolean)
  return { names: people, count: hidden.length }
}

/** The columns of the editor: the facility's staff, or the group's members for a group template (as saving a week). */
export function staffInScope(staff: WeekTemplateStaffDto[], groupId: number | null): WeekTemplateStaffDto[] {
  return groupId === null ? staff : staff.filter(person => person.groupId === groupId)
}

/** The daily target of the weekday by the contract (weekly hours spread over its working days); 0 on a day off. */
export function templateWeekdayTarget(person: WeekTemplateStaffDto, weekday: number): number {
  if (person.weeklyMinutes === null || !worksOnWeekday(person.workdays, weekday)) return 0
  return Math.round(person.weeklyMinutes / workdayCount(person.workdays))
}

/**
 * The working time the template plans for the person in a week, as the balance counts a day (dayCredit): breaks off,
 * overlapping entries once, a whole Büro/VZ day with the daily target of that weekday. Weekdays that are no working day
 * of the contract (target 0) are left out, as filling a week skips them; Saturday and Sunday count with their times.
 */
export function templateWeeklyMinutes(entries: WeekTemplateEntryDto[], person: WeekTemplateStaffDto): number {
  let total = 0
  for (let weekday = 0; weekday < TEMPLATE_WEEKDAYS; weekday++) {
    const target = templateWeekdayTarget(person, weekday)
    const day = entries.filter(inCell({ employeeId: person.id, weekday }))
    // Saturday/Sunday are filled off the contract days too (a whole Büro/VZ day there credits its target 0: nothing).
    const filled = target > 0 || (isTemplateWeekend(weekday) && person.weeklyMinutes !== null)
    if (filled && day.length > 0) total += dayCredit(day, target)
  }
  return total
}

/** The days of the editor's grid, Monday to Sunday. */
export function templateWeekdays(): string[] {
  return de.weekdaysLong.slice(0, TEMPLATE_WEEKDAYS)
}

/**
 * How a cell of the grid looks: a working day of the contract; a weekend day off (filled only with what is entered
 * there, a whole Büro/VZ day not); a weekday off (filling a week skips it).
 */
export function templateDayKind(person: WeekTemplateStaffDto, weekday: number): 'workday' | 'weekend' | 'day_off' {
  if (templateWeekdayTarget(person, weekday) > 0) return 'workday'
  return isTemplateWeekend(weekday) ? 'weekend' : 'day_off'
}

/**
 * The coverage warnings of the template, live from the draft: the plan's checks (templateCoverageWarnings, the same
 * implementation as the plan's dayWarnings) over the entries of the people shown (what „Speichern“ keeps), each duty
 * for the person's home group; in the plan's words with the weekday first („Mo: Bären – 6:30 Öffnung: niemand
 * eingeplant“). None while the coverage data is not loaded.
 */
export function templateCoverage(
  entries: WeekTemplateEntryDto[], columns: WeekTemplateStaffDto[], groupId: number | null, coverage: WeekTemplateCoverageDto | null,
): { weekday: number; text: string }[] {
  if (!coverage) return []
  const homeGroups = new Map(columns.map(person => [person.id, person.groupId]))
  const shown = entries.filter(entry => homeGroups.has(entry.employeeId))
  return templateCoverageWarnings(shown, id => homeGroups.get(id) ?? null, coverage.rules, coverage.hours, groupId)
    .map(({ weekday, warning }) => ({ weekday, text: de.weekTemplates.editor.coverageLine(de.weekdaysShort[weekday]!, warningText(warning, new Map())) }))
}

/** The days a template's preview shows: Monday to Friday, Saturday and Sunday too when it has something there. */
export function previewDayCount(template: WeekTemplateDto): number {
  return template.rows.some(row => row.days.slice(5).some(Boolean)) ? TEMPLATE_WEEKDAYS : 5
}
