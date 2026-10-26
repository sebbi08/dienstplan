import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { cashClosedMonths, cashLog } from '../../server/db/schema'
import { csvResponseHeaders } from '../../server/lib/documentHttp'
import { createBox, updateBox, type CashBoxInput } from '../../server/services/cashBoxes'
import { boxCsv, closeMonth, reopenMonth } from '../../server/services/cashClosing'
import { cashMonth, createEntry, createTransfer, deleteEntry, updateEntry } from '../../server/services/cashEntries'
import type { SessionUser } from '../../shared/types/api'
import { addFacility, addUser, createTestDb, errorCode } from '../helpers/fixtures'

const today = '2026-10-26'
const boxInput: CashBoxInput = { name: 'Hauptkasse', kind: 'cash', groupId: null, startYear: 2026, startMonth: 3, startBalance: 1000 }

let db: Db
let leitung: SessionUser
let traeger: SessionUser
let main: number
let konto: number
let other: number

beforeEach(() => {
  db = createTestDb()
  leitung = addUser(db, 'leitung', 'admin')
  traeger = addUser(db, 'traeger', 'provider')
  other = addFacility(db, 'Zweite Kita')
  main = createBox(db, leitung, 1, boxInput)
  konto = createBox(db, leitung, 1, { ...boxInput, name: 'Konto', kind: 'account', startBalance: 0 })
})

const close = (month: number, boxId = main, day = today) => closeMonth(db, leitung, 1, boxId, 2026, month, day)
const closedOf = (boxId: number) => db.select().from(cashClosedMonths).where(eq(cashClosedMonths.boxId, boxId)).all()
  .map(row => `${row.year}-${String(row.month).padStart(2, '0')}`).sort()
const logOf = (boxId: number, action: string) => db.select().from(cashLog).where(eq(cashLog.boxId, boxId)).all()
  .filter(line => line.action === action)
const entry = (date: string, cents = 500, direction: 'in' | 'out' = 'in', purpose = 'Spende') =>
  createEntry(db, leitung, 1, { boxId: main, date, direction, cents, purpose }, today)

describe('closing a month', () => {
  it('closes in order: the start month first, each after its previous one, only once it is over', () => {
    expect(errorCode(() => close(2))).toBe('cash_close_before_start')
    expect(errorCode(() => close(4))).toBe('cash_close_previous_open')
    close(3, main, '2026-04-01')
    expect(errorCode(() => close(3))).toBe('cash_close_already_closed')
    close(4)
    // The running month: not before its last day.
    expect(errorCode(() => closeMonth(db, leitung, 1, main, 2026, 10, '2026-10-30'))).toBe('cash_close_not_over')
    expect(closedOf(main)).toEqual(['2026-03', '2026-04'])
    const [line] = logOf(main, 'month_closed')
    expect(line).toMatchObject({ actor: 'leitung', detail: 'Monat 03/2026', month: '2026-03' })
    expect(db.select().from(cashClosedMonths).where(eq(cashClosedMonths.boxId, main)).get()).toMatchObject({ closedBy: 'leitung' })
  })

  it('closes the running month on its last day', () => {
    for (const month of [3, 4, 5, 6, 7, 8, 9]) close(month)
    close(10, main, '2026-10-31')
    expect(closedOf(main)).toContain('2026-10')
  })

  it('blocks entries, transfers and start values in a closed month', () => {
    const id = entry('2026-03-10')
    close(3)
    expect(errorCode(() => entry('2026-03-11'))).toBe('cash_month_closed')
    expect(errorCode(() => updateEntry(db, leitung, 1, id, { date: '2026-03-10', cents: 900, purpose: 'Spende' }, today))).toBe('cash_month_closed')
    expect(errorCode(() => deleteEntry(db, leitung, 1, id))).toBe('cash_month_closed')
    expect(errorCode(() => createTransfer(db, leitung, 1, {
      fromBoxId: konto, toBoxId: main, date: '2026-03-20', cents: 100, purpose: 'Wechselgeld',
    }, today))).toBe('cash_month_closed')
    expect(errorCode(() => updateBox(db, leitung, 1, main, { ...boxInput, startBalance: 2000, archived: false }))).toBe('cash_month_closed')
    expect(errorCode(() => updateBox(db, leitung, 1, main, { ...boxInput, startMonth: 2, archived: false }))).toBe('cash_month_closed')
    // April stays open.
    expect(entry('2026-04-01')).toBeGreaterThan(0)
  })

  it('refuses a box of another facility with 404', () => {
    const foreign = createBox(db, leitung, other, boxInput)
    expect(errorCode(() => close(3, foreign))).toBe('cash_box_not_found')
    expect(errorCode(() => reopenMonth(db, traeger, 1, foreign, 2026, 3, 'Fehler'))).toBe('cash_box_not_found')
    expect(errorCode(() => boxCsv(db, 1, foreign, 2026, 3, today))).toBe('cash_box_not_found')
  })
})

