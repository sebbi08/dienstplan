import { weekday } from '#shared/domain/dates'
import { de } from '../locales/de'
import { formatDayShort } from './format'

/** The `code` of a failed API call ($fetch error), if any. */
export function errorCode(error: unknown): string | undefined {
  return (error as { data?: { data?: { code?: string } } } | null)?.data?.data?.code
}

/** The German text of an error code; unknown codes (and texts that need values) give the generic text. */
export function errorTextOf(code: string | undefined): string {
  const text = code && code in de.errors ? de.errors[code as keyof typeof de.errors] : undefined
  return typeof text === 'string' ? text : de.errors.generic
}

/** The cell a refused range names (entries_overlap of a range: employee name and day), if the details carry it. */
function overlapCell(error: unknown): { name: string; date: string } | null {
  const details = (error as { data?: { data?: { details?: { name?: unknown; date?: unknown } } } } | null)?.data?.data?.details
  return typeof details?.name === 'string' && typeof details.date === 'string' ? { name: details.name, date: details.date } : null
}

export function errorMessage(error: unknown): string {
  const code = errorCode(error)
  const cell = code === 'entries_overlap' ? overlapCell(error) : null
  if (cell) return de.errors.entries_overlap_cell(cell.name, formatDayShort(cell.date, weekday(cell.date)))
  return errorTextOf(code)
}
