import { addDays, dateRange } from './dates'
import type { IsoDate } from './types'

/**
 * „Längere Abwesenheit“: a person away for weeks or months is taken out of the roster for that time (only a line
 * „Längere Abwesenheit: N Personen“ below the plan names them), is not missing in the plan's warnings and does not count
 * for the coverage. Entered on the employee page (tab „Gesundheit“, employees.sickness): Langzeitkrank, Kur/Reha and
 * Sonstiges (e.g. a Sabbatical), each from a day to a day or „bis auf Weiteres“. Mutterschutz/Beschäftigungsverbot and
 * Elternzeit are not entered again: their days come from the Mutterschutz booked in the plan and from a full Elternzeit
 * (server/services/longAbsence.ts), so there is one source for each.
 *
 * In the background (shared/domain/targets.ts, shared/domain/balance.ts): Langzeitkrank and Kur/Reha are sick days on
 * each of the person's working days (no public holiday, closure days included), exactly as a whole-day „Krank“ entry –
 * the Stundenkonto credits the daily target, the Krankheitstage and the BEM count them, no leave is used on them
 * (isLeaveWorkday: a closure books no Urlaub there, an Urlaub entry there does not count, § 9 BUrlG) – without a plan
 * entry per day (computed, nothing stored). Kur/Reha counts like Krank (§ 9 EFZG: medical rehabilitation is paid like an incapacity). Sonstiges is
 * unpaid time without target hours: no working days, like a full Elternzeit. The reason is health data: only viewers
 * with employees.sickness see it, everybody else sees „abwesend“.
 */

/** Every reason the roster and the employee page show, in this order. */
export const LONG_ABSENCE_REASONS = ['sick', 'maternity', 'parental_leave', 'rehab', 'other'] as const
export type LongAbsenceReason = typeof LONG_ABSENCE_REASONS[number]
/** The reasons entered as a long absence (Mutterschutz and Elternzeit come from their own entries). */
export const STORED_LONG_ABSENCE_REASONS = ['sick', 'rehab', 'other'] as const
export type StoredLongAbsenceReason = typeof STORED_LONG_ABSENCE_REASONS[number]

/** An entered long absence; `end` null = „bis auf Weiteres“. */
export interface LongAbsencePeriod {
  start: IsoDate
  end: IsoDate | null
  reason: StoredLongAbsenceReason
}

/** The reminder „‹Name› kommt am ‹Datum› zurück“ starts this many days before the first working day after a known end. */
export const LONG_ABSENCE_RETURN_NOTICE_DAYS = 14

/** Langzeitkrank and Kur/Reha: sick days on the working days (credited like „Krank“, counted as Krankheitstage and for the BEM). */
export function countsAsSick(reason: LongAbsenceReason): boolean {
  return reason === 'sick' || reason === 'rehab'
}

/** The period covers the date (an open end covers every day from the start). */
export function covers(period: { start: IsoDate; end: IsoDate | null }, date: IsoDate): boolean {
  return period.start <= date && (period.end === null || date <= period.end)
}

/** The entered long absence on the date (null outside every period). */
export function longAbsenceOn<T extends { start: IsoDate; end: IsoDate | null }>(periods: readonly T[] | undefined, date: IsoDate): T | null {
  return periods?.find(period => covers(period, date)) ?? null
}

/** The period and [from, to] share at least one day. */
export function overlapsRange(period: { start: IsoDate; end: IsoDate | null }, from: IsoDate, to: IsoDate): boolean {
  return period.start <= to && (period.end === null || period.end >= from)
}

/** What refuses saving: an end before the start, a day shared with another long absence of the person. */
export type LongAbsenceError = 'end_before_start' | 'overlap'

