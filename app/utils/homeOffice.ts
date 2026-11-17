import { isHomeOffice } from '#shared/domain/stamping'
import { formatTime } from '#shared/domain/time'
import type { DomainEntry } from '#shared/domain/types'
import { de } from '~/locales/de'

/** The day's home-office entries as on the admin time page: „Homeoffice (laut Plan) 8:00–12:00“, one line each. */
export function homeOfficeLines(entries: DomainEntry[]): string[] {
  return entries.filter(isHomeOffice).map(entry => de.time.homeOffice(`${formatTime(entry.start!)}–${formatTime(entry.end!)}`))
}
