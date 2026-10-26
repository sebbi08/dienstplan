import type { CashSheetRow, YearMonth } from './cash'
import { daysInMonth, parseIsoDate, toIsoDate } from './dates'
import type { IsoDate } from './types'

const pad = (value: number) => String(value).padStart(2, '0')

function germanDate(iso: IsoDate): string {
  const { year, month, day } = parseIsoDate(iso)
  return `${pad(day)}.${pad(month)}.${year}`
}

/** Excel-friendly amount: "1234,56", "-12,50" — no thousands separator, no currency. */
function csvAmount(cents: number): string {
  const abs = Math.abs(cents)
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)},${pad(abs % 100)}`
}

function field(value: string): string {
  return /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * Semicolon CSV (UTF-8 with BOM, CRLF) of a box over a month range; `rows` are the
 * monthSheet rows of every month in the range, in order.
 */
export function cashCsv(input: {
  boxName: string
  from: YearMonth
  to: YearMonth
  opening: number
  closing: number
  rows: CashSheetRow[]
}): string {
  const first = toIsoDate(input.from.year, input.from.month, 1)
  const last = toIsoDate(input.to.year, input.to.month, daysInMonth(input.to.year, input.to.month))
  const lines: string[][] = [
    ['Kasse', input.boxName],
    ['Zeitraum', `${germanDate(first)} – ${germanDate(last)}`],
    ['Anfangsbestand', csvAmount(input.opening)],
    ['Endbestand', csvAmount(input.closing)],
    [],
    ['Datum', 'Nr.', 'Art', 'Betrag', 'Verwendungszweck', 'Beleg', 'Bestand'],
    ...input.rows.map((row) => [
      germanDate(row.date),
      String(row.number),
      row.direction === 'in' ? 'Einnahme' : 'Ausgabe',
      csvAmount(row.cents),
      row.purpose,
      row.hasReceipt ? 'ja' : 'nein',
      csvAmount(row.balanceAfter),
    ]),
  ]
  return `﻿${lines.map((line) => line.map(field).join(';')).join('\r\n')}\r\n`
}
