import { eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { balanceAdjustments, cashBoxes, cashEntries, childContacts, children, employees, facilities } from '../../server/db/schema'
import { ServiceError } from '../../server/lib/errors'
import { getChildRetentionYears } from '../../server/services/appSettings'
import { createBox, updateBox, type CashBoxInput } from '../../server/services/cashBoxes'
import { createEntry, createTransfer } from '../../server/services/cashEntries'
import {
  categoryHasData, deleteCategories, foreignKeyViolations, RETENTION_CATEGORIES,
} from '../../server/services/employeeDeletion'
import { deleteDueItems, deleteRetentionItem, retentionOverview } from '../../server/services/retentionOverview'
import { setRetentionSettings } from '../../server/services/retentionSettings'
import { purgeDate } from '../../shared/domain/children'
import { RETENTION_DEFAULTS } from '../../shared/domain/retention'
import type { RetentionItemDto, SessionUser } from '../../shared/types/api'
import { employeeReferences, fillEmployeeData } from '../helpers/employeeData'
import { addChild, addEmployee, addFacility, addUser, createTestDb, errorCode } from '../helpers/fixtures'

const LEFT_ON = '2026-03-15'
const cashBase: CashBoxInput = { name: 'Hauptkasse', kind: 'cash', groupId: null, startYear: 2026, startMonth: 3, startBalance: 5000 }

let db: Db
let leitung: SessionUser
let traeger: SessionUser
let tina: number
let ben: number
let hort: number

const statusOf = (fn: () => unknown) => {
  try {
    fn()
    return null
  }
  catch (error) {
    return error instanceof ServiceError ? error.statusCode : null
  }
}
const facilityName = (id: number) => db.select({ name: facilities.name }).from(facilities).where(eq(facilities.id, id)).get()!.name
const itemsOf = (today: string, prefix: string) => retentionOverview(db, today).filter(item => item.key.startsWith(prefix))
const employeeRow = (id: number) => db.select().from(employees).where(eq(employees.id, id)).get()
const remove = (key: string, today: string) => deleteRetentionItem(db, traeger, key, today)

beforeEach(() => {
  db = createTestDb()
  leitung = addUser(db, 'leitung', 'admin', addEmployee(db, 'Lea Leitung'))
  traeger = addUser(db, 'traeger', 'provider')
  tina = addEmployee(db, 'Tina Test')
  ben = addEmployee(db, 'Ben Beispiel')
  hort = addFacility(db, 'Hort')
  fillEmployeeData(db, leitung, [tina, ben], tina, hort)
  addUser(db, 'tina', 'observer', tina)
  db.update(employees).set({ leftOn: LEFT_ON }).where(eq(employees.id, tina)).run()
})

describe('categoryHasData', () => {
  it('says true for every category with data and false once its helper ran; a helper then changes nothing', () => {
    db.insert(balanceAdjustments).values({ employeeId: tina, date: '2026-02-28', minutes: -600, reason: 'Ausgezahlt', paidOut: true }).run()
    expect(categoryHasData(db, tina)).toEqual({ immediate: true, time: true, assessment: true, paidOvertime: true })
    for (const category of RETENTION_CATEGORIES) {
      db.transaction(tx => deleteCategories(tx, tina, [category]))
      expect(categoryHasData(db, tina)[category], category).toBe(false)
      // The guard: what categoryHasData calls empty, the helper does not touch.
      expect(db.transaction(tx => deleteCategories(tx, tina, [category]))[category], category).toBe(0)
    }
    expect(categoryHasData(db, tina)).toEqual({ immediate: false, time: false, assessment: false, paidOvertime: false })
    expect(categoryHasData(db, ben)).toEqual({ immediate: true, time: true, assessment: true, paidOvertime: false })
  })

  it('sees a single cleared field or a single row of a category', () => {
    db.transaction(tx => deleteCategories(tx, tina, RETENTION_CATEGORIES))
    db.update(employees).set({ pinFailed: 2 }).where(eq(employees.id, tina)).run()
    expect(categoryHasData(db, tina).immediate).toBe(true)
    db.update(employees).set({ pinFailed: 0 }).where(eq(employees.id, tina)).run()
    expect(categoryHasData(db, tina).immediate).toBe(false)
    db.insert(balanceAdjustments).values({ employeeId: tina, date: '2026-02-28', minutes: 60, reason: 'Übertrag' }).run()
    expect(categoryHasData(db, tina)).toEqual({ immediate: false, time: true, assessment: false, paidOvertime: false })
  })
})

describe('the retention overview of an employee (Review Focus 2)', () => {
  it('lists nothing before the day after leaving, then one item per category with data and the record', () => {
    expect(itemsOf('2026-03-15', `employee:${tina}:`)).toEqual([])
    const items = itemsOf('2026-03-16', `employee:${tina}:`)
    const name = facilityName(1)
    expect(items).toEqual<RetentionItemDto[]>([
      { key: `employee:${tina}:immediate`, kind: 'employee', category: 'immediate', facilityId: 1, facilityName: name, name: 'Tina Test', deletableFrom: '2026-03-16', due: true },
      { key: `employee:${tina}:time`, kind: 'employee', category: 'time', facilityId: 1, facilityName: name, name: 'Tina Test', deletableFrom: '2029-01-01', due: false },
      { key: `employee:${tina}:assessment`, kind: 'employee', category: 'assessment', facilityId: 1, facilityName: name, name: 'Tina Test', deletableFrom: '2030-01-01', due: false },
      { key: `employee:${tina}:record`, kind: 'employee', category: 'record', facilityId: 1, facilityName: name, name: 'Tina Test', deletableFrom: null, due: false },
    ])
    // Active employees (Ben, Lea) have no items.
    expect(retentionOverview(db, '2026-03-16').filter(item => item.kind === 'employee').map(item => item.name))
      .toEqual(Array(4).fill('Tina Test'))
  })

  it('lists paid overtime only with a paid-out adjustment', () => {
    expect(itemsOf('2026-03-16', `employee:${tina}:paidOvertime`)).toEqual([])
    db.insert(balanceAdjustments).values({ employeeId: tina, date: '2026-02-28', minutes: -600, reason: 'Ausgezahlt', paidOut: true }).run()
    expect(itemsOf('2026-03-16', `employee:${tina}:paidOvertime`)).toMatchObject([{ deletableFrom: '2037-01-01', due: false }])
  })

  it('refuses the immediate data on the leaving day and deletes it the day after', () => {
    expect(errorCode(() => remove(`employee:${tina}:immediate`, '2026-03-15'))).toBe('retention_not_due')
    expect(statusOf(() => remove(`employee:${tina}:immediate`, '2026-03-15'))).toBe(409)
    expect(remove(`employee:${tina}:immediate`, '2026-03-16')).toBeGreaterThan(0)
    expect(categoryHasData(db, tina)).toEqual({ immediate: false, time: true, assessment: true, paidOvertime: false })
    expect(employeeRow(tina)).toMatchObject({ name: 'Tina Test', birthday: null, pinHash: null })
    // The item is gone: deleting it again is 404.
    expect(itemsOf('2026-03-16', `employee:${tina}:immediate`)).toEqual([])
    expect(errorCode(() => remove(`employee:${tina}:immediate`, '2026-03-16'))).toBe('retention_item_not_found')
    expect(statusOf(() => remove(`employee:${tina}:immediate`, '2026-03-16'))).toBe(404)
  })

  it('refuses the time data on 31.12.2028 (409) and deletes only that category on 01.01.2029', () => {
    expect(errorCode(() => remove(`employee:${tina}:time`, '2028-12-31'))).toBe('retention_not_due')
    expect(statusOf(() => remove(`employee:${tina}:time`, '2028-12-31'))).toBe(409)
    expect(categoryHasData(db, tina).time).toBe(true)
    expect(remove(`employee:${tina}:time`, '2029-01-01')).toBeGreaterThan(0)
    expect(categoryHasData(db, tina)).toEqual({ immediate: true, time: false, assessment: true, paidOvertime: false })
    expect(itemsOf('2029-01-01', `employee:${tina}:`).map(item => [item.category, item.due]))
      .toEqual([['immediate', true], ['assessment', false], ['record', false]])
  })

  it('refuses the assessments on 31.12.2029 and the paid overtime on 31.12.2036 (409), deletes them on 1 January', () => {
    db.insert(balanceAdjustments).values({ employeeId: tina, date: '2026-02-28', minutes: -600, reason: 'Ausgezahlt', paidOut: true }).run()
    expect(errorCode(() => remove(`employee:${tina}:assessment`, '2029-12-31'))).toBe('retention_not_due')
    expect(statusOf(() => remove(`employee:${tina}:assessment`, '2029-12-31'))).toBe(409)
    expect(categoryHasData(db, tina).assessment).toBe(true)
    expect(remove(`employee:${tina}:assessment`, '2030-01-01')).toBeGreaterThan(0)
    expect(categoryHasData(db, tina)).toEqual({ immediate: true, time: true, assessment: false, paidOvertime: true })
    expect(errorCode(() => remove(`employee:${tina}:paidOvertime`, '2036-12-31'))).toBe('retention_not_due')
    expect(statusOf(() => remove(`employee:${tina}:paidOvertime`, '2036-12-31'))).toBe(409)
    expect(categoryHasData(db, tina).paidOvertime).toBe(true)
    expect(remove(`employee:${tina}:paidOvertime`, '2037-01-01')).toBe(1)
    expect(categoryHasData(db, tina)).toEqual({ immediate: true, time: true, assessment: false, paidOvertime: false })
  })

  it('makes the record due only once every other category holds no data; then the employee row goes, others untouched', () => {
    const benBefore = employeeReferences(db, ben)
    const benRow = employeeRow(ben)
    db.insert(balanceAdjustments).values({ employeeId: tina, date: '2026-02-28', minutes: -600, reason: 'Ausgezahlt', paidOut: true }).run()
    const today = '2037-01-01'
    expect(itemsOf(today, `employee:${tina}:record`)).toMatchObject([{ deletableFrom: null, due: false }])
    expect(errorCode(() => remove(`employee:${tina}:record`, today))).toBe('retention_not_due')
    for (const category of ['immediate', 'time', 'assessment']) {
      remove(`employee:${tina}:${category}`, today)
      expect(itemsOf(today, `employee:${tina}:record`)[0]!.due).toBe(false)
      expect(errorCode(() => remove(`employee:${tina}:record`, today))).toBe('retention_not_due')
    }
    remove(`employee:${tina}:paidOvertime`, today)
    expect(itemsOf(today, `employee:${tina}:`)).toMatchObject([{ category: 'record', deletableFrom: null, due: true }])
    expect(remove(`employee:${tina}:record`, today)).toBe(1)
    expect(employeeRow(tina)).toBeUndefined()
    expect(itemsOf(today, `employee:${tina}:`)).toEqual([])
    expect(foreignKeyViolations(db)).toEqual([])
    expect(employeeReferences(db, ben)).toEqual(benBefore)
    expect(employeeRow(ben)).toEqual(benRow)
  })

  it('drops the items when the leaving is taken back', () => {
    db.update(employees).set({ leftOn: null }).where(eq(employees.id, tina)).run()
    expect(itemsOf('2030-01-01', `employee:${tina}:`)).toEqual([])
    expect(errorCode(() => remove(`employee:${tina}:immediate`, '2030-01-01'))).toBe('retention_item_not_found')
  })
})

describe('child records and cash boxes in the overview', () => {
  it('lists an archived child with its purge date and deletes the record (contacts with it) once due', () => {
    const leftOn = '2026-03-31'
    const child = addChild(db, 1, { firstName: 'Mia', lastName: 'Muster', leftOn })
    db.insert(childContacts).values({ childId: child, name: 'Mama Muster', relation: 'Mutter', sortOrder: 0 }).run()
    addChild(db, 1, { firstName: 'Noah', lastName: 'Aktiv' })
    const deletableFrom = purgeDate(leftOn, getChildRetentionYears(db))
    expect(itemsOf('2026-03-31', 'child:')).toEqual([])
    expect(itemsOf('2026-04-01', 'child:')).toEqual([{
      key: `child:${child}`, kind: 'child', category: null, facilityId: 1, facilityName: facilityName(1), name: 'Mia Muster',
      deletableFrom, due: false,
    }])
    const dayBefore = new Date(`${deletableFrom}T12:00:00Z`)
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1)
    expect(errorCode(() => remove(`child:${child}`, dayBefore.toISOString().slice(0, 10)))).toBe('retention_not_due')
    expect(remove(`child:${child}`, deletableFrom)).toBe(1)
    expect(db.select().from(children).where(eq(children.id, child)).get()).toBeUndefined()
    expect(db.select().from(childContacts).where(eq(childContacts.childId, child)).all()).toEqual([])
    expect(db.select().from(children).all().map(row => row.firstName)).toContain('Noah')
    expect(foreignKeyViolations(db)).toEqual([])
  })

  it('deletes an archived cash box once due; the counterpart of its transfer stays as a plain entry', () => {
    const main = createBox(db, leitung, 1, cashBase)
    const konto = createBox(db, leitung, 1, { ...cashBase, name: 'Konto', kind: 'account', startBalance: 0 })
    createEntry(db, leitung, 1, { boxId: main, date: '2026-03-10', direction: 'out', cents: 500, purpose: 'Bastelmaterial' },
      '2026-10-26', new Date('2026-03-10T10:00:00.000Z'))
    createTransfer(db, leitung, 1, { fromBoxId: main, toBoxId: konto, date: '2026-03-05', cents: 300, purpose: 'Einzahlung' }, '2026-10-26',
      new Date('2026-03-10T10:00:00.000Z'))
    expect(itemsOf('2026-10-27', 'cash:')).toEqual([])
    updateBox(db, leitung, 1, main, { ...cashBase, archived: true }, new Date('2026-03-10T10:00:00.000Z'))
    expect(itemsOf('2026-10-27', 'cash:')).toEqual([{
      key: `cash:${main}`, kind: 'cash', category: null, facilityId: 1, facilityName: facilityName(1), name: 'Hauptkasse',
      deletableFrom: '2037-01-01', due: false,
    }])
    expect(errorCode(() => remove(`cash:${main}`, '2036-12-31'))).toBe('retention_not_due')
    expect(remove(`cash:${main}`, '2037-01-01')).toBeGreaterThan(0)
    expect(db.select().from(cashBoxes).where(eq(cashBoxes.id, main)).get()).toBeUndefined()
    expect(db.select().from(cashEntries).where(eq(cashEntries.boxId, konto)).all())
      .toEqual([expect.objectContaining({ purpose: 'Umbuchung von Hauptkasse: Einzahlung', transferId: null, transferText: null })])
    expect(foreignKeyViolations(db)).toEqual([])
  })

  it('lists an archived box without entries or history as due without a date', () => {
    const empty = createBox(db, leitung, 1, { ...cashBase, name: 'Leer' })
    db.update(cashBoxes).set({ archived: true }).where(eq(cashBoxes.id, empty)).run()
    expect(itemsOf('2026-10-27', 'cash:')).toMatchObject([{ key: `cash:${empty}`, deletableFrom: null, due: true }])
    expect(remove(`cash:${empty}`, '2026-10-27')).toBeGreaterThan(0)
    expect(db.select().from(cashBoxes).where(eq(cashBoxes.id, empty)).get()).toBeUndefined()
  })
})

