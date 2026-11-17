import { formatTime } from '#shared/domain/time'
import type { RecordedDayDto } from '#shared/types/api'
import { de } from '~/locales/de'

/** The day's home office counting as recorded, as on the admin time page: „Homeoffice (laut Plan) 8:00–12:00“, one line each. */
export function homeOfficeLines(spans: RecordedDayDto['homeOffice'] | undefined): string[] {
  return (spans ?? []).map(span => de.time.homeOffice(`${formatTime(span.start)}–${formatTime(span.end)}`))
}
