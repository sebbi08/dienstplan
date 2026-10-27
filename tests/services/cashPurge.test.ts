import { eq, inArray } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { cashBoxes, cashClosedMonths, cashEntries, cashLog, cashReceipts } from '../../server/db/schema'
import { ServiceError } from '../../server/lib/errors'
import { createBox, deleteBox, listBoxes, updateBox, type CashBoxInput } from '../../server/services/cashBoxes'
import { cashMonth, createEntry, createTransfer, deleteEntry } from '../../server/services/cashEntries'
import { purgeBox } from '../../server/services/cashPurge'
import { setReceipt } from '../../server/services/cashReceipts'
import { foreignKeyViolations } from '../../server/services/employeeDeletion'
import { setRetentionSettings } from '../../server/services/retentionSettings'
import { RETENTION_DEFAULTS } from '../../shared/domain/retention'
import type { SessionUser } from '../../shared/types/api'
import { addFacility, addUser, createTestDb, errorCode } from '../helpers/fixtures'

const today = '2026-10-26'
const base: CashBoxInput = { name: 'Hauptkasse', kind: 'cash', groupId: null, startYear: 2026, startMonth: 3, startBalance: 5000 }
const pdf = Buffer.from('%PDF-1.4 receipt')

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
  main = createBox(db, leitung, 1, base)
  konto = createBox(db, leitung, 1, { ...base, name: 'Konto', kind: 'account', startBalance: 0 })
})

const archive = (id: number, name = 'Hauptkasse', archived = true) =>
  updateBox(db, leitung, 1, id, { ...base, name, archived })
const entry = (boxId: number, date: string, purpose = 'Bastelmaterial') =>
  createEntry(db, leitung, 1, { boxId, date, direction: 'out', cents: 500, purpose }, today)
const statusOf = (fn: () => unknown) => {
  try {
    fn()
    return null
  }
  catch (error) {
    return error instanceof ServiceError ? error.statusCode : null
  }
}
const rowsOf = (boxId: number) => db.select().from(cashEntries).where(eq(cashEntries.boxId, boxId)).all()