describe('all facilities, order and guards (Review Focus 4)', () => {
  it('lists the items of every facility with id and name: due first, then by date, records without date last', () => {
    db.update(facilities).set({ name: 'Kita Sonnenschein' }).where(eq(facilities.id, 1)).run()
    // Each facility its own period for the time data: 1 year here (01.01.2028), 5 years in the Hort (01.01.2032).
    setRetentionSettings(db, 1, { ...RETENTION_DEFAULTS, timeYears: 1 })
    setRetentionSettings(db, hort, { ...RETENTION_DEFAULTS, timeYears: 5 })
    // Only weekly hours: time data and the record.
    const hanna = addEmployee(db, 'Hanna Hort', { facilityId: hort, leftOn: '2026-05-31' })
    const ole = addChild(db, hort, { firstName: 'Ole', lastName: 'Hort', leftOn: '2010-07-31' })
    const box = createBox(db, leitung, 1, { ...cashBase, name: 'Alt' })
    db.update(cashBoxes).set({ archived: true }).where(eq(cashBoxes.id, box)).run()
    const items = retentionOverview(db, '2026-10-27')
    expect(items.map(item => [item.facilityName, item.name, item.key, item.deletableFrom, item.due])).toEqual([
      // Due, by facility name, then name.
      ['Hort', 'Ole Hort', `child:${ole}`, purgeDate('2010-07-31', getChildRetentionYears(db)), true],
      ['Kita Sonnenschein', 'Alt', `cash:${box}`, null, true],
      ['Kita Sonnenschein', 'Tina Test', `employee:${tina}:immediate`, '2026-03-16', true],
      // Later, by date.
      ['Kita Sonnenschein', 'Tina Test', `employee:${tina}:time`, '2028-01-01', false],
      ['Kita Sonnenschein', 'Tina Test', `employee:${tina}:assessment`, '2030-01-01', false],
      ['Hort', 'Hanna Hort', `employee:${hanna}:time`, '2032-01-01', false],
      // Records without a date last.
      ['Hort', 'Hanna Hort', `employee:${hanna}:record`, null, false],
      ['Kita Sonnenschein', 'Tina Test', `employee:${tina}:record`, null, false],
    ])
    expect(items.filter(item => item.facilityId === hort).map(item => item.facilityName)).toEqual(Array(3).fill('Hort'))
    expect(items.filter(item => item.facilityId === 1).map(item => item.facilityName)).toEqual(Array(5).fill('Kita Sonnenschein'))
    // Deleting goes by the person's own facility too.
    expect(errorCode(() => remove(`employee:${hanna}:time`, '2031-12-31'))).toBe('retention_not_due')
    expect(remove(`employee:${tina}:time`, '2028-01-01')).toBeGreaterThan(0)
    expect(remove(`employee:${hanna}:time`, '2032-01-01')).toBeGreaterThan(0)
    expect(categoryHasData(db, hanna).time).toBe(false)
  })

  it('refuses everyone but the Träger (403), and an invalid key (400)', () => {
    for (const actor of [leitung, addUser(db, 'mitarbeiter', 'observer', ben), addUser(db, 'tablet', 'terminal')]) {
      expect(errorCode(() => deleteRetentionItem(db, actor, `employee:${tina}:immediate`, '2026-03-16'))).toBe('forbidden')
      expect(statusOf(() => deleteRetentionItem(db, actor, `employee:${tina}:immediate`, '2026-03-16'))).toBe(403)
      expect(errorCode(() => deleteDueItems(db, actor, [`employee:${tina}:immediate`], '2026-03-16'))).toBe('forbidden')
    }
    expect(categoryHasData(db, tina).immediate).toBe(true)
    for (const key of ['', 'employee:1', `employee:${tina}:foo`, 'employee:x:time', 'child:', 'child:01', 'child:1.5', 'cash:1:2', 'foo:1', 'child:-1']) {
      expect(errorCode(() => remove(key, '2026-03-16')), key).toBe('retention_key_invalid')
      expect(statusOf(() => remove(key, '2026-03-16')), key).toBe(400)
    }
  })
})

