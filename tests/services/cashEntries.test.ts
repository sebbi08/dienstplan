import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { cashClosedMonths, cashEntries, cashLog } from '../../server/db/schema'
import { createBox, updateBox, type CashBoxInput } from '../../server/services/cashBoxes'
import {
  cashMonth, createEntry, createTransfer, deleteEntry, deleteTransfer, purposeSuggestions, transferText, updateEntry, updateTransfer,
  type CashEntryInput,
} from '../../server/services/cashEntries'
import type { SessionUser } from '../../shared/types/api'
import { addFacility, addUser, createTestDb, errorCode } from '../helpers/fixtures'

const today = '2026-10-26'
const boxInput: CashBoxInput = { name: 'Hauptkasse', kind: 'cash', groupId: null, startYear: 2026, startMonth: 3, startBalance: 1000 }

let db: Db
let leitung: SessionUser
let main: number
let konto: number
let other: number

beforeEach(() => {
  db = createTestDb()
  leitung = addUser(db, 'leitung', 'admin')
  other = addFacility(db, 'Zweite Kita')
  main = createBox(db, leitung, 1, boxInput)
  konto = createBox(db, leitung, 1, { ...boxInput, name: 'Konto', kind: 'account', startMonth: 4, startBalance: 0 })
})

const entry = (input: Partial<CashEntryInput> = {}) =>
  createEntry(db, leitung, 1, { boxId: main, date: '2026-03-10', direction: 'in', cents: 500, purpose: 'Spende', ...input }, today)
const close = (boxId: number, year: number, month: number) =>
  db.insert(cashClosedMonths).values({ boxId, year, month, closedAt: '2026-05-01T08:00:00.000Z', closedBy: 'leitung' }).run()
const logOf = (boxId: number) => db.select().from(cashLog).where(eq(cashLog.boxId, boxId)).all().slice(1)
const rowsOf = (boxId: number) => db.select().from(cashEntries).where(eq(cashEntries.boxId, boxId)).all()
const transfer = (input: Partial<Parameters<typeof createTransfer>[3]> = {}) => createTransfer(db, leitung, 1, {
  fromBoxId: main, toBoxId: konto, date: '2026-04-15', cents: 300, purpose: 'Einzahlung', ...input,
}, today)