describe('purging an archived cash box after the retention period', () => {
  it('is refused until 31.12.2036 for a last entry on 10.03.2026 and 10 years, allowed on 01.01.2037 (Review Focus 5)', () => {
    entry(main, '2026-03-02')
    entry(main, '2026-03-10')
    archive(main)
    expect(listBoxes(db, 1, today).find(box => box.id === main)!.deletableFrom).toBe('2037-01-01')
    expect(errorCode(() => purgeBox(db, leitung, 1, main, 'Hauptkasse', '2036-12-31'))).toBe('cash_box_retention')
    expect(statusOf(() => purgeBox(db, leitung, 1, main, 'Hauptkasse', '2036-12-31'))).toBe(409)
    expect(db.select().from(cashBoxes).where(eq(cashBoxes.id, main)).get()).toBeDefined()
    purgeBox(db, leitung, 1, main, 'Hauptkasse', '2037-01-01')
    expect(db.select().from(cashBoxes).where(eq(cashBoxes.id, main)).get()).toBeUndefined()
    expect(rowsOf(main)).toEqual([])
  })

  it('takes the facility period: 2 years → from 01.01.2029', () => {
    setRetentionSettings(db, 1, { ...RETENTION_DEFAULTS, cashYears: 2 })
    entry(main, '2026-03-10')
    archive(main)
    expect(listBoxes(db, 1, today).find(box => box.id === main)!.deletableFrom).toBe('2029-01-01')
    expect(errorCode(() => purgeBox(db, leitung, 1, main, 'Hauptkasse', '2028-12-31'))).toBe('cash_box_retention')
    purgeBox(db, traeger, 1, main, 'Hauptkasse', '2029-01-01')
    expect(db.select().from(cashBoxes).where(eq(cashBoxes.id, main)).get()).toBeUndefined()
  })

  it('deletes box, entries, receipts, closed months and log; the counterpart of a transfer stays as a plain entry', () => {
    const own = entry(main, '2026-03-10')
    setReceipt(db, leitung, 1, own, { data: pdf, filename: 'Rechnung.pdf' })
    const out = createTransfer(db, leitung, 1, { fromBoxId: main, toBoxId: konto, date: '2026-03-05', cents: 300, purpose: 'Einzahlung' }, today)
    const back = createTransfer(db, leitung, 1, { fromBoxId: konto, toBoxId: main, date: '2026-03-06', cents: 100, purpose: 'Wechselgeld' }, today)
    // A transfer's receipt belongs to both rows: it stays with the counterpart.
    setReceipt(db, leitung, 1, out, { data: pdf, filename: 'Einzahlung.pdf' })
    db.insert(cashClosedMonths).values({ boxId: main, year: 2026, month: 3, closedAt: '2026-04-01T08:00:00.000Z', closedBy: 'leitung' }).run()
    archive(main)
    const kontoBefore = rowsOf(konto)
    expect(kontoBefore.map(row => row.purpose)).toEqual(['Umbuchung von Hauptkasse: Einzahlung', 'Umbuchung an Hauptkasse: Wechselgeld'])

    purgeBox(db, leitung, 1, main, 'Hauptkasse', '2037-01-01')

    expect(db.select().from(cashBoxes).where(eq(cashBoxes.id, main)).get()).toBeUndefined()
    expect(rowsOf(main)).toEqual([])
    expect(db.select().from(cashClosedMonths).where(eq(cashClosedMonths.boxId, main)).all()).toEqual([])
    expect(db.select().from(cashLog).where(eq(cashLog.boxId, main)).all()).toEqual([])
    // The own receipt went, the transfer's receipt stays with the counterpart.
    const kontoAfter = rowsOf(konto)
    expect(db.select().from(cashReceipts).all().map(row => row.name)).toEqual(['Einzahlung.pdf'])
    expect(kontoAfter.map(row => ({ id: row.id, purpose: row.purpose, cents: row.cents, transferId: row.transferId, transferText: row.transferText })))
      .toEqual(kontoBefore.map(row => ({ id: row.id, purpose: row.purpose, cents: row.cents, transferId: null, transferText: null })))
    expect(kontoAfter[0]!.receiptId).toBe(kontoBefore[0]!.receiptId)
    // The other box's sheet shows them as plain entries; its log says why.
    const sheet = cashMonth(db, 1, konto, 2026, 3, today)
    expect(sheet.rows.map(row => [row.purpose, row.transfer])).toEqual([
      ['Umbuchung von Hauptkasse: Einzahlung', null], ['Umbuchung an Hauptkasse: Wechselgeld', null],
    ])
    expect(db.select().from(cashLog).where(eq(cashLog.boxId, konto)).all().filter(line => line.action === 'transfer_unlinked'))
      .toHaveLength(2)
    // The way back started in Konto: its expense row (the transfer's own id) is a plain expense now.
    expect(kontoAfter.find(row => row.id === back)).toMatchObject({ direction: 'out', cents: 100, transferId: null })
    expect(foreignKeyViolations(db)).toEqual([])
  })

  it('unlinks a counterpart in a closed month of the other box as well; that month stays closed', () => {
    createTransfer(db, leitung, 1, { fromBoxId: main, toBoxId: konto, date: '2026-03-05', cents: 300, purpose: 'Einzahlung' }, today)
    db.insert(cashClosedMonths).values({ boxId: konto, year: 2026, month: 3, closedAt: '2026-04-01T08:00:00.000Z', closedBy: 'leitung' }).run()
    archive(main)
    purgeBox(db, leitung, 1, main, 'Hauptkasse', '2037-01-01')
    expect(rowsOf(konto)).toEqual([expect.objectContaining({ purpose: 'Umbuchung von Hauptkasse: Einzahlung', transferId: null })])
    expect(db.select().from(cashClosedMonths).where(eq(cashClosedMonths.boxId, konto)).all()).toHaveLength(1)
    expect(db.select().from(cashLog).where(eq(cashLog.boxId, konto)).all().filter(line => line.action === 'transfer_unlinked'))
      .toEqual([expect.objectContaining({ month: '2026-03' })])
    expect(foreignKeyViolations(db)).toEqual([])
  })

  it('keeps an archived box without entries but with history until its period has run', () => {
    // An entry made and deleted on 10.03.2026: the log keeps the box (the plain delete refuses it).
    const at = new Date('2026-03-10T10:00:00.000Z')
    deleteEntry(db, leitung, 1, createEntry(db, leitung, 1, { boxId: main, date: '2026-03-10', direction: 'in', cents: 500, purpose: 'Spende' }, today, at), at)
    archive(main)
    const listed = listBoxes(db, 1, today).find(box => box.id === main)!
    expect(listed).toMatchObject({ hasEntries: false, canDelete: false, deletableFrom: '2037-01-01' })
    expect(errorCode(() => deleteBox(db, 1, main))).toBe('cash_box_has_history')
    expect(errorCode(() => purgeBox(db, leitung, 1, main, 'Hauptkasse', today))).toBe('cash_box_retention')
    expect(errorCode(() => purgeBox(db, leitung, 1, main, 'Hauptkasse', '2036-12-31'))).toBe('cash_box_retention')
    purgeBox(db, leitung, 1, main, 'Hauptkasse', '2037-01-01')
    expect(db.select().from(cashBoxes).where(eq(cashBoxes.id, main)).get()).toBeUndefined()
    expect(db.select().from(cashLog).where(eq(cashLog.boxId, main)).all()).toEqual([])
  })

  it('counts the end of the latest closed month when it is later than the log', () => {
    const at = new Date('2026-03-10T10:00:00.000Z')
    deleteEntry(db, leitung, 1, createEntry(db, leitung, 1, { boxId: main, date: '2026-03-10', direction: 'in', cents: 500, purpose: 'Spende' }, today, at), at)
    db.insert(cashClosedMonths).values({ boxId: main, year: 2027, month: 2, closedAt: '2027-03-01T08:00:00.000Z', closedBy: 'leitung' }).run()
    archive(main)
    expect(listBoxes(db, 1, today).find(box => box.id === main)!.deletableFrom).toBe('2038-01-01')
    expect(errorCode(() => purgeBox(db, leitung, 1, main, 'Hauptkasse', '2037-12-31'))).toBe('cash_box_retention')
    purgeBox(db, leitung, 1, main, 'Hauptkasse', '2038-01-01')
    expect(db.select().from(cashBoxes).where(eq(cashBoxes.id, main)).get()).toBeUndefined()
  })

  it('needs an archived box (409 cash_box_not_archived)', () => {
    entry(main, '2026-03-10')
    expect(errorCode(() => purgeBox(db, leitung, 1, main, 'Hauptkasse', '2037-01-01'))).toBe('cash_box_not_archived')
    expect(statusOf(() => purgeBox(db, leitung, 1, main, 'Hauptkasse', '2037-01-01'))).toBe(409)
  })

  it('needs the exact box name (400 cash_box_confirm_mismatch); spaces and Unicode forms count as in the employee deletion', () => {
    entry(main, '2026-03-10')
    archive(main, 'Kasse Mäuse')
    for (const typed of ['', 'kasse mäuse', 'Kasse', 'Kasse Mause']) {
      expect(errorCode(() => purgeBox(db, leitung, 1, main, typed, '2037-01-01'))).toBe('cash_box_confirm_mismatch')
      expect(statusOf(() => purgeBox(db, leitung, 1, main, typed, '2037-01-01'))).toBe(400)
    }
    expect(rowsOf(main)).toHaveLength(1)
    purgeBox(db, leitung, 1, main, '  Kasse   Mäuse ', '2037-01-01')
    expect(rowsOf(main)).toEqual([])
  })

  it('is for Leitung and Träger only (Mitarbeiter 403)', () => {
    entry(main, '2026-03-10')
    archive(main)
    const staff = addUser(db, 'mia', 'observer', null, 1)
    expect(errorCode(() => purgeBox(db, staff, 1, main, 'Hauptkasse', '2037-01-01'))).toBe('forbidden')
    expect(statusOf(() => purgeBox(db, staff, 1, main, 'Hauptkasse', '2037-01-01'))).toBe(403)
    expect(rowsOf(main)).toHaveLength(1)
  })

  it('does not reach a box of another facility (404)', () => {
    const foreign = createBox(db, leitung, other, { ...base, name: 'Fremde' })
    createEntry(db, leitung, other, { boxId: foreign, date: '2026-03-10', direction: 'in', cents: 500, purpose: 'Spende' }, today)
    updateBox(db, leitung, other, foreign, { ...base, name: 'Fremde', archived: true })
    expect(errorCode(() => purgeBox(db, leitung, 1, foreign, 'Fremde', '2037-01-01'))).toBe('cash_box_not_found')
    expect(rowsOf(foreign)).toHaveLength(1)
  })

  it('lets an archived box with neither entries nor history go at once; active boxes carry their date as well', () => {
    entry(konto, '2026-04-01')
    const listed = listBoxes(db, 1, today)
    expect(listed.find(box => box.id === main)).toMatchObject({ canDelete: true, deletableFrom: null })
    expect(listed.find(box => box.id === konto)!.deletableFrom).toBe('2037-01-01')
    archive(main)
    purgeBox(db, leitung, 1, main, 'Hauptkasse', today)
    expect(db.select().from(cashBoxes).where(inArray(cashBoxes.id, [main])).all()).toEqual([])
  })
})
