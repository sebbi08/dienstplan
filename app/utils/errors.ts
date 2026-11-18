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

/** Refusals of a range that name the refused cell (employee and day), with their text for it. */
const CELL_TEXTS: Record<string, (name: string, date: string) => string> = {
  entries_overlap: de.errors.entries_overlap_cell,
  full_day_needs_target: de.errors.full_day_needs_target_cell,
}

/** The cell a refused range names (employee name and day), if the details carry it. */
function refusedCell(error: unknown): { name: string; date: string } | null {
  const details = (error as { data?: { data?: { details?: { name?: unknown; date?: unknown } } } } | null)?.data?.data?.details
  return typeof details?.name === 'string' && typeof details.date === 'string' ? { name: details.name, date: details.date } : null
}

/** The cell of a week template a refusal names (employee name and weekday, 0 = Monday), if the details carry it. */
function refusedTemplateCell(error: unknown): { name: string; weekday: number } | null {
  const details = (error as { data?: { data?: { details?: { name?: unknown; weekday?: unknown } } } } | null)?.data?.data?.details
  return typeof details?.name === 'string' && typeof details.weekday === 'number' ? { name: details.name, weekday: details.weekday } : null
}

export function errorMessage(error: unknown): string {
  const code = errorCode(error)
  const cellText = code ? CELL_TEXTS[code] : undefined
  const cell = cellText ? refusedCell(error) : null
  if (cellText && cell) return cellText(cell.name, formatDayShort(cell.date, weekday(cell.date)))
  // A week template has weekdays instead of dates: „Anna, Mittwoch: …“.
  const templateCell = refusedTemplateCell(error)
  const day = templateCell ? de.weekdaysLong[templateCell.weekday] : undefined
  if (templateCell && day) return cellText ? cellText(templateCell.name, day) : `${templateCell.name}, ${day}: ${errorTextOf(code)}`
  return errorTextOf(code)
}