describe('deleting all due items (Review Focus 3)', () => {
  it('deletes the due keys and skips one not due, an unknown one and an invalid one', () => {
    const child = addChild(db, 1, { firstName: 'Mia', lastName: 'Muster', leftOn: '2010-07-31' })
    const keys = [`employee:${tina}:immediate`, `employee:${tina}:time`, 'child:99999', `child:${child}`, 'nonsense']
    expect(deleteDueItems(db, traeger, keys, '2026-10-27')).toEqual({
      deleted: 2, skipped: [`employee:${tina}:time`, 'child:99999', 'nonsense'],
    })
    expect(categoryHasData(db, tina)).toEqual({ immediate: false, time: true, assessment: true, paidOvertime: false })
    expect(db.select().from(children).where(eq(children.id, child)).get()).toBeUndefined()
    expect(foreignKeyViolations(db)).toEqual([])
  })

  it('checks due-ness once before deleting: a record that only becomes due on the way stays', () => {
    const today = '2031-01-01'
    db.transaction(tx => deleteCategories(tx, tina, ['time', 'assessment']))
    const keys = [`employee:${tina}:record`, `employee:${tina}:immediate`, `employee:${tina}:immediate`]
    expect(deleteDueItems(db, traeger, keys, today)).toEqual({ deleted: 1, skipped: [`employee:${tina}:record`] })
    expect(itemsOf(today, `employee:${tina}:`)).toMatchObject([{ category: 'record', due: true }])
    expect(deleteDueItems(db, traeger, [`employee:${tina}:record`], today)).toEqual({ deleted: 1, skipped: [] })
    expect(employeeRow(tina)).toBeUndefined()
  })
})