describe('reopening a month', () => {
  beforeEach(() => {
    for (const month of [3, 4, 5]) close(month)
  })

  it('reopens March, April and May at once, each sheet with one log line naming the reason (Review Focus 3)', () => {
    expect(reopenMonth(db, traeger, 1, main, 2026, 3, '  Beleg vergessen ')).toEqual(['2026-03', '2026-04', '2026-05'])
    expect(closedOf(main)).toEqual([])
    const detail = 'Monate 03/2026, 04/2026, 05/2026 – Begründung: „Beleg vergessen“'
    expect(logOf(main, 'month_reopened').map(line => [line.actor, line.month, line.detail])).toEqual([
      ['traeger', '2026-03', detail], ['traeger', '2026-04', detail], ['traeger', '2026-05', detail],
    ])
    for (const month of [3, 4, 5]) {
      const reopened = cashMonth(db, 1, main, 2026, month, today).log.filter(line => line.action === 'month_reopened')
      expect(reopened.map(line => line.detail)).toEqual([detail])
    }
    expect(entry('2026-04-03')).toBeGreaterThan(0)
  })

  it('reopens only the given and later months', () => {
    expect(reopenMonth(db, traeger, 1, main, 2026, 5, 'Korrektur')).toEqual(['2026-05'])
    expect(closedOf(main)).toEqual(['2026-03', '2026-04'])
    expect(logOf(main, 'month_reopened')[0]!.detail).toBe('Monat 05/2026 – Begründung: „Korrektur“')
  })

  it('is the Träger\'s only, needs a reason and a closed month', () => {
    expect(errorCode(() => reopenMonth(db, leitung, 1, main, 2026, 3, 'Fehler'))).toBe('forbidden')
    expect(errorCode(() => reopenMonth(db, traeger, 1, main, 2026, 3, '   '))).toBe('cash_reopen_reason_invalid')
    expect(errorCode(() => reopenMonth(db, traeger, 1, main, 2026, 3, 'x'.repeat(201)))).toBe('cash_reopen_reason_invalid')
    expect(errorCode(() => reopenMonth(db, traeger, 1, main, 2026, 6, 'Fehler'))).toBe('cash_month_not_closed')
    expect(errorCode(() => reopenMonth(db, traeger, 1, konto, 2026, 3, 'Fehler'))).toBe('cash_month_not_closed')
    expect(closedOf(main)).toEqual(['2026-03', '2026-04', '2026-05'])
  })
})

describe('CSV file', () => {
  it('exports a month with header lines, numbers and balance', () => {
    entry('2026-03-02', 1250, 'in', 'Spende; Fest')
    entry('2026-03-05', 250, 'out', 'Kaffee')
    const file = boxCsv(db, 1, main, 2026, 3, today)
    expect(file.filename).toBe('Kasse-Hauptkasse-2026-03.csv')
    const lines = file.body.replace(/^﻿/, '').split('\r\n')
    expect(lines.slice(0, 4)).toEqual([
      'Kasse;Hauptkasse', 'Zeitraum;01.03.2026 – 31.03.2026', 'Anfangsbestand;10,00', 'Endbestand;20,00',
    ])
    expect(file.body).toContain('02.03.2026;1;Einnahme;12,50;"Spende; Fest";nein;22,50')
    expect(file.body).toContain('05.03.2026;1;Ausgabe;2,50;Kaffee;nein;20,00')
  })

  it('exports the year from the start month to the running month, numbers restarting each month', () => {
    entry('2026-03-02', 100)
    entry('2026-04-02', 200)
    entry('2026-10-02', 300)
    const file = boxCsv(db, 1, main, 2026, null, today)
    expect(file.filename).toBe('Kasse-Hauptkasse-2026.csv')
    const lines = file.body.replace(/^﻿/, '').split('\r\n')
    expect(lines.slice(1, 4)).toEqual(['Zeitraum;01.03.2026 – 31.10.2026', 'Anfangsbestand;10,00', 'Endbestand;16,00'])
    expect(file.body).toContain('02.03.2026;1;Einnahme;1,00')
    expect(file.body).toContain('02.04.2026;1;Einnahme;2,00')
    expect(file.body).toContain('02.10.2026;1;Einnahme;3,00')
    expect(errorCode(() => boxCsv(db, 1, main, 2025, null, today))).toBe('cash_before_start')
    expect(errorCode(() => boxCsv(db, 1, main, 2027, null, today))).toBe('cash_month_future')
    expect(errorCode(() => boxCsv(db, 1, main, 2026, 11, today))).toBe('cash_month_future')
  })

  it('exports a year from January for a box started in an earlier year, with the carried-over opening', () => {
    const old = createBox(db, leitung, 1, { ...boxInput, name: 'Alt', startYear: 2025, startMonth: 11, startBalance: 1000 })
    const add = (date: string, cents: number) =>
      createEntry(db, leitung, 1, { boxId: old, date, direction: 'in', cents, purpose: 'Spende' }, today)
    add('2025-11-05', 200)
    add('2025-12-05', 300)
    add('2026-02-05', 400)
    const lines = boxCsv(db, 1, old, 2026, null, today).body.replace(/^﻿/, '').split('\r\n')
    expect(lines.slice(1, 4)).toEqual(['Zeitraum;01.01.2026 – 31.10.2026', 'Anfangsbestand;15,00', 'Endbestand;19,00'])
    expect(lines.filter(line => /^\d\d\.\d\d\.\d{4};/.test(line))).toEqual(['05.02.2026;1;Einnahme;4,00;Spende;nein;19,00'])
  })

  it('names the file with umlauts kept and other characters replaced', () => {
    const box = createBox(db, leitung, 1, { ...boxInput, name: 'Gruppe Bär/Süß 1' })
    expect(boxCsv(db, 1, box, 2026, 3, today).filename).toBe('Kasse-Gruppe_Bär_Süß_1-2026-03.csv')
  })

  it('is sent as a UTF-8 CSV attachment', () => {
    const headers = csvResponseHeaders('Kasse-Bär-2026.csv')
    expect(headers['Content-Type']).toBe('text/csv; charset=utf-8')
    expect(headers['Content-Disposition']).toBe('attachment; filename="Kasse-B_r-2026.csv"; filename*=UTF-8\'\'Kasse-B%C3%A4r-2026.csv')
  })
})
