import { daysInMonth, toIsoDate } from './dates'
import type { IsoDate } from './types'

export type CashKind = 'cash' | 'account'
export type CashDirection = 'in' | 'out'

export interface YearMonth { year: number; month: number }

export interface CashEntryFact {
  id: number
  date: IsoDate
  direction: CashDirection
  cents: number
  purpose: string
  hasReceipt: boolean
  transferId: number | null
}

export type CashSheetRow = CashEntryFact & { number: number; balanceAfter: number }

export interface CashMonthSheet {
  opening: number
  income: number
  expense: number
  closing: number
  negative: boolean
  rows: CashSheetRow[]
}

/** Month key as stored for closings: "2026-03". */
export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

/**
 * Parses a user-typed amount into cents. Comma or dot as decimal separator, at most two
 * decimals, no thousands separators, no sign; zero and anything unparsable give null.
 */
export function parseCents(text: string): number | null {
  const match = /^(\d*)(?:[.,](\d{1,2}))?$/.exec(text.trim())
  if (!match || (match[1] === '' && match[2] === undefined)) return null
  const cents = Number(match[1] || '0') * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null
}

/** "1.234,56 €", negative with a real minus sign. */
export function formatCents(cents: number): string {
  const abs = Math.abs(cents)
  const euros = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const rest = String(abs % 100).padStart(2, '0')
  return `${cents < 0 ? '−' : ''}${euros},${rest} €`
}

function signed(entry: CashEntryFact): number {
  return entry.direction === 'in' ? entry.cents : -entry.cents
}

function byDateThenId(a: CashEntryFact, b: CashEntryFact): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id
}

/**
 * The sheet of one month. `entries` are all entries of the box up to the month's end; the
 * opening is the start balance plus everything before the month. Numbers are given per
 * direction in date/id order; `negative` (cash boxes only) means a day ended below 0.
 */
export function monthSheet(input: {
  kind: CashKind
  startBalance: number
  startMonth: YearMonth
  year: number
  month: number
  entries: CashEntryFact[]
}): CashMonthSheet {
  const first = toIsoDate(input.year, input.month, 1)
  const last = toIsoDate(input.year, input.month, daysInMonth(input.year, input.month))
  let opening = input.startBalance
  const inMonth: CashEntryFact[] = []
  for (const entry of input.entries) {
    if (entry.date < first) opening += signed(entry)
    else if (entry.date <= last) inMonth.push(entry)
  }
  inMonth.sort(byDateThenId)

  const counters: Record<CashDirection, number> = { in: 0, out: 0 }
  let balance = opening
  let income = 0
  let expense = 0
  let negative = opening < 0
  const rows = inMonth.map((entry, index): CashSheetRow => {
    balance += signed(entry)
    if (entry.direction === 'in') income += entry.cents
    else expense += entry.cents
    const endOfDay = inMonth[index + 1]?.date !== entry.date
    if (endOfDay && balance < 0) negative = true
    return { ...entry, number: ++counters[entry.direction], balanceAfter: balance }
  })

  return { opening, income, expense, closing: balance, negative: input.kind === 'cash' && negative, rows }
}

export type CanCloseResult = 'ok' | 'not_over' | 'previous_open' | 'already_closed' | 'before_start'

export function canClose(input: {
  year: number
  month: number
  today: IsoDate
  startMonth: YearMonth
  closed: Set<string>
}): CanCloseResult {
  const key = monthKey(input.year, input.month)
  if (key < monthKey(input.startMonth.year, input.startMonth.month)) return 'before_start'
  if (input.closed.has(key)) return 'already_closed'
  if (input.today < toIsoDate(input.year, input.month, daysInMonth(input.year, input.month))) return 'not_over'
  const isStart = input.year === input.startMonth.year && input.month === input.startMonth.month
  const previous = input.month === 1 ? monthKey(input.year - 1, 12) : monthKey(input.year, input.month - 1)
  if (!isStart && !input.closed.has(previous)) return 'previous_open'
  return 'ok'
}

/** The closed months to reopen: the given month and every later closed month, sorted. */
export function monthsToReopen(year: number, month: number, closed: Set<string>): string[] {
  const key = monthKey(year, month)
  return [...closed].filter((value) => value >= key).sort()
}
