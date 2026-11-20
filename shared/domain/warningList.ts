import type { IsoDate } from './types'
import type { Warning } from './warnings'

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
    case 'maternity':
      // Several rules of a Mutterschutz case can be broken on one day.
      return `${warning.employeeId}|${warning.rule}`
    case 'youth':
      // Several rules of the Jugendarbeitsschutz can be broken on one day.
      return `${warning.employeeId}|${warning.rule}`
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
    case 'max_hours':
    case 'max_hours_recorded':
    case 'long_stretch':
      return String(warning.minutes)
    case 'short_rest':
    case 'short_rest_recorded':
      return `${warning.from}-${warning.to}`
    case 'maternity':
    case 'youth':
      return `${warning.value}/${warning.limit}`
    case 'work_limit':
      // The day's planned minutes, which the editor sees anyway: more work shows the hint again.
      return String(warning.minutes)
    case 'child_sick_days':
      // The same for every viewer (only some see the numbers); a further day moves the warning to that day's key.
      return ''
    default:
      return ''
  }
}

const ID = /^[1-9]\d*$/
/** The subject's format per type, as `subject` writes it. */
const SUBJECT_FORMATS: Record<Warning['type'], RegExp> = {
  missing_entry: ID, target_gap: ID, open_record: ID, missing_record: ID, break_rule: ID, record_without_plan: ID, record_on_absence: ID,
  max_hours: ID, max_hours_recorded: ID, short_rest: ID, short_rest_recorded: ID, long_stretch: ID, child_sick_days: ID,
  work_limit: ID,
  youth_birth_year: ID, youth_birthday: ID,
  maternity: /^[1-9]\d*\|(hours|late|early|sunday|rest|average|doubleWeek|protected|ban)$/,
  youth: /^[1-9]\d*\|(hours|week|days|early|late|saturday|sunday|holiday|rest|break|stretch|schoolDay|schoolBefore|eve|examBan)$/,
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

/** One warning of a day with what „Zur Kenntnis genommen“ needs and whether it is acknowledged. */
export interface DayWarning {
  warning: Warning
  key: string
  signature: string
  acknowledged: boolean
}

/** The icon at the end of a day row: red while one is not acknowledged, grey when all are, none without warnings. */
export type DayWarningState = 'open' | 'acknowledged' | 'none'

export interface DayWarnings {
  items: DayWarning[]
  state: DayWarningState
}

/** A day's warnings (in their order) with their acknowledged state, and the state of the day's icon. */
export function dayWarnings(warnings: Warning[], acks: WarningAcks): DayWarnings {
  const items = warnings.map(warning => ({
    warning, key: warningAckKey(warning), signature: warningSignature(warning), acknowledged: isAcknowledged(warning, acks),
  }))
  const state: DayWarningState = items.length === 0 ? 'none' : items.every(item => item.acknowledged) ? 'acknowledged' : 'open'
  return { items, state }
}
