import { eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import {
  balanceAdjustments, childAttendanceChanges, childDevelopmentDocs, childParentMeetings, children, earlySickLeaves, employeeHours,
  employees, employeeRequirements, employeeTrainings, entries, formEditors, forms, groupBookChanges, leaveEntitlements, leavePlanners,
  leaveRequests, notifications, releaseSnapshots, staffTalkForms, staffTalks, terminalUnlocks, timeDayNotes, timeRecordChanges,
  timeRecords, users, warningAcks, weekTemplateEntries, weekTemplates,
} from '../../server/db/schema'
import { getActiveUser } from '../../server/services/auth'
import { deleteLeftEmployee } from '../../server/services/employeeDeletion'
import { applyToCells } from '../../server/services/entries'
import { getMonthPlan } from '../../server/services/plan'
import { releaseMonth } from '../../server/services/release'
import { createTalk } from '../../server/services/staffTalks'
import { listTemplates } from '../../server/services/formTemplates'
import { setPin } from '../../server/services/terminal'
import type { SessionUser, SnapshotData } from '../../shared/types/api'
import {
  addChild, addEmployee, addFacility, addGroup, addHelpOut, addUser, codeId, createTestDb, errorCode, requirementTypeId, templateId,
} from '../helpers/fixtures'

const today = '2026-10-27'
const now = new Date('2026-10-27T09:00:00.000Z')

let db: Db
let leitung: SessionUser
let traeger: SessionUser
let tina: number
let ben: number
let hort: number

/** Every column with a foreign key to employees.id, read from the database itself (so new tables are covered). */
function employeeColumns(): { table: string; column: string }[] {
  const tables = db.all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`)
  return tables.flatMap(({ name }) => db.all<{ table: string; from: string }>(sql.raw(`PRAGMA foreign_key_list("${name}")`))
    .filter(fk => fk.table === 'employees').map(fk => ({ table: name, column: fk.from })))
}

/** Rows per referencing column that point at the employee. */
function references(employeeId: number): Record<string, number> {
  return Object.fromEntries(employeeColumns().map(({ table, column }) => [
    `${table}.${column}`,
    db.get<{ n: number }>(sql.raw(`SELECT count(*) AS n FROM "${table}" WHERE "${column}" = ${employeeId}`))!.n,
  ]))
}

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
  const group = addGroup(db, 1, 'Bären')
  const weekTemplate = db.insert(weekTemplates).values({ facilityId: 1, name: 'A-Woche', updatedAt: now.toISOString() })
    .returning({ id: weekTemplates.id }).get().id
  for (const id of [tina, ben]) {
    shift(leitung, 1, id, '2026-10-06')
    shift(leitung, 1, id, '2026-09-15')
    applyToCells(db, leitung, 1, [{ employeeId: id, date: '2026-10-08' }], 'replace', { kind: 'code', codeId: codeId(db, 'sick') })
    db.insert(timeRecords).values({ employeeId: id, date: '2026-10-06', start: 450, end: 945, source: 'terminal', createdAt: now.toISOString() }).run()
    db.insert(timeDayNotes).values({ employeeId: id, date: '2026-10-06', note: 'Arzttermin' }).run()
    db.insert(earlySickLeaves).values({ employeeId: id, date: '2026-10-07', createdAt: now.toISOString() }).run()
    db.insert(balanceAdjustments).values({ employeeId: id, date: '2026-01-01', minutes: 120, reason: 'Übertrag' }).run()
    db.insert(leaveEntitlements).values({ employeeId: id, year: 2026, days: 30 }).run()
    db.insert(leaveRequests).values({ employeeId: id, startDate: '2026-10-12', endDate: '2026-10-13', createdAt: now.toISOString() }).run()
    db.insert(notifications).values({ employeeId: id, year: 2026, month: 10, createdAt: now.toISOString(), changes: '[]' }).run()
    db.insert(employeeRequirements).values({ employeeId: id, typeId: requirementTypeId(db, 'first_aid'), date: '2026-03-01' }).run()
    db.insert(employeeTrainings).values({ employeeId: id, date: '2026-04-01', title: 'Sprachförderung' }).run()
    db.insert(warningAcks).values({
      facilityId: 1, key: `missing_entry|2026-10-09|${id}`, date: '2026-10-09', signature: '', acknowledgedAt: now.toISOString(),
    }).run()
    setPin(db, 1, id, '135790')
    const templateIds = listTemplates(db, 1, 'staff').filter(template => template.starterKey !== null).map(template => template.id)
    createTalk(db, leitung, { facilityId: 1, ownEmployeeId: null }, {
      employeeId: id, templateIds, date: '2026-06-01', start: 600, participants: '', period: '',
    }, now)
    const childId = addChild(db, 1, { keyEducatorId: id, firstName: `Kind von ${id}` })
    // The rest of the references: time corrections, a week template row, a form editor grant, a tablet unlock, and the
    // person as the one who entered something in a child's record or a group book.
    const at = now.toISOString()
    db.insert(timeRecordChanges).values({ employeeId: id, date: '2026-10-06', before: '', after: '7:30–15:45', at }).run()
    db.insert(weekTemplateEntries).values({ weekTemplateId: weekTemplate, employeeId: id, weekday: 0, kind: 'shift', start: 450, end: 945 }).run()
    const formId = db.insert(forms).values({
      facilityId: 1, kind: 'child', title: 'Beobachtung', content: '{"sections":[]}', createdAt: at, updatedAt: at, childId,
    }).returning({ id: forms.id }).get().id
    db.insert(formEditors).values({ formId, employeeId: id, grantedAt: at }).run()
    const tablet = addUser(db, `tablet-${id}`, 'terminal')
    db.insert(terminalUnlocks).values({ id: `unlock-${id}`, terminalUserId: tablet.id, facilityId: 1, employeeId: id, createdAt: at, lastActiveAt: at }).run()
    db.insert(childDevelopmentDocs).values({ childId, doneOn: '2026-10-01', doneByEmployeeId: id, doneByName: 'am Tablet', createdAt: at }).run()
    db.insert(childParentMeetings).values({
      childId, date: '2026-10-02', start: 600, kind: 'development', createdAt: at, createdByEmployeeId: id, createdByName: 'am Tablet',
    }).run()
    db.insert(childAttendanceChanges).values({
      childId, date: '2026-10-02', field: 'arrived', before: '', after: '8:00', changedAt: at, changedByEmployeeId: id, changedByName: 'am Tablet',
    }).run()
    db.insert(groupBookChanges).values({
      groupId: group, field: 'day', date: '2026-10-02', before: '', after: 'Wald', changedAt: at, changedByEmployeeId: id, changedByName: 'am Tablet',
    }).run()
  }
  // October released, then a draft change of both (change log).
  releaseMonth(db, leitung, 1, 2026, 10, new Date('2026-09-25T10:00:00Z'))
  shift(leitung, 1, tina, '2026-10-07', 'S')
  shift(leitung, 1, ben, '2026-10-07', 'S')
  // Tina helped out in the Hort in September, which was released with her column.
  const hortLeitung = addUser(db, 'hortleitung', 'admin', null, hort)
  addHelpOut(db, tina, hort, 2026, 9)
  shift(hortLeitung, hort, tina, '2026-09-16')
  releaseMonth(db, hortLeitung, hort, 2026, 9, new Date('2026-08-25T10:00:00Z'))
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
