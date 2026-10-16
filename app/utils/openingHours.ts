// The label texts are imported relative so a test can load this file.
import type { DayHours, OpeningHours } from '#shared/domain/openingHours'
import { WEEKDAY_BITS } from '#shared/domain/openingHours'
import { formatTime, parseTime } from '#shared/domain/time'
import { de } from '../locales/de'

/** One weekday in the settings form: typed times (empty = not entered) or closed. */
export interface DayForm { open: string; close: string; closed: boolean }

/** The opening hours of the facility or of one group as the form edits them. */
export interface HoursForm { days: DayForm[]; minAtOpening: number; minAtClosing: number }

const WEEKDAY_COUNT = 5

/** The form for saved hours; null (nothing saved) gives an empty form with the default minimum counts. */
export function toHoursForm(hours: OpeningHours | null): HoursForm {
  return {
    days: Array.from({ length: WEEKDAY_COUNT }, (_, index) => {
      const day = hours?.days[index]
      return {
        open: day?.open == null ? '' : formatTime(day.open),
        close: day?.close == null ? '' : formatTime(day.close),
        closed: day?.closed ?? false,
      }
    }),
    minAtOpening: hours?.minAtOpening ?? 1,
    minAtClosing: hours?.minAtClosing ?? 1,
  }
}

/** A minimum count as a number: an emptied field gives '' and becomes 0, which the server rejects as opening_min_invalid. */
function count(value: unknown): number {
  return typeof value === 'number' ? value : Number(value) || 0
}

/** The body to save, or null while a typed time is unreadable. A closed day sends no times. */
export function fromHoursForm(form: HoursForm): OpeningHours | null {
  const days: DayHours[] = []
  for (const day of form.days) {
    if (day.closed) {
      days.push({ open: null, close: null, closed: true })
      continue
    }
    const open = day.open.trim() ? parseTime(day.open) : null
    const close = day.close.trim() ? parseTime(day.close) : null
    if ((day.open.trim() && open === null) || (day.close.trim() && close === null)) return null
    days.push({ open, close, closed: false })
  }
  return { days, minAtOpening: count(form.minAtOpening), minAtClosing: count(form.minAtClosing) }
}

/** Whether any weekday of the hours is entered (times or closed). */
export function hasOwnDays(hours: OpeningHours | null): boolean {
  return hours !== null && hours.days.some(day => day.closed || day.open !== null || day.close !== null)
}

/** A day's hours for the plan header: "7:00–16:30", "geschlossen", null when not entered. */
export function dayHoursText(day: DayHours | null | undefined): string | null {
  if (!day) return null
  if (day.closed) return de.openingHours.closed
  if (day.open === null || day.close === null) return null
  return `${formatTime(day.open)}–${formatTime(day.close)}`
}

/** The weekdays of a weekday mask: "Mo–Do", "Fr", "Mo, Mi–Fr"; empty for all five weekdays. */
export function weekdaysText(mask: number): string {
  const names = de.weekdaysShort.slice(0, WEEKDAY_COUNT)
  const on = WEEKDAY_BITS.map(bit => (mask & bit) !== 0)
  if (on.every(Boolean)) return ''
  const parts: string[] = []
  for (let from = 0; from < on.length; from++) {
    if (!on[from]) continue
    let to = from
    while (on[to + 1]) to++
    parts.push(to - from >= 2 ? `${names[from]}–${names[to]}` : names.slice(from, to + 1).join(', '))
    from = to
  }
  return parts.join(', ')
}
