import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { cashClosedMonths, cashEntries, cashLog, cashReceipts } from '../../server/db/schema'
import { MAX_DOCUMENT_BYTES } from '../../server/lib/fileSignature'
import { createBox, updateBox, type CashBoxInput } from '../../server/services/cashBoxes'
import { cashMonth, createEntry, createTransfer, deleteEntry, deleteTransfer } from '../../server/services/cashEntries'
import { readReceipt, removeReceipt, setReceipt } from '../../server/services/cashReceipts'
import type { SessionUser } from '../../shared/types/api'
import { addFacility, addUser, createTestDb, errorCode } from '../helpers/fixtures'

const today = '2026-10-26'
const boxInput: CashBoxInput = { name: 'Hauptkasse', kind: 'cash', groupId: null, startYear: 2026, startMonth: 3, startBalance: 1000 }
const pdf = Buffer.from('%PDF-1.4 receipt')
const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3])

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
  konto = createBox(db, leitung, 1, { ...boxInput, name: 'Konto', kind: 'account', startBalance: 0 })
})

const entry = (date = '2026-03-10') =>
  createEntry(db, leitung, 1, { boxId: main, date, direction: 'out', cents: 500, purpose: 'Bastelmaterial' }, today)
const transfer = () => createTransfer(db, leitung, 1, {
  fromBoxId: main, toBoxId: konto, date: '2026-04-15', cents: 300, purpose: 'Einzahlung',
}, today)
const attach = (id: number, data: Buffer = pdf, filename = 'Rechnung.pdf') => setReceipt(db, leitung, 1, id, { data, filename })
const receiptOf = (id: number) => db.select().from(cashEntries).where(eq(cashEntries.id, id)).get()!.receiptId
const receiptCount = () => db.select().from(cashReceipts).all().length
const close = (boxId: number, month: number) =>
  db.insert(cashClosedMonths).values({ boxId, year: 2026, month, closedAt: '2026-05-01T08:00:00.000Z', closedBy: 'leitung' }).run()
const receiptLog = (boxId: number) => db.select().from(cashLog).where(eq(cashLog.boxId, boxId)).all()
  .filter(line => line.action.startsWith('receipt_')).map(line => [line.action, line.detail, line.month])

describe('cash receipts', () => {
  it('attaches, replaces and removes a receipt with log lines; the replaced one is deleted', () => {
    const id = entry()
    const first = attach(id)
    expect(receiptOf(id)).toBe(first)
    expect(readReceipt(db, 1, first)).toEqual({ data: pdf, mimeType: 'application/pdf', fileName: 'Rechnung.pdf' })
    const second = attach(id, png, 'Kassenbon Bäcker.png')
    expect(receiptOf(id)).toBe(second)
    expect(receiptCount()).toBe(1)
    expect(readReceipt(db, 1, second)).toMatchObject({ mimeType: 'image/png', fileName: 'Kassenbon-Baecker.png' })
    expect(cashMonth(db, 1, main, 2026, 3, today).rows[0]).toMatchObject({ hasReceipt: true, receiptId: second })
    removeReceipt(db, leitung, 1, id)
    expect(receiptOf(id)).toBeNull()
    expect(receiptCount()).toBe(0)
    expect(errorCode(() => removeReceipt(db, leitung, 1, id))).toBe('cash_receipt_not_found')
    expect(receiptLog(main)).toEqual([
      ['receipt_added', 'Ausgabe 10.03.2026, 5,00 €, „Bastelmaterial“: „Rechnung.pdf“', '2026-03'],
      ['receipt_replaced', 'Ausgabe 10.03.2026, 5,00 €, „Bastelmaterial“: „Kassenbon Bäcker.png“', '2026-03'],
      ['receipt_removed', 'Ausgabe 10.03.2026, 5,00 €, „Bastelmaterial“', '2026-03'],
    ])
  })

  it('checks the file type by its content and the size', () => {
    const id = entry()
    expect(errorCode(() => attach(id, Buffer.from('GIF89a'), 'bild.pdf'))).toBe('document_type_invalid')
    const big = Buffer.alloc(MAX_DOCUMENT_BYTES + 1)
    pdf.copy(big)
    expect(errorCode(() => attach(id, big))).toBe('document_too_large')
    expect(receiptCount()).toBe(0)
  })

  it('puts a transfer\'s receipt on both rows and deletes it with the transfer', () => {
    const id = transfer()
    const income = db.select().from(cashEntries).where(eq(cashEntries.boxId, konto)).get()!.id
    const receipt = attach(income)
    expect([receiptOf(id), receiptOf(income)]).toEqual([receipt, receipt])
    expect(receiptLog(main)).toHaveLength(1)
    expect(receiptLog(konto)).toHaveLength(1)
    expect(deleteTransfer(db, leitung, 1, id)).toBe(true)
    expect(receiptCount()).toBe(0)
  })

  it('deletes the receipt with its entry', () => {
    const id = entry()
    attach(id)
    expect(deleteEntry(db, leitung, 1, id)).toBe(true)
    expect(receiptCount()).toBe(0)
    expect(deleteEntry(db, leitung, 1, entry())).toBe(false)
  })

  it('refuses changes in a closed month (also on the other side of a transfer) and in an archived box', () => {
    const id = entry()
    attach(id)
    close(main, 3)
    expect(errorCode(() => attach(id, png))).toBe('cash_month_closed')
    expect(errorCode(() => removeReceipt(db, leitung, 1, id))).toBe('cash_month_closed')
    expect(receiptCount()).toBe(1)

    const transferId = transfer()
    close(konto, 3)
    close(konto, 4)
    expect(errorCode(() => attach(transferId))).toBe('cash_month_closed')
    expect(receiptOf(transferId)).toBeNull()

    const may = entry('2026-05-04')
    updateBox(db, leitung, 1, main, { ...boxInput, archived: true })
    expect(errorCode(() => attach(may))).toBe('cash_box_archived')
  })

  it('answers 404 for entries and receipts of another facility (Review Focus 5)', () => {
    const id = entry()
    const receipt = attach(id)
    expect(errorCode(() => setReceipt(db, leitung, other, id, { data: pdf, filename: 'x.pdf' }))).toBe('cash_entry_not_found')
    expect(errorCode(() => removeReceipt(db, leitung, other, id))).toBe('cash_entry_not_found')
    expect(errorCode(() => readReceipt(db, other, receipt))).toBe('cash_receipt_not_found')
    expect(errorCode(() => readReceipt(db, 1, receipt + 99))).toBe('cash_receipt_not_found')
  })
})
