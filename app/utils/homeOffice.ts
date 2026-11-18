import { formatDuration, formatTime } from '#shared/domain/time'
import type { FullDayDto, RecordedDayDto } from '#shared/types/api'
import { de } from '~/locales/de'

/** The day's home office counting as recorded, as on the admin time page: „Homeoffice (laut Plan) 8:00–12:00“, one line each. */
export function homeOfficeLines(spans: RecordedDayDto['homeOffice'] | undefined): string[] {
  return (spans ?? []).map(plannedSpanLine)
}

/** One span counting as stamped: „Homeoffice (laut Plan) 8:00–12:00“ or „Arzt (laut Plan) 8:00–9:30“. */
export function plannedSpanLine(span: RecordedDayDto['homeOffice'][number]): string {
  const text = `${formatTime(span.start)}–${formatTime(span.end)}`
  return span.away ? de.time.doctor(text) : de.time.homeOffice(text)
}

/**
 * A whole Büro/VZ day without times on the time page, with the target it credits instead of a time range:
 * „Büro (ganzer Tag): 7:48 (Tagessoll)“, from home „Homeoffice (ganzer Tag): 7:48 (Tagessoll)“.
 */
export function fullDayLine(fullDay: FullDayDto): string {
  return de.time.fullDay(fullDay.homeOffice ? de.time.fullDayHomeOffice : fullDay.label, formatDuration(fullDay.minutes))
}
