import { addDays } from './dates'
import type { IsoDate } from './types'
import type { Warning } from './warnings'

/** The three groups of the plan's warning list: Besetzung, Dienstplan-Lücken, Zeiterfassung. */
export type WarningCategory = 'staffing' | 'gaps' | 'time'
export const WARNING_CATEGORIES: WarningCategory[] = ['staffing', 'gaps', 'time']

export function warningCategory(warning: Warning): WarningCategory {
  switch (warning.type) {
    case 'coverage':
    case 'edge':
    case 'staffing':
      return 'staffing'
    case 'missing_entry':
    case 'target_gap':
      return 'gaps'
    default:
      return 'time'
  }
}

/** Whom or what a warning is about (rule, edge, group and time span, person), without its date and values. */
function subject(warning: Warning): string {
  switch (warning.type) {
    case 'coverage':
      return String(warning.ruleId)
    case 'edge':
      // The group's id (rename-safe); facility hours have none.
      return `${warning.edge}|${warning.groupId ?? ''}`
    case 'staffing':
      return `${warning.groupId}|${warning.fachkraft ? 'f' : 'a'}|${warning.from}-${warning.to}`
    default:
      return String(warning.employeeId)
  }
}

/**
 * „Zur Kenntnis genommen“ is stored per facility under this key: type, day and subject. Several staffing gaps of one
 * group on a day differ by their time span, so it is part of the subject.
 */
export function warningAckKey(warning: Warning): string {
  return `${warning.type}|${warning.date}|${subject(warning)}`
}

/** The values of a warning; an acknowledged warning whose values changed shows again. */
export function warningSignature(warning: Warning): string {
  switch (warning.type) {
    case 'coverage':
      return `${warning.found}/${warning.required}`
    case 'edge':
      return `${warning.time}|${warning.found}/${warning.required}`
    case 'staffing':
      return `${warning.have}/${warning.need}`
    case 'target_gap':
      return String(warning.missingMinutes)
    default:
      return ''
  }
}

const ID = /^[1-9]\d*$/
/** The subject's format per type, as `subject` writes it. */
const SUBJECT_FORMATS: Record<Warning['type'], RegExp> = {
  missing_entry: ID, target_gap: ID, open_record: ID, missing_record: ID, break_rule: ID, record_without_plan: ID,
  coverage: ID,
  edge: /^(opening|closing)\|([1-9]\d*)?$/,
  staffing: /^[1-9]\d*\|[fa]\|\d{1,4}-\d{1,4}$/,
}
export const MAX_ACK_SIGNATURE_LENGTH = 100

/**
 * The day of an acknowledgement key, or null when the key is not one `warningAckKey` writes (a known type, an ISO day,
 * the type's subject format).
 */
export function ackKeyDate(key: string): IsoDate | null {
  const [type, date, ...rest] = key.split('|')
  if (type === undefined || date === undefined || !Object.hasOwn(SUBJECT_FORMATS, type)) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  return SUBJECT_FORMATS[type as Warning['type']].test(rest.join('|')) ? date : null
}

/** Acknowledgements of a facility: key → signature. */
export type WarningAcks = ReadonlyMap<string, string>

export function isAcknowledged(warning: Warning, acks: WarningAcks): boolean {
  return acks.get(warningAckKey(warning)) === warningSignature(warning)
}

/**
 * Warnings that are joined into one line on consecutive days: same type and subject, and the same values (a target
 * gap's minutes are summed instead).
 */
function runKey(warning: Warning): string {
  switch (warning.type) {
    case 'coverage':
      return `coverage|${warning.ruleId}|${warning.groupName ?? ''}|${warning.found}|${warning.required}`
    case 'edge':
      return `edge|${subject(warning)}|${warning.time}|${warning.found}|${warning.required}`
    case 'staffing':
      return `staffing|${subject(warning)}|${warning.have}|${warning.need}`
    default:
      return `${warning.type}|${warning.employeeId}`
  }
}

/** One line of the list: one warning, or the same warning on several consecutive days. */
export interface WarningLine {
  category: WarningCategory
  type: Warning['type']
  from: IsoDate
  to: IsoDate
  /** The days with the warning (a range may skip weekends, holidays and closures). */
  days: number
  warnings: Warning[]
  /** Target gaps: the missing minutes of all days together (0 for other types). */
  missingMinutes: number
}

/** Per employee: the open days they do not work (part-time days off), which do not break their runs either. */
export type EmployeeOffDays = ReadonlyMap<number, ReadonlySet<IsoDate>>

/** Whether a run ending on `last` goes on at `next`: no open day (and workday of `off`'s person) lies between them. */
function continues(last: IsoDate, next: IsoDate, openDays: ReadonlySet<IsoDate>, off: ReadonlySet<IsoDate> | undefined): boolean {
  if (next <= last) return next === last
  for (let date = addDays(last, 1); date < next; date = addDays(date, 1)) {
    if (openDays.has(date) && !off?.has(date)) return false
  }
  return true
}

