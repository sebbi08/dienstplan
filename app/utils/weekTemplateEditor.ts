import { dayCredit, isFullDayTimed } from '#shared/domain/balance'
import { describeEntry } from '#shared/domain/describe'
import { workdayCount, worksOnWeekday } from '#shared/domain/targets'
import { planEntryColor, TEMPLATE_WEEKDAYS, templateCellConflict } from '#shared/domain/weekTemplates'
import type {
  CodeDto, EntryInput, TemplateDto, WeekTemplateEntryDto, WeekTemplateEntryInput, WeekTemplateStaffDto,
} from '#shared/types/api'
import { entryApplyMode } from './applyMode'
import { templateCellMessage } from './errors'

/**
 * The week template editor's rules, pure so a test can load them: the entries live in the page until „Speichern“ sends
 * the whole template. Entering follows the plan (applyToCells): a duty is added next to what a cell holds, a whole
 * Büro/VZ day replaces the cell, a duty replaces a whole day, and every cell keeps the server's rules
 * (templateCellConflict), so what the editor accepts is what the server accepts.
 */

/** One cell of the editor: an employee's weekday (0 = Monday … 4 = Friday). */
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
  input: EntryInput, cell: TemplateCell, context: TemplateEditorContext, id: number,
): WeekTemplateEntryDto | null {
  const base = {
    id, employeeId: cell.employeeId, weekday: cell.weekday, date: '', groupId: null, helpFacilityId: null,
    note: input.note?.trim() || null, homeOffice: input.homeOffice ?? false, templateId: null, codeId: null, codeKey: null,
    shortLabel: null, creditMode: 'timed' as const,
  }
  if (input.kind === 'shift') {
    const shift = context.templates.find(candidate => candidate.id === input.templateId)
    if (!shift) return null
    const { start, end, breakStart, breakEnd, countsAsStaff } = shift
    return {
      ...base, kind: 'shift', templateId: shift.id, start, end, breakStart, breakEnd, countsAsStaff,
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
    return { ...base, kind: 'special', ...span, countsAsStaff: true, label: describeEntry({ kind: 'special', start, end }, null, null), color: 'neutral' }
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

/** What „Speichern“ sends: each entry of the employees shown as the plan input of its weekday. */
export function templateEntryInputs(entries: WeekTemplateEntryDto[], shown: ReadonlySet<number>): WeekTemplateEntryInput[] {
  return entries.filter(entry => shown.has(entry.employeeId)).map((entry): WeekTemplateEntryInput => {
    const cell = { employeeId: entry.employeeId, weekday: entry.weekday }
    if (entry.kind === 'break') return { ...cell, kind: 'break', start: entry.start, end: entry.end }
    const extra = { note: entry.note, homeOffice: entry.homeOffice }
    if (entry.kind === 'shift') return { ...cell, kind: 'shift', templateId: entry.templateId, ...extra }
    const span = { start: entry.start, end: entry.end, breakStart: entry.breakStart, breakEnd: entry.breakEnd }
    return entry.kind === 'code' ? { ...cell, kind: 'code', codeId: entry.codeId, ...span, ...extra } : { ...cell, kind: 'special', ...span, ...extra }
  })
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
 * overlapping entries once, a whole Büro/VZ day with the daily target of that weekday.
 */
export function templateWeeklyMinutes(entries: WeekTemplateEntryDto[], person: WeekTemplateStaffDto): number {
  let total = 0
  for (let weekday = 0; weekday < TEMPLATE_WEEKDAYS; weekday++) {
    const day = entries.filter(inCell({ employeeId: person.id, weekday }))
    if (day.length > 0) total += dayCredit(day, templateWeekdayTarget(person, weekday))
  }
  return total
}