describe('cash entries', () => {
  it('creates, changes and deletes an entry with log lines (before → after)', () => {
    const id = entry({ purpose: '  Spende Fest ' })
    expect(rowsOf(main)).toEqual([expect.objectContaining({ id, purpose: 'Spende Fest', cents: 500, direction: 'in', createdBy: leitung.id })])
    updateEntry(db, leitung, 1, id, { date: '2026-03-12', cents: 750, purpose: 'Spende Fest' }, today)
    deleteEntry(db, leitung, 1, id)
    expect(rowsOf(main)).toEqual([])
    expect(logOf(main).map(line => [line.action, line.detail])).toEqual([
      ['entry_created', 'Einnahme 10.03.2026, 5,00 €, „Spende Fest“'],
      ['entry_updated', 'Einnahme: Datum 10.03.2026 → 12.03.2026; Betrag 5,00 € → 7,50 €'],
      ['entry_deleted', 'Einnahme 12.03.2026, 7,50 €, „Spende Fest“'],
    ])
  })

  it('validates amount, purpose and date', () => {
    expect(errorCode(() => entry({ cents: 0 }))).toBe('cash_amount_invalid')
    expect(errorCode(() => entry({ cents: 100_000_001 }))).toBe('cash_amount_invalid')
    expect(errorCode(() => entry({ cents: 12.5 }))).toBe('cash_amount_invalid')
    expect(entry({ cents: 100_000_000 })).toBeGreaterThan(0)
    expect(errorCode(() => entry({ purpose: '   ' }))).toBe('cash_purpose_invalid')
    expect(errorCode(() => entry({ purpose: 'x'.repeat(201) }))).toBe('cash_purpose_invalid')
    expect(errorCode(() => entry({ date: '2026-02-30' }))).toBe('cash_date_invalid')
    expect(errorCode(() => entry({ date: '2026-10-27' }))).toBe('cash_date_future')
    expect(entry({ date: today })).toBeGreaterThan(0)
    expect(errorCode(() => entry({ date: '2026-02-28' }))).toBe('cash_before_start')
    expect(errorCode(() => entry({ direction: 'up' as never }))).toBe('cash_direction_invalid')
  })

  it('refuses writes in closed months, in archived boxes and on entries of another facility', () => {
    const id = entry()
    const april = entry({ date: '2026-04-02' })
    close(main, 2026, 3)
    expect(errorCode(() => entry())).toBe('cash_month_closed')
    expect(errorCode(() => updateEntry(db, leitung, 1, id, { date: '2026-04-01', cents: 500, purpose: 'Spende' }, today))).toBe('cash_month_closed')
    // Moving an entry into a closed month is refused as well.
    expect(errorCode(() => updateEntry(db, leitung, 1, april, { date: '2026-03-30', cents: 500, purpose: 'Spende' }, today))).toBe('cash_month_closed')
    expect(errorCode(() => deleteEntry(db, leitung, 1, id))).toBe('cash_month_closed')

    updateBox(db, leitung, 1, main, { ...boxInput, archived: true })
    expect(errorCode(() => entry({ date: '2026-04-03' }))).toBe('cash_box_archived')
    expect(errorCode(() => deleteEntry(db, leitung, 1, april))).toBe('cash_box_archived')

    // Review Focus 5: another facility's box or entry is not found, not forbidden.
    const foreign = createBox(db, leitung, other, boxInput)
    expect(errorCode(() => entry({ boxId: foreign }))).toBe('cash_box_not_found')
    const foreignEntry = createEntry(db, leitung, other, { boxId: foreign, date: '2026-03-10', direction: 'in', cents: 1, purpose: 'x' }, today)
    expect(errorCode(() => updateEntry(db, leitung, 1, foreignEntry, { date: '2026-03-10', cents: 2, purpose: 'x' }, today))).toBe('cash_entry_not_found')
    expect(errorCode(() => deleteEntry(db, leitung, 1, foreignEntry))).toBe('cash_entry_not_found')
    expect(errorCode(() => cashMonth(db, 1, foreign, 2026, 3))).toBe('cash_box_not_found')
  })

  it('numbers per direction, renumbers after a delete and carries the balance into the next month (Review Focus 2)', () => {
    const first = entry({ date: '2026-03-02', cents: 100, purpose: 'A' })
    entry({ date: '2026-03-05', cents: 200, purpose: 'B' })
    entry({ date: '2026-03-03', direction: 'out', cents: 50, purpose: 'C' })
    const march = cashMonth(db, 1, main, 2026, 3)
    expect(march).toMatchObject({ opening: 1000, income: 300, expense: 50, closing: 1250, negative: false, closed: null })
    expect(march.rows.map(row => [row.purpose, row.number, row.balanceAfter])).toEqual([['A', 1, 1100], ['C', 1, 1050], ['B', 2, 1250]])
    expect(cashMonth(db, 1, main, 2026, 4).opening).toBe(1250)

    deleteEntry(db, leitung, 1, first)
    expect(cashMonth(db, 1, main, 2026, 3).rows.map(row => [row.purpose, row.number])).toEqual([['C', 1], ['B', 1]])
    expect(cashMonth(db, 1, main, 2026, 4).opening).toBe(1150)
    expect(errorCode(() => cashMonth(db, 1, main, 2026, 2))).toBe('cash_before_start')
  })

  it('shows the closing and the month\'s log lines on the sheet', () => {
    close(main, 2026, 3)
    expect(cashMonth(db, 1, main, 2026, 3).closed).toEqual({ at: '2026-05-01T08:00:00.000Z', by: 'leitung' })
    createEntry(db, leitung, 1, { boxId: main, date: '2026-04-02', direction: 'in', cents: 1, purpose: 'x' }, today, new Date('2026-04-02T10:00:00Z'))
    expect(cashMonth(db, 1, main, 2026, 4).log.map(line => line.action)).toEqual(['entry_created'])
    expect(cashMonth(db, 1, main, 2026, 4).box).toMatchObject({ id: main, name: 'Hauptkasse', groupName: null })
  })

  it('flags a negative day in a cash box only', () => {
    entry({ direction: 'out', cents: 1500, purpose: 'Einkauf' })
    expect(cashMonth(db, 1, main, 2026, 3)).toMatchObject({ closing: -500, negative: true })
  })
})

