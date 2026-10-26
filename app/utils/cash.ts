import { parseCents } from '#shared/domain/cash'

/** Cents as typed into an amount field: "12,50" (no thousands separator, no "€"). */
export function centsInput(cents: number): string {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`
}

/** A start balance as typed: like an amount, but 0 (and an empty field) is allowed; null = not readable. */
export function parseStartBalance(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '' || /^0*(?:[.,]0{0,2})?$/.test(trimmed)) return 0
  return parseCents(trimmed)
}

/** The page of a box's month sheet. */
export function cashMonthPath(boxId: number, year: number, month: number): string {
  return `/cash/${boxId}/${year}/${month}`
}
