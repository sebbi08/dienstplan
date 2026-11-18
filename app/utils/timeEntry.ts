import { canBeHomeOffice } from '#shared/domain/balance'
import { parseTime, validateSpan } from '#shared/domain/time'
import type { CodeDto, EntryInput } from '#shared/types/api'
import { de } from '~/locales/de'

/** What the dialog for a special shift or a code with times holds (times as typed). */
export interface TimeEntryForm {
  start: string
  end: string
  breakStart: string
  breakEnd: string
  note: string
  homeOffice: boolean
}

/** A timed code (Büro, VZ) may stay without times: the whole day („Büro (ganzer Tag)“). Never a special shift. */
export function allowsFullDay(code: CodeDto | null): boolean {
  return code?.creditMode === 'timed'
}

/** „Homeoffice – zählt ohne Stempeln“ fits working time only: a special shift or a timed code (Büro, VZ), with or without times. */
export function allowsHomeOffice(code: CodeDto | null): boolean {
  return !code || (code.creditMode === 'timed' && canBeHomeOffice(code.key))
}

/**
 * The entry the dialog sends, or the German error to show. A timed code with empty „Von“ and „Bis“ is the whole day and
 * goes without times; a break needs times.
 */
export function timeEntryInput(form: TimeEntryForm, code: CodeDto | null): { entry: EntryInput } | { error: string } {
  if ([form.start, form.end, form.breakStart, form.breakEnd].some(value => value.trim() && parseTime(value) === null)) {
    return { error: de.common.invalidTime }
  }
  const note = form.note.trim() || null
  const homeOffice = allowsHomeOffice(code) && form.homeOffice
  if (code && allowsFullDay(code) && !form.start.trim() && !form.end.trim()) {
    if (form.breakStart.trim() || form.breakEnd.trim()) return { error: de.modal.fullDayNoBreak }
    return { entry: { kind: 'code', codeId: code.id, note, homeOffice } }
  }
  const start = parseTime(form.start)
  const end = parseTime(form.end)
  if (start === null || end === null) return { error: de.spanErrors.missing_times }
  const breakStart = form.breakStart.trim() ? parseTime(form.breakStart) : null
  const breakEnd = form.breakEnd.trim() ? parseTime(form.breakEnd) : null
  const spanError = validateSpan({ start, end, breakStart, breakEnd })
  if (spanError) return { error: de.spanErrors[spanError] }
  return {
    entry: code
      ? { kind: 'code', codeId: code.id, start, end, breakStart, breakEnd, note, homeOffice }
      : { kind: 'special', start, end, breakStart, breakEnd, note, homeOffice },
  }
}