/**
 * Joins identical warnings on consecutive days into lines. `openDays` are the plan's checked days (no weekend, holiday
 * or closure): a run goes on over the days in between that are not open, and for a person's warnings also over their
 * days off (`offDays`). Lines are sorted by their first day.
 */
export function condenseWarnings(
  warnings: Warning[], openDays: ReadonlySet<IsoDate>, offDays: EmployeeOffDays = new Map(),
): WarningLine[] {
  const sorted = [...warnings].sort((a, b) => a.date.localeCompare(b.date))
  const lines: WarningLine[] = []
  const open = new Map<string, WarningLine>()
  for (const warning of sorted) {
    const key = runKey(warning)
    const line = open.get(key)
    const employeeId = employeeOf(warning)
    if (line && continues(line.to, warning.date, openDays, employeeId === null ? undefined : offDays.get(employeeId))) {
      if (warning.date !== line.to) line.days += 1
      line.to = warning.date
      line.warnings.push(warning)
      if (warning.type === 'target_gap') line.missingMinutes += warning.missingMinutes
      continue
    }
    const next: WarningLine = {
      category: warningCategory(warning), type: warning.type, from: warning.date, to: warning.date, days: 1,
      warnings: [warning], missingMinutes: warning.type === 'target_gap' ? warning.missingMinutes : 0,
    }
    open.set(key, next)
    lines.push(next)
  }
  return lines
}

/** Past days (before today) and the days from today on. */
export function splitPast(warnings: Warning[], today: IsoDate): { current: Warning[]; past: Warning[] } {
  return {
    current: warnings.filter(warning => warning.date >= today),
    past: warnings.filter(warning => warning.date < today),
  }
}

/** The filter above the list: one group (its own warnings and those of its members) and/or one person. */
export interface WarningFilter {
  groupId: number | null
  employeeId: number | null
}

export interface WarningFilterContext {
  /** Home group per employee (null = Springer, helpers, no groups). */
  employeeGroups: ReadonlyMap<number, number | null>
  groupNames: ReadonlyMap<number, string>
}

function employeeOf(warning: Warning): number | null {
  return warning.type === 'coverage' || warning.type === 'edge' || warning.type === 'staffing' ? null : warning.employeeId
}

/** The group a warning is about: a person's home group, or the group of a group rule or group hours (null = facility). */
function groupOf(warning: Warning, context: WarningFilterContext): number | null {
  if (warning.type === 'staffing') return warning.groupId
  if (warning.type === 'edge' && warning.groupId !== undefined) return warning.groupId
  if (warning.type === 'coverage' || warning.type === 'edge') {
    if (warning.groupName === undefined) return null
    for (const [id, name] of context.groupNames) if (name === warning.groupName) return id
    return null
  }
  return context.employeeGroups.get(warning.employeeId) ?? null
}

/** Whether a group filter keeps the warning: its own group, or a facility-wide Besetzung warning (that concerns all groups). */
function keptByGroup(warning: Warning, groupId: number, context: WarningFilterContext): boolean {
  const group = groupOf(warning, context)
  if (group === groupId) return true
  return group === null && employeeOf(warning) === null
}

/**
 * The group filter keeps that group's warnings, its members' and the facility-wide Besetzung warnings (rules and opening
 * hours of the whole facility); the person filter only that person's.
 */
export function filterWarnings(warnings: Warning[], filter: WarningFilter, context: WarningFilterContext): Warning[] {
  return warnings.filter(warning => (filter.employeeId === null || employeeOf(warning) === filter.employeeId)
    && (filter.groupId === null || keptByGroup(warning, filter.groupId, context)))
}

/** One group of the list, as shown. */
export interface WarningSection {
  category: WarningCategory
  /** Warnings not acknowledged (the count next to the group's name). */
  count: number
  /** Lines from today on (Zeiterfassung: all lines, its past is what counts). */
  current: WarningLine[]
  /** Besetzung and Dienstplan-Lücken: lines of past days, shown folded. */
  past: WarningLine[]
  acknowledged: WarningLine[]
  acknowledgedCount: number
}

export function warningSections(
  warnings: Warning[], acks: WarningAcks, openDays: ReadonlySet<IsoDate>, today: IsoDate, offDays: EmployeeOffDays = new Map(),
): WarningSection[] {
  return WARNING_CATEGORIES.map((category) => {
    const own = warnings.filter(warning => warningCategory(warning) === category)
    const shown = own.filter(warning => !isAcknowledged(warning, acks))
    const acknowledged = own.filter(warning => isAcknowledged(warning, acks))
    const { current, past } = category === 'time' ? { current: shown, past: [] } : splitPast(shown, today)
    return {
      category,
      count: shown.length,
      current: condenseWarnings(current, openDays, offDays),
      past: condenseWarnings(past, openDays, offDays),
      acknowledged: condenseWarnings(acknowledged, openDays, offDays),
      acknowledgedCount: acknowledged.length,
    }
  })
}
