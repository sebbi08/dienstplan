import { describe, expect, it } from 'vitest'
import {
  canClose, formatCents, monthKey, monthSheet, monthsToReopen, parseCents, type CashEntryFact,
} from '../../shared/domain/cash'

const entry = (id: number, date: string, direction: 'in' | 'out', cents: number): CashEntryFact => ({
  id, date, direction, cents, purpose: `Eintrag ${id}`, hasReceipt: false, transferId: null,
})

describe('parseCents', () => {
  it.each([
    ['12,5', 1250], ['12.50', 1250], ['12', 1200], ['0,01', 1], [' 7,30 ', 730], ['1234,56', 123456], [',5', 50],
  ])('accepts %s', (text, cents) => {
    expect(parseCents(text)).toBe(cents)
  })
  it.each(['12,555', '-3', '0', '0,00', 'abc', '', '1.234,56', '1,234.56', '12,', '1 000', '12,5€', '+3'])(
    'rejects %s', (text) => {
      expect(parseCents(text)).toBeNull()
    },
  )
})

describe('formatCents', () => {
  it('formats German amounts', () => {
    expect(formatCents(123456)).toBe('1.234,56 €')
    expect(formatCents(0)).toBe('0,00 €')
    expect(formatCents(5)).toBe('0,05 €')
    expect(formatCents(100000000)).toBe('1.000.000,00 €')
    expect(formatCents(-1250)).toBe('−12,50 €')
  })
})

describe('monthSheet', () => {
  const base = { kind: 'cash' as const, startBalance: 10000, startMonth: { year: 2026, month: 8 } }
  const entries = [
    entry(1, '2026-08-03', 'in', 5000),
    entry(2, '2026-08-10', 'out', 2000),
    entry(3, '2026-09-05', 'out', 1000),
    entry(5, '2026-09-02', 'in', 300),
    entry(4, '2026-09-02', 'in', 200),
    entry(6, '2026-09-20', 'out', 50),
    entry(7, '2026-10-01', 'in', 1),
  ]

  it('uses the start balance as opening of the start month', () => {
    const sheet = monthSheet({ ...base, year: 2026, month: 8, entries: entries.filter((e) => e.date < '2026-09-01') })
    expect(sheet.opening).toBe(10000)
    expect(sheet.income).toBe(5000)
    expect(sheet.expense).toBe(2000)
    expect(sheet.closing).toBe(13000)
    expect(sheet.rows.map((row) => row.balanceAfter)).toEqual([15000, 13000])
  })

  it('carries balances over three months', () => {
    const september = monthSheet({ ...base, year: 2026, month: 9, entries: entries.filter((e) => e.date < '2026-10-01') })
    expect(september.opening).toBe(13000)
    expect(september.income).toBe(500)
    expect(september.expense).toBe(1050)
    expect(september.closing).toBe(12450)
    const october = monthSheet({ ...base, year: 2026, month: 10, entries })
    expect(october.opening).toBe(12450)
    expect(october.closing).toBe(12451)
    expect(october.rows.map((row) => row.id)).toEqual([7])
  })

  it('orders rows by date then id and numbers them per direction', () => {
    const sheet = monthSheet({ ...base, year: 2026, month: 9, entries })
    expect(sheet.rows.map((row) => [row.id, row.number, row.balanceAfter])).toEqual([
      [4, 1, 13200], [5, 2, 13500], [3, 1, 12500], [6, 2, 12450],
    ])
    expect(sheet.rows[0]!.purpose).toBe('Eintrag 4')
  })

  it('renumbers after removing the oldest income and changes the next opening', () => {
    const without = entries.filter((e) => e.id !== 4)
    const sheet = monthSheet({ ...base, year: 2026, month: 9, entries: without })
    expect(sheet.rows.filter((row) => row.direction === 'in').map((row) => [row.id, row.number])).toEqual([[5, 1]])
    expect(sheet.closing).toBe(12250)
    expect(monthSheet({ ...base, year: 2026, month: 10, entries: without }).opening).toBe(12250)
  })

  it('flags a negative running balance only for cash boxes', () => {
    const dip = [entry(1, '2026-08-03', 'out', 15000), entry(2, '2026-08-04', 'in', 20000)]
    const cash = monthSheet({ ...base, year: 2026, month: 8, entries: dip })
    expect(cash.negative).toBe(true)
    expect(cash.closing).toBe(15000)
    expect(monthSheet({ ...base, kind: 'account', year: 2026, month: 8, entries: dip }).negative).toBe(false)
    expect(monthSheet({ ...base, year: 2026, month: 8, entries: [entry(1, '2026-08-03', 'out', 10000)] }).negative)
      .toBe(false)
  })

  it('flags a negative opening even without entries in the month', () => {
    const sheet = monthSheet({ ...base, year: 2026, month: 9, entries: [entry(1, '2026-08-03', 'out', 10001)] })
    expect(sheet.opening).toBe(-1)
    expect(sheet.rows).toEqual([])
    expect(sheet.negative).toBe(true)
  })

  it('ignores a dip within one day that the same day balances out', () => {
    const sameDay = [entry(1, '2026-08-03', 'out', 15000), entry(2, '2026-08-03', 'in', 20000)]
    expect(monthSheet({ ...base, year: 2026, month: 8, entries: sameDay }).negative).toBe(false)
  })
})

describe('canClose', () => {
  const startMonth = { year: 2026, month: 8 }
  it('allows the start month without a previous closing', () => {
    expect(canClose({ year: 2026, month: 8, today: '2026-09-01', startMonth, closed: new Set() })).toBe('ok')
  })
  it('allows closing on the last day of the month', () => {
    expect(canClose({ year: 2026, month: 8, today: '2026-08-31', startMonth, closed: new Set() })).toBe('ok')
  })
  it('rejects a month that is not over', () => {
    expect(canClose({ year: 2026, month: 8, today: '2026-08-30', startMonth, closed: new Set() })).toBe('not_over')
  })
  it('requires the previous month to be closed', () => {
    expect(canClose({ year: 2026, month: 9, today: '2026-10-26', startMonth, closed: new Set() })).toBe('previous_open')
    expect(canClose({ year: 2026, month: 9, today: '2026-10-26', startMonth, closed: new Set(['2026-08']) })).toBe('ok')
  })
  it('rejects an already closed month', () => {
    expect(canClose({ year: 2026, month: 8, today: '2026-10-26', startMonth, closed: new Set(['2026-08']) }))
      .toBe('already_closed')
  })
  it('rejects a month before the start month', () => {
    expect(canClose({ year: 2026, month: 7, today: '2026-10-26', startMonth, closed: new Set() })).toBe('before_start')
  })
  it('handles the year boundary', () => {
    const start = { year: 2026, month: 12 }
    expect(canClose({ year: 2027, month: 1, today: '2027-02-01', startMonth: start, closed: new Set() }))
      .toBe('previous_open')
    expect(canClose({ year: 2027, month: 1, today: '2027-02-01', startMonth: start, closed: new Set(['2026-12']) }))
      .toBe('ok')
  })
})

describe('monthsToReopen', () => {
  it('returns that month and all later closed months, sorted', () => {
    const closed = new Set(['2026-05', '2026-03', '2026-04', '2026-02'])
    expect(monthsToReopen(2026, 3, closed)).toEqual(['2026-03', '2026-04', '2026-05'])
    expect(monthsToReopen(2026, 5, closed)).toEqual(['2026-05'])
  })
  it('builds month keys', () => {
    expect(monthKey(2026, 3)).toBe('2026-03')
  })
})
