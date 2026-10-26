import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { cashBoxes, cashClosedMonths, cashLog } from '../../server/db/schema'
import { createBox, deleteBox, listBoxes, loadBox, moveBox, updateBox, type CashBoxInput } from '../../server/services/cashBoxes'
import { createEntry, createTransfer, deleteEntry } from '../../server/services/cashEntries'
import { deleteGroup } from '../../server/services/groups'
import type { SessionUser } from '../../shared/types/api'
import { addFacility, addGroup, addUser, createTestDb, errorCode } from '../helpers/fixtures'

const today = '2026-10-26'
const base: CashBoxInput = { name: 'Hauptkasse', kind: 'cash', groupId: null, startYear: 2026, startMonth: 3, startBalance: 5000 }

let db: Db
let leitung: SessionUser
let other: number

beforeEach(() => {
  db = createTestDb()
  leitung = addUser(db, 'leitung', 'admin')
  other = addFacility(db, 'Zweite Kita')
})

const box = (input: Partial<CashBoxInput> = {}, facilityId = 1) => createBox(db, leitung, facilityId, { ...base, ...input })
const logOf = (boxId: number) => db.select().from(cashLog).where(eq(cashLog.boxId, boxId)).all()
const close = (boxId: number, year: number, month: number) =>
  db.insert(cashClosedMonths).values({ boxId, year, month, closedAt: '2026-05-01T08:00:00.000Z', closedBy: 'leitung' }).run()

