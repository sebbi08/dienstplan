import { eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import {
  childDevelopmentDocs, children, employeeHours, employees, entries, forms, leavePlanners, releaseSnapshots, staffTalkForms,
  staffTalks, timeRecords, users, warningAcks,
} from '../../server/db/schema'
import { getActiveUser } from '../../server/services/auth'
import { deleteLeftEmployee } from '../../server/services/employeeDeletion'
import { applyToCells } from '../../server/services/entries'
import { getRetentionSettings, setRetentionSettings } from '../../server/services/retentionSettings'
import type { EmployeeDeleteMode } from '../../shared/domain/retention'
import { getMonthPlan } from '../../server/services/plan'
import type { SessionUser, SnapshotData } from '../../shared/types/api'
import { employeeReferences, fillEmployeeData } from '../helpers/employeeData'
import { addEmployee, addFacility, addUser, createTestDb, errorCode, templateId } from '../helpers/fixtures'

const today = '2026-10-27'
const now = new Date('2026-10-27T09:00:00.000Z')

let db: Db
let leitung: SessionUser
let traeger: SessionUser
let tina: number
let ben: number
let hort: number

/** Rows per referencing column that point at the employee (every column with a foreign key to employees.id). */
const references = (employeeId: number) => employeeReferences(db, employeeId)

const shift = (actor: SessionUser, facilityId: number, employeeId: number, date: string, label = 'F2') =>
  applyToCells(db, actor, facilityId, [{ employeeId, date }], 'replace', { kind: 'shift', templateId: templateId(db, label, facilityId) })

beforeEach(() => {
  db = createTestDb()
  leitung = addUser(db, 'leitung', 'admin', addEmployee(db, 'Lea Leitung'))
  traeger = addUser(db, 'traeger', 'provider')
  tina = addEmployee(db, 'Tina Test', { leftOn: '2026-10-15' })
  ben = addEmployee(db, 'Ben Beispiel')
  hort = addFacility(db, 'Hort')
})

/** Tina (left) and Ben (active) with the same kinds of data; Tina also helped out in the Hort. */
function fillData(): void {
  fillEmployeeData(db, leitung, [tina, ben], tina, hort)
}

const snapshotIds = () => db.select({ data: releaseSnapshots.data }).from(releaseSnapshots).all().map((row) => {
  const data = JSON.parse(row.data) as SnapshotData
  return { employees: data.employees.map(employee => employee.id), entries: [...new Set(data.entries.map(entry => entry.employeeId))] }
})

describe('deleting a left employee', () => {
  it('removes everything of the person, keeps everyone else, and leaves no broken reference', () => {
    fillData()
    const tinaAccount = addUser(db, 'tina', 'observer', tina)
    const benAccount = addUser(db, 'ben', 'observer', ben)
    db.insert(leavePlanners).values({ userId: tinaAccount.id }).run()
    const tinaBefore = references(tina)
    const benBefore = references(ben)
    // Every column that references employees has data, so a new reference without handling makes this test fail.
    expect(Object.keys(tinaBefore).length).toBeGreaterThanOrEqual(21)
    for (const [column, count] of Object.entries(tinaBefore)) expect(count, `seed a row for ${column}`).toBeGreaterThan(0)
    expect(snapshotIds().some(ids => ids.employees.includes(tina) && ids.entries.includes(tina))).toBe(true)
    const talkFormsOf = (employeeId: number) => db.select({ id: staffTalkForms.formId }).from(staffTalkForms)
      .innerJoin(staffTalks, eq(staffTalks.id, staffTalkForms.talkId)).where(eq(staffTalks.employeeId, employeeId)).all().map(row => row.id)
    const tinaTalkForms = talkFormsOf(tina)
    expect(tinaTalkForms.length).toBeGreaterThan(0)
    const formCount = db.select().from(forms).all().length

    deleteLeftEmployee(db, leitung, 1, tina, 'Tina Test', today)

    expect(db.select().from(employees).where(eq(employees.id, tina)).get()).toBeUndefined()
    expect(Object.entries(references(tina)).filter(([, n]) => n > 0)).toEqual([])
    expect(references(ben)).toEqual(benBefore)
    expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([])
    // The talk's forms went with it; Ben's and the child forms stay.
    expect(db.select().from(forms).all().length).toBe(formCount - tinaTalkForms.length)
    expect(talkFormsOf(ben).length).toBe(tinaTalkForms.length)
    expect(db.select().from(leavePlanners).all()).toEqual([])
    // Who entered something keeps the name, without the id.
    expect(db.select({ name: childDevelopmentDocs.doneByName, id: childDevelopmentDocs.doneByEmployeeId }).from(childDevelopmentDocs).all())
      .toEqual(expect.arrayContaining([{ name: 'am Tablet', id: null }, { name: 'am Tablet', id: ben }]))
    // The child keeps no Bezugserzieher; Ben's child keeps him.
    expect(db.select({ key: children.keyEducatorId }).from(children).all().map(row => row.key).sort()).toEqual([ben, null].sort())
    // The account is gone (its session no longer works), Ben's stays.
    expect(db.select().from(users).where(eq(users.id, tinaAccount.id)).get()).toBeUndefined()
    expect(getActiveUser(db, tinaAccount.id)).toBeNull()
    expect(getActiveUser(db, benAccount.id)).not.toBeNull()
    // Only the warning acknowledgement about Tina went.
    expect(db.select({ key: warningAcks.key }).from(warningAcks).all().map(row => row.key)).toEqual([`missing_entry|2026-10-09|${ben}`])
    // No release snapshot of any facility names her any more; Ben is still in October's.
    for (const ids of snapshotIds()) {
      expect(ids.employees).not.toContain(tina)
      expect(ids.entries).not.toContain(tina)
    }
    // The released plans still load, for the Leitung and for staff, without her.
    for (const viewer of [leitung, benAccount]) {
      const plan = getMonthPlan(db, viewer, 1, 2026, 10, today)
      expect(plan.release.releasedAt).not.toBeNull()
      expect(plan.employees.map(employee => employee.id)).toContain(ben)
      expect(plan.employees.map(employee => employee.id)).not.toContain(tina)
      expect(plan.entries.some(entry => entry.employeeId === tina)).toBe(false)
      if (viewer === leitung) expect(plan.admin!.releasedEmployees.map(employee => employee.id)).not.toContain(tina)
    }
    const hortPlan = getMonthPlan(db, traeger, hort, 2026, 9, today)
    expect(hortPlan.employees.map(employee => employee.id)).not.toContain(tina)
  })

  it('deletes a linked Leitung account, but only unlinks a Träger account', () => {
    const leitungAccount = addUser(db, 'tina', 'admin', tina)
    deleteLeftEmployee(db, traeger, 1, tina, 'Tina Test', today)
    expect(getActiveUser(db, leitungAccount.id)).toBeNull()

    const otto = addEmployee(db, 'Otto Träger', { leftOn: '2026-09-30' })
    const provider = addUser(db, 'otto', 'provider', otto)
    expect(errorCode(() => deleteLeftEmployee(db, leitung, 1, otto, 'Otto Träger', today))).toBe('employee_delete_provider')
    deleteLeftEmployee(db, traeger, 1, otto, 'Otto Träger', today)
    expect(db.select().from(employees).where(eq(employees.id, otto)).get()).toBeUndefined()
    expect(db.select({ employeeId: users.employeeId, active: users.active }).from(users).where(eq(users.id, provider.id)).get())
      .toEqual({ employeeId: null, active: true })
    expect(getActiveUser(db, provider.id)).not.toBeNull()
    expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([])
  })

  it('refuses whoever is still employed, a wrong name, the own record, other facilities and staff accounts', () => {
    const exists = (id: number) => db.select().from(employees).where(eq(employees.id, id)).get() !== undefined
    // Still active, or leaving today: not left yet.
    expect(errorCode(() => deleteLeftEmployee(db, leitung, 1, ben, 'Ben Beispiel', today))).toBe('employee_not_left')
    const lena = addEmployee(db, 'Lena Heute', { leftOn: today })
    expect(errorCode(() => deleteLeftEmployee(db, leitung, 1, lena, 'Lena Heute', today))).toBe('employee_not_left')
    expect(errorCode(() => deleteLeftEmployee(db, leitung, 1, tina, 'Tina', today))).toBe('employee_delete_confirm_mismatch')
    expect(errorCode(() => deleteLeftEmployee(db, leitung, 1, tina, 'tina test', today))).toBe('employee_delete_confirm_mismatch')
    expect(errorCode(() => deleteLeftEmployee(db, leitung, 1, tina, '', today))).toBe('employee_delete_confirm_mismatch')
    // The own record, even after leaving.
    db.update(employees).set({ leftOn: '2026-10-01' }).where(eq(employees.id, leitung.employeeId!)).run()
    expect(errorCode(() => deleteLeftEmployee(db, leitung, 1, leitung.employeeId!, 'Lea Leitung', today))).toBe('employee_delete_self')
    // Another facility's employee is not found from here.
    const hortTina = addEmployee(db, 'Hanna Hort', { leftOn: '2026-09-30', facilityId: hort })
    expect(errorCode(() => deleteLeftEmployee(db, leitung, 1, hortTina, 'Hanna Hort', today))).toBe('employee_not_found')
    // Mitarbeiter accounts and the tablet never delete.
    const benAccount = addUser(db, 'ben', 'observer', ben)
    const tablet = addUser(db, 'tablet', 'terminal')
    expect(errorCode(() => deleteLeftEmployee(db, benAccount, 1, tina, 'Tina Test', today))).toBe('forbidden')
    expect(errorCode(() => deleteLeftEmployee(db, tablet, 1, tina, 'Tina Test', today))).toBe('forbidden')
    expect([tina, ben, lena, leitung.employeeId!, hortTina].every(exists)).toBe(true)
    // A name typed with spaces around still counts.
    deleteLeftEmployee(db, leitung, 1, tina, '  Tina Test ', today)
    expect(exists(tina)).toBe(false)
  })

  it('compares the name as the page shows it: inner spaces collapsed, Unicode normalised, case still counts', () => {
    const anna = addEmployee(db, 'Anna  Maria', { leftOn: '2026-09-30' })
    expect(errorCode(() => deleteLeftEmployee(db, leitung, 1, anna, 'anna maria', today))).toBe('employee_delete_confirm_mismatch')
    deleteLeftEmployee(db, leitung, 1, anna, 'Anna Maria', today)
    // „Jürgen“ stored composed (NFC), typed decomposed (NFD, as pasted from a Mac or a PDF).
    const juergen = addEmployee(db, 'Jürgen', { leftOn: '2026-09-30' })
    deleteLeftEmployee(db, leitung, 1, juergen, 'Jürgen', today)
    expect(db.select().from(employees).where(eq(employees.id, juergen)).get()).toBeUndefined()
  })

  it('refuses with a German error and keeps everything when a reference without handling still points at the person', () => {
    db.run(sql.raw('CREATE TABLE extra_refs (id INTEGER PRIMARY KEY, employee_id INTEGER REFERENCES employees(id))'))
    db.run(sql.raw(`INSERT INTO extra_refs (employee_id) VALUES (${tina})`))
    shift(leitung, 1, tina, '2026-10-06')
    expect(errorCode(() => deleteLeftEmployee(db, leitung, 1, tina, 'Tina Test', today))).toBe('employee_delete_blocked')
    expect(db.select().from(employees).where(eq(employees.id, tina)).get()).toBeDefined()
    expect(db.select().from(entries).where(eq(entries.employeeId, tina)).all()).toHaveLength(1)
    expect(db.select().from(employeeHours).where(eq(employeeHours.employeeId, tina)).all()).toHaveLength(1)
  })

  it('is not blocked by an old broken reference that has nothing to do with the person', () => {
    db.run(sql`PRAGMA foreign_keys = OFF`)
    db.insert(timeRecords).values({ employeeId: 9999, date: '2026-10-06', start: 450, source: 'terminal', createdAt: now.toISOString() }).run()
    db.run(sql`PRAGMA foreign_keys = ON`)
    expect(db.all(sql`PRAGMA foreign_key_check`)).toHaveLength(1)
    deleteLeftEmployee(db, leitung, 1, tina, 'Tina Test', today)
    expect(db.select().from(employees).where(eq(employees.id, tina)).get()).toBeUndefined()
    expect(db.all(sql`PRAGMA foreign_key_check`)).toHaveLength(1)
  })
})

describe('the Träger setting „Mitarbeiter endgültig löschen“', () => {
  const exists = (id: number) => db.select().from(employees).where(eq(employees.id, id)).get() !== undefined
  const setMode = (facilityId: number, employeeDelete: EmployeeDeleteMode) =>
    setRetentionSettings(db, facilityId, { ...getRetentionSettings(db, facilityId), employeeDelete })

  it('aus: nobody deletes by hand, not even the Träger', () => {
    setMode(1, 'off')
    expect(errorCode(() => deleteLeftEmployee(db, leitung, 1, tina, 'Tina Test', today))).toBe('employee_delete_disabled')
    expect(errorCode(() => deleteLeftEmployee(db, traeger, 1, tina, 'Tina Test', today))).toBe('employee_delete_disabled')
    expect(exists(tina)).toBe(true)
  })

  it('nur Träger: the Leitung is refused, the Träger deletes', () => {
    setMode(1, 'provider')
    expect(errorCode(() => deleteLeftEmployee(db, leitung, 1, tina, 'Tina Test', today))).toBe('employee_delete_disabled')
    expect(exists(tina)).toBe(true)
    deleteLeftEmployee(db, traeger, 1, tina, 'Tina Test', today)
    expect(exists(tina)).toBe(false)
  })

  it('Leitung und Träger (the default): both delete, the other guards still apply', () => {
    expect(getRetentionSettings(db, 1).employeeDelete).toBe('managers')
    deleteLeftEmployee(db, leitung, 1, tina, 'Tina Test', today)
    expect(exists(tina)).toBe(false)
    const otto = addEmployee(db, 'Otto Ohne', { leftOn: '2026-09-30' })
    deleteLeftEmployee(db, traeger, 1, otto, 'Otto Ohne', today)
    expect(exists(otto)).toBe(false)
    expect(errorCode(() => deleteLeftEmployee(db, leitung, 1, ben, 'Ben Beispiel', today))).toBe('employee_not_left')
  })

  it('counts the setting of the facility the person belongs to', () => {
    setMode(hort, 'off')
    deleteLeftEmployee(db, leitung, 1, tina, 'Tina Test', today)
    expect(exists(tina)).toBe(false)
    const hanna = addEmployee(db, 'Hanna Hort', { leftOn: '2026-09-30', facilityId: hort })
    expect(errorCode(() => deleteLeftEmployee(db, traeger, hort, hanna, 'Hanna Hort', today))).toBe('employee_delete_disabled')
    setMode(hort, 'managers')
    deleteLeftEmployee(db, traeger, hort, hanna, 'Hanna Hort', today)
    expect(exists(hanna)).toBe(false)
  })

  it('refuses Mitarbeiter accounts as before, whatever the setting', () => {
    const benAccount = addUser(db, 'ben', 'observer', ben)
    for (const mode of ['off', 'provider', 'managers'] as const) {
      setMode(1, mode)
      expect(errorCode(() => deleteLeftEmployee(db, benAccount, 1, tina, 'Tina Test', today))).toBe('forbidden')
    }
  })
})