export function checkLongAbsence(
  period: { start: IsoDate; end: IsoDate | null }, others: readonly { start: IsoDate; end: IsoDate | null }[],
): LongAbsenceError | null {
  if (period.end !== null && period.end < period.start) return 'end_before_start'
  const overlaps = others.some(other => (other.end === null || other.end >= period.start) && (period.end === null || period.end >= other.start))
  return overlaps ? 'overlap' : null
}

/**
 * The sick days of Langzeitkrank and Kur/Reha from `from` to `to`: each day of such a period that `isCountedDay`
 * accepts (the caller passes the person's working days, as a „Krank“ entry is counted).
 */
export function longSickDates(
  periods: readonly LongAbsencePeriod[] | undefined, from: IsoDate, to: IsoDate, isCountedDay: (date: IsoDate) => boolean,
): IsoDate[] {
  const dates: IsoDate[] = []
  for (const period of periods ?? []) {
    if (!countsAsSick(period.reason) || !overlapsRange(period, from, to)) continue
    const start = period.start > from ? period.start : from
    const end = period.end === null || period.end > to ? to : period.end
    for (const date of dateRange(start, end)) if (isCountedDay(date)) dates.push(date)
  }
  return [...new Set(dates)].sort()
}

/** A span of a long absence as the roster and the employee page show it (`to` null = „bis auf Weiteres“). */
export interface AbsenceSpan<R = LongAbsenceReason> {
  from: IsoDate
  to: IsoDate | null
  reason: R
}

/** The runs of consecutive calendar days of the dates (sorted, each once) as spans of the reason. */
export function spansOfDates<R>(dates: readonly IsoDate[], reason: R): AbsenceSpan<R>[] {
  const spans: AbsenceSpan<R>[] = []
  for (const date of [...new Set(dates)].sort()) {
    const last = spans.at(-1)
    if (last && last.to !== null && addDays(last.to, 1) === date) last.to = date
    else spans.push({ from: date, to: date, reason })
  }
  return spans
}

/**
 * The spans in order of their start, those with the same (shown) reason that overlap or follow each other directly
 * joined into one: a viewer who sees only „abwesend“ cannot tell where one reason ends and the next begins.
 */
export function joinSpans<R>(spans: readonly AbsenceSpan<R>[]): AbsenceSpan<R>[] {
  const sorted = [...spans].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
  const joined: AbsenceSpan<R>[] = []
  for (const span of sorted) {
    const last = joined.at(-1)
    if (last && last.reason === span.reason && (last.to === null || span.from <= addDays(last.to, 1))) {
      if (last.to !== null && (span.to === null || span.to > last.to)) last.to = span.to
    }
    else joined.push({ ...span })
  }
  return joined
}

/** The span covers the date. */
export function spanCovers(span: { from: IsoDate; to: IsoDate | null }, date: IsoDate): boolean {
  return span.from <= date && (span.to === null || date <= span.to)
}

/**
 * Whether the person leaves the shown plan: every day that matters (`days`: the person's contract working days of the
 * range) lies in one of the spans – when there is no such day, at least one span reaches into the range – and nothing
 * is planned for the person to work (`hasDuties`). A duty planned in the period keeps the person in the plan, so it is
 * never hidden.
 */
export function absentThroughout(
  spans: readonly AbsenceSpan<unknown>[], days: readonly IsoDate[], range: { from: IsoDate; to: IsoDate }, hasDuties: boolean,
): boolean {
  if (hasDuties || spans.length === 0) return false
  if (days.length === 0) return spans.some(span => span.from <= range.to && (span.to === null || span.to >= range.from))
  return days.every(date => spans.some(span => spanCovers(span, date)))
}

/** The reminder of a return: from 14 days before the first working day after the end through that day (null otherwise). */
export function longAbsenceReturnState(returnDay: IsoDate, today: IsoDate): 'upcoming' | 'today' | null {
  if (today > returnDay || today < addDays(returnDay, -LONG_ABSENCE_RETURN_NOTICE_DAYS)) return null
  return today === returnDay ? 'today' : 'upcoming'
}