describe('cash boxes', () => {
  it('creates a box with a log line and lists it with its balance today', () => {
    const id = box()
    expect(loadBox(db, 1, id)).toMatchObject({ name: 'Hauptkasse', kind: 'cash', startBalance: 5000, archived: false, sortOrder: 0 })
    expect(logOf(id)).toEqual([expect.objectContaining({ actor: 'leitung', action: 'box_created' })])
    expect(logOf(id)[0]!.detail).toContain('Hauptkasse (Bar, Einrichtung, ab 03/2026, Anfangsbestand 50,00 €)')
    createEntry(db, leitung, 1, { boxId: id, date: '2026-03-02', direction: 'in', cents: 1250, purpose: 'Spende' }, today)
    createEntry(db, leitung, 1, { boxId: id, date: '2026-04-02', direction: 'out', cents: 250, purpose: 'Kaffee' }, today)
    expect(listBoxes(db, 1, today)).toEqual([expect.objectContaining({
      id, balanceToday: 6000, closedThrough: null, missingReceipts: true, hasEntries: true, groupName: null,
    })])
    // Entries after "today" do not count yet.
    expect(listBoxes(db, 1, '2026-03-31')[0]!.balanceToday).toBe(6250)
  })

  it('validates name, kind, start values and the group', () => {
    expect(errorCode(() => box({ name: '  ' }))).toBe('cash_box_name_required')
    expect(errorCode(() => box({ name: 'x'.repeat(61) }))).toBe('cash_box_name_too_long')
    expect(errorCode(() => box({ startBalance: -1 }))).toBe('cash_start_balance_invalid')
    expect(errorCode(() => box({ startBalance: 1.5 }))).toBe('cash_start_balance_invalid')
    expect(errorCode(() => box({ startMonth: 13 }))).toBe('cash_start_month_invalid')
    expect(errorCode(() => box({ kind: 'gold' as never }))).toBe('cash_box_kind_invalid')
    const foreignGroup = addGroup(db, other, 'Fremde')
    expect(errorCode(() => box({ groupId: foreignGroup }))).toBe('group_not_found')
    expect(box({ startBalance: 0, name: '  Leer ' })).toBeGreaterThan(0)
    expect(db.select().from(cashBoxes).all().map(row => row.name)).toEqual(['Leer'])
  })

  it('keeps names unique per facility regardless of case', () => {
    const id = box()
    expect(errorCode(() => box({ name: 'HAUPTKASSE' }))).toBe('cash_box_name_taken')
    expect(box({ name: 'Hauptkasse' }, other)).toBeGreaterThan(id)
    // Renaming to its own name in another case is fine.
    updateBox(db, leitung, 1, id, { ...base, name: 'hauptkasse', archived: false })
    expect(loadBox(db, 1, id).name).toBe('hauptkasse')
  })

  it('hides boxes of another facility (404, not 403)', () => {
    const foreign = box({}, other)
    expect(errorCode(() => loadBox(db, 1, foreign))).toBe('cash_box_not_found')
    expect(errorCode(() => updateBox(db, leitung, 1, foreign, { ...base, archived: false }))).toBe('cash_box_not_found')
    expect(errorCode(() => deleteBox(db, 1, foreign))).toBe('cash_box_not_found')
    expect(listBoxes(db, 1, today)).toEqual([])
  })

  it('orders facility boxes before group boxes (in group order) and archived ones last', () => {
    const mice = addGroup(db, 1, 'Mäuse')
    const bears = addGroup(db, 1, 'Bären')
    const b1 = box({ name: 'Bären 1', groupId: bears })
    const m1 = box({ name: 'Mäuse 1', groupId: mice })
    const f1 = box({ name: 'Haupt' })
    const f2 = box({ name: 'Konto', kind: 'account' })
    const m2 = box({ name: 'Mäuse 2', groupId: mice })
    updateBox(db, leitung, 1, f1, { ...base, name: 'Haupt', archived: true })
    expect(listBoxes(db, 1, today).map(row => row.id)).toEqual([f2, m1, m2, b1, f1])
    expect(listBoxes(db, 1, today).find(row => row.id === m2)).toMatchObject({ groupName: 'Mäuse', sortOrder: 1 })
  })

  it('moves a box up or down within its scope only', () => {
    const mice = addGroup(db, 1, 'Mäuse')
    const f1 = box({ name: 'Haupt' })
    const f2 = box({ name: 'Konto', kind: 'account' })
    const f3 = box({ name: 'Porto' })
    const m1 = box({ name: 'Mäuse 1', groupId: mice })
    const ids = () => listBoxes(db, 1, today).map(row => row.id)
    moveBox(db, 1, f3, 'up')
    expect(ids()).toEqual([f1, f3, f2, m1])
    moveBox(db, 1, f1, 'down')
    expect(ids()).toEqual([f3, f1, f2, m1])
    // At the ends of a scope nothing moves, not even into the group's boxes.
    moveBox(db, 1, f2, 'down')
    moveBox(db, 1, m1, 'up')
    moveBox(db, 1, f3, 'up')
    expect(ids()).toEqual([f3, f1, f2, m1])
    updateBox(db, leitung, 1, f2, { ...base, name: 'Konto', kind: 'account', archived: true })
    expect(errorCode(() => moveBox(db, 1, f2, 'up'))).toBe('cash_box_archived')
    expect(errorCode(() => moveBox(db, other, f1, 'up'))).toBe('cash_box_not_found')
  })

  it('logs changes with before → after, and archiving separately', () => {
    const group = addGroup(db, 1, 'Mäuse')
    const id = box()
    updateBox(db, leitung, 1, id, { ...base, name: 'Gruppenkasse', groupId: group, startBalance: 6000, archived: true })
    const lines = logOf(id).slice(1)
    expect(lines.map(line => line.action)).toEqual(['box_updated', 'box_archived'])
    expect(lines[0]!.detail).toBe('Name Hauptkasse → Gruppenkasse; Zuordnung Einrichtung → Mäuse; Anfangsbestand 50,00 € → 60,00 €')
    updateBox(db, leitung, 1, id, { ...base, name: 'Gruppenkasse', groupId: group, startBalance: 6000, archived: false })
    expect(logOf(id).at(-1)).toMatchObject({ action: 'box_activated', detail: 'Gruppenkasse' })
    // Nothing changed: no line.
    updateBox(db, leitung, 1, id, { ...base, name: 'Gruppenkasse', groupId: group, startBalance: 6000, archived: false })
    expect(logOf(id)).toHaveLength(4)
  })

  it('changes start month and balance only while the start month is open and not past an entry', () => {
    const id = box()
    createEntry(db, leitung, 1, { boxId: id, date: '2026-04-10', direction: 'in', cents: 100, purpose: 'x' }, today)
    expect(errorCode(() => updateBox(db, leitung, 1, id, { ...base, startMonth: 5, archived: false }))).toBe('cash_entries_before_start')
    updateBox(db, leitung, 1, id, { ...base, startMonth: 4, archived: false })
    close(id, 2026, 4)
    expect(errorCode(() => updateBox(db, leitung, 1, id, { ...base, startMonth: 4, startBalance: 1, archived: false }))).toBe('cash_month_closed')
    expect(errorCode(() => updateBox(db, leitung, 1, id, { ...base, startMonth: 3, archived: false }))).toBe('cash_month_closed')
    // Name and kind may still change.
    updateBox(db, leitung, 1, id, { ...base, startMonth: 4, name: 'Neu', kind: 'account', archived: false })
    expect(loadBox(db, 1, id)).toMatchObject({ name: 'Neu', kind: 'account', startMonth: 4 })
  })

  it('deletes only boxes without entries', () => {
    const id = box()
    const empty = box({ name: 'Leer' })
    createEntry(db, leitung, 1, { boxId: id, date: '2026-03-02', direction: 'in', cents: 100, purpose: 'x' }, today)
    expect(errorCode(() => deleteBox(db, 1, id))).toBe('cash_box_has_entries')
    // Box lines only (created, changed, archived): the box and these lines may go.
    updateBox(db, leitung, 1, empty, { ...base, name: 'Leer', archived: true })
    deleteBox(db, 1, empty)
    expect(errorCode(() => loadBox(db, 1, empty))).toBe('cash_box_not_found')
    expect(logOf(empty)).toEqual([])
  })

  it('keeps a box whose log has more than box lines, even without entries now', () => {
    const id = box()
    const entry = createEntry(db, leitung, 1, { boxId: id, date: '2026-03-02', direction: 'in', cents: 100, purpose: 'x' }, today)
    deleteEntry(db, leitung, 1, entry)
    expect(errorCode(() => deleteBox(db, 1, id))).toBe('cash_box_has_history')
    expect(logOf(id).map(line => line.action)).toEqual(['box_created', 'entry_created', 'entry_deleted'])
    // A closing alone counts as history as well (Task 3 logs it).
    const closed = box({ name: 'Geschlossen' })
    db.insert(cashLog).values({ boxId: closed, at: '2026-04-01T08:00:00.000Z', actor: 'leitung', action: 'month_closed', detail: '03/2026', month: '2026-03' }).run()
    expect(errorCode(() => deleteBox(db, 1, closed))).toBe('cash_box_has_history')
    // The overview says so up front (the dialog offers „Löschen“ only then).
    const fresh = box({ name: 'Frisch' })
    updateBox(db, leitung, 1, fresh, { ...base, name: 'Frisch', archived: true })
    const deletable = new Map(listBoxes(db, 1, today).map(row => [row.id, row.canDelete]))
    expect(Object.fromEntries(deletable)).toEqual({ [id]: false, [closed]: false, [fresh]: true })
  })

  it('refuses a start month after the running month', () => {
    const now = new Date('2026-10-26T10:00:00Z')
    expect(errorCode(() => createBox(db, leitung, 1, { ...base, startYear: 2026, startMonth: 11 }, now))).toBe('cash_start_future')
    expect(errorCode(() => createBox(db, leitung, 1, { ...base, startYear: 2027, startMonth: 1 }, now))).toBe('cash_start_future')
    const id = createBox(db, leitung, 1, { ...base, startYear: 2026, startMonth: 10 }, now)
    expect(errorCode(() => updateBox(db, leitung, 1, id, { ...base, startYear: 2026, startMonth: 12, archived: false }, now))).toBe('cash_start_future')
    expect(loadBox(db, 1, id)).toMatchObject({ startYear: 2026, startMonth: 10 })
  })

  it('reports the closed months and missing receipts of the open period only', () => {
    const id = box()
    const target = box({ name: 'Konto', kind: 'account' })
    createEntry(db, leitung, 1, { boxId: id, date: '2026-03-02', direction: 'out', cents: 100, purpose: 'Kaffee' }, today)
    close(id, 2026, 3)
    // A transfer's receipt is optional; incomes need none.
    createTransfer(db, leitung, 1, { fromBoxId: id, toBoxId: target, date: '2026-04-02', cents: 100, purpose: 'Umbuchung' }, today)
    createEntry(db, leitung, 1, { boxId: id, date: '2026-04-03', direction: 'in', cents: 100, purpose: 'Spende' }, today)
    expect(listBoxes(db, 1, today).find(row => row.id === id)).toMatchObject({ closedThrough: { year: 2026, month: 3 }, missingReceipts: false })
    close(id, 2026, 4)
    expect(listBoxes(db, 1, today).find(row => row.id === id)!.closedThrough).toEqual({ year: 2026, month: 4 })
  })

  it('blocks deleting a group that still has boxes', () => {
    const group = addGroup(db, 1, 'Mäuse')
    const id = box({ groupId: group })
    updateBox(db, leitung, 1, id, { ...base, groupId: group, archived: true })
    expect(errorCode(() => deleteGroup(db, 1, group, today))).toBe('group_has_cash_boxes')
    updateBox(db, leitung, 1, id, { ...base, groupId: null, archived: true })
    deleteGroup(db, 1, group, today)
  })
})