describe('a blocked deletion', () => {
  const blockedBox = () => {
    const box = createBox(db, leitung, 1, { ...cashBase, name: 'Blockiert' })
    db.update(cashBoxes).set({ archived: true }).where(eq(cashBoxes.id, box)).run()
    db.run(sql.raw('CREATE TABLE extra_refs (id INTEGER PRIMARY KEY, box_id INTEGER REFERENCES cash_boxes(id))'))
    db.run(sql.raw(`INSERT INTO extra_refs (box_id) VALUES (${box})`))
    return box
  }
  const boxExists = (box: number) => db.select().from(cashBoxes).where(eq(cashBoxes.id, box)).get() !== undefined

  it('answers 409 retention_delete_blocked for a cash box when SQLite refuses, and keeps the box', () => {
    const box = blockedBox()
    expect(errorCode(() => remove(`cash:${box}`, '2026-10-27'))).toBe('retention_delete_blocked')
    expect(statusOf(() => remove(`cash:${box}`, '2026-10-27'))).toBe(409)
    expect(boxExists(box)).toBe(true)
  })

  it('answers 409 retention_delete_blocked for a cash box when the foreign key check finds a reference left', () => {
    const box = blockedBox()
    db.run(sql`PRAGMA foreign_keys = OFF`)
    try {
      expect(errorCode(() => remove(`cash:${box}`, '2026-10-27'))).toBe('retention_delete_blocked')
    }
    finally {
      db.run(sql`PRAGMA foreign_keys = ON`)
    }
    expect(boxExists(box)).toBe(true)
  })

  it('skips a blocked item in the bulk run and deletes the others', () => {
    const box = blockedBox()
    const child = addChild(db, 1, { firstName: 'Mia', lastName: 'Muster', leftOn: '2010-07-31' })
    expect(deleteDueItems(db, traeger, [`cash:${box}`, `child:${child}`], '2026-10-27')).toEqual({ deleted: 1, skipped: [`cash:${box}`] })
    expect(boxExists(box)).toBe(true)
    expect(db.select().from(children).where(eq(children.id, child)).get()).toBeUndefined()
  })
})
