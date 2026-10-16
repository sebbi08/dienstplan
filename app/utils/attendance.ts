import { formatTime, parseTime } from '#shared/domain/time'
import { nowInBerlin } from '#shared/domain/timeRecords'
import type { Minutes } from '#shared/domain/types'
import type { AbsenceKind, AttendanceChildDto, MonthCell } from '#shared/types/api'
import { de } from '~/locales/de'

/** The sign of a cell in the month table: ✓ here, K sick, U vacation, E excused, – unexcused, nothing for an empty day. */
export const MONTH_CELL_SYMBOL: Record<MonthCell, string> = {
  present: '✓', sick: 'K', vacation: 'U', excused: 'E', unexcused: '–', none: '',
}

/** The kinds of absence in the order the dialog offers them. */
export const ABSENCE_KINDS: AbsenceKind[] = ['sick', 'vacation', 'excused']

/** A typed clock time as minutes of the day (0:00–23:59); null when it cannot be read. */
export function parseClock(value: string): Minutes | null {
  const minutes = parseTime(value)
  return minutes === null || minutes > 1439 ? null : minutes
}

/** The current minute of the day in Berlin as "h:mm" (the dialogs' default time). */
export function nowClock(): string {
  return formatTime(nowInBerlin(new Date()).minutes)
}

/** A row's status as the list shows it: "da seit 7:45", "abgeholt 15:10 · Mama", "krank", "noch nicht da" … */
export function attendanceStatusText(child: AttendanceChildDto): string {
  const last = child.stays[child.stays.length - 1]
  switch (child.status) {
    case 'present': return de.attendance.presentSince(last ? formatTime(last.arrived) : '')
    case 'gone': return last?.left != null ? de.attendance.goneAt(formatTime(last.left), last.pickedUpBy) : de.attendance.goneAt('', null)
    case 'not_yet': return de.attendance.notYet
    default: return de.attendance.absence[child.status]
  }
}

/** A stay as "7:45–15:10 · Mama", an open one as "7:45–…". */
export function stayText(stay: AttendanceChildDto['stays'][number]): string {
  const span = `${formatTime(stay.arrived)}–${stay.left === null ? '…' : formatTime(stay.left)}`
  return stay.pickedUpBy ? `${span} · ${stay.pickedUpBy}` : span
}

/** The German name of a logged field of an attendance day (the raw name for one this list does not know). */
export function historyFieldLabel(field: string): string {
  return de.attendance.history.fields[field] ?? field
}

/** A logged value as text: absences and meal ticks in words, '' as "(leer)" (or "automatisch" for the meals). */
export function historyValueText(field: string, value: string): string {
  const h = de.attendance.history
  if (field === 'snack' || field === 'lunch') return value === 'true' ? h.yes : value === 'false' ? h.no : h.automatic
  if (value === '') return h.emptyValue
  if (field === 'absence' && (ABSENCE_KINDS as string[]).includes(value)) return de.attendance.absence[value as AbsenceKind]
  return value
}