describe('cash transfers', () => {
  it('creates an expense and an income sharing the expense row\'s id', () => {
    const id = transfer()
    const [out] = rowsOf(main)
    const [income] = rowsOf(konto)
    expect(out).toMatchObject({ id, direction: 'out', cents: 300, transferId: id, purpose: 'Umbuchung an Konto: Einzahlung' })
    expect(income).toMatchObject({ direction: 'in', cents: 300, transferId: id, purpose: 'Umbuchung von Hauptkasse: Einzahlung' })
    expect(logOf(main).map(line => line.detail)).toEqual(['an Konto: 15.04.2026, 3,00 €, „Einzahlung“'])
    expect(logOf(konto).map(line => line.detail)).toEqual(['von Hauptkasse: 15.04.2026, 3,00 €, „Einzahlung“'])
    const row = cashMonth(db, 1, konto, 2026, 4).rows[0]!
    expect(row.transfer).toEqual({ otherBoxId: main, otherBoxName: 'Hauptkasse', text: 'Einzahlung' })
    expect(cashMonth(db, 1, main, 2026, 4).closing).toBe(700)
  })

  it('changes and deletes both rows together', () => {
    const id = transfer()
    updateTransfer(db, leitung, 1, id, { date: '2026-04-20', cents: 400, purpose: 'Bank' }, today)
    expect(rowsOf(main)[0]).toMatchObject({ date: '2026-04-20', cents: 400, purpose: 'Umbuchung an Konto: Bank' })
    expect(rowsOf(konto)[0]).toMatchObject({ date: '2026-04-20', cents: 400, purpose: 'Umbuchung von Hauptkasse: Bank' })
    expect(logOf(main).at(-1)).toMatchObject({
      action: 'transfer_updated', detail: 'an Konto: Datum 15.04.2026 → 20.04.2026; Betrag 3,00 € → 4,00 €; Text „Einzahlung“ → „Bank“',
    })
    // Entry routes do not touch one side of a transfer.
    expect(errorCode(() => deleteEntry(db, leitung, 1, rowsOf(konto)[0]!.id))).toBe('cash_entry_is_transfer')
    expect(errorCode(() => updateEntry(db, leitung, 1, id, { date: '2026-04-20', cents: 1, purpose: 'x' }, today))).toBe('cash_entry_is_transfer')
    // Only the expense row's id names the transfer.
    expect(errorCode(() => deleteTransfer(db, leitung, 1, rowsOf(konto)[0]!.id))).toBe('cash_transfer_not_found')
    deleteTransfer(db, leitung, 1, id)
    expect([...rowsOf(main), ...rowsOf(konto)]).toEqual([])
    expect(logOf(konto).at(-1)).toMatchObject({ action: 'transfer_deleted', detail: 'von Hauptkasse: 20.04.2026, 4,00 €, „Bank“' })
  })

  it('refuses a transfer into a month closed in only one of the boxes, writing nothing (Review Focus 1)', () => {
    close(konto, 2026, 4)
    const lines = db.select().from(cashLog).all().length
    expect(errorCode(() => transfer())).toBe('cash_month_closed')
    expect([...rowsOf(main), ...rowsOf(konto)]).toEqual([])
    expect(db.select().from(cashLog).all()).toHaveLength(lines)

    const id = transfer({ date: '2026-05-04' })
    expect(errorCode(() => updateTransfer(db, leitung, 1, id, { date: '2026-04-30', cents: 300, purpose: 'Einzahlung' }, today))).toBe('cash_month_closed')
    close(main, 2026, 3)
    close(main, 2026, 4)
    close(main, 2026, 5)
    expect(errorCode(() => updateTransfer(db, leitung, 1, id, { date: '2026-05-04', cents: 1, purpose: 'x' }, today))).toBe('cash_month_closed')
    expect(errorCode(() => deleteTransfer(db, leitung, 1, id))).toBe('cash_month_closed')
    expect(rowsOf(konto)[0]).toMatchObject({ cents: 300 })
  })

  it('refuses the same box, archived boxes, dates before either start month and other facilities', () => {
    expect(errorCode(() => transfer({ toBoxId: main }))).toBe('cash_transfer_same_box')
    // The account starts in April.
    expect(errorCode(() => transfer({ date: '2026-03-20' }))).toBe('cash_before_start')
    const foreign = createBox(db, leitung, other, boxInput)
    expect(errorCode(() => transfer({ toBoxId: foreign }))).toBe('cash_box_not_found')
    const id = transfer()
    expect(errorCode(() => updateTransfer(db, leitung, other, id, { date: '2026-04-15', cents: 1, purpose: 'x' }, today))).toBe('cash_transfer_not_found')
    expect(errorCode(() => deleteTransfer(db, leitung, other, id))).toBe('cash_transfer_not_found')
    updateBox(db, leitung, 1, konto, { ...boxInput, name: 'Konto', kind: 'account', startMonth: 4, startBalance: 0, archived: true })
    expect(errorCode(() => transfer())).toBe('cash_box_archived')
    expect(errorCode(() => deleteTransfer(db, leitung, 1, id))).toBe('cash_box_archived')
  })

  it('strips the prefix even after a rename', () => {
    expect(transferText('Umbuchung an Konto: Bank', 'out', 'Konto')).toBe('Bank')
    expect(transferText('Umbuchung von Alt: Bank: Teil 2', 'in', 'Neu')).toBe('Bank: Teil 2')
  })
})

describe('purpose suggestions', () => {
  it('lists the facility\'s most used purposes containing the query, at most 8, without transfers', () => {
    entry({ purpose: 'Kaffee' })
    entry({ purpose: 'Kaffee' })
    entry({ purpose: 'Kaffeefilter' })
    entry({ purpose: 'Äpfel' })
    transfer()
    const foreign = createBox(db, leitung, other, boxInput)
    createEntry(db, leitung, other, { boxId: foreign, date: '2026-03-10', direction: 'in', cents: 1, purpose: 'Kaffee fremd' }, today)
    expect(purposeSuggestions(db, 1, 'kaf')).toEqual(['Kaffee', 'Kaffeefilter'])
    expect(purposeSuggestions(db, 1, 'äPF')).toEqual(['Äpfel'])
    expect(purposeSuggestions(db, 1, '')).toEqual(['Kaffee', 'Äpfel', 'Kaffeefilter'])
    for (let index = 0; index < 10; index++) entry({ purpose: `Posten ${index}` })
    expect(purposeSuggestions(db, 1, 'posten')).toHaveLength(8)
  })
})
