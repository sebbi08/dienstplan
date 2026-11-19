import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { employees, warningAcks } from '../../server/db/schema'
import { deleteLeftEmployee } from '../../server/services/employeeDeletion'
import { applyToCells } from '../../server/services/entries'
import { listEmployeeListExtras } from '../../server/services/employeeListExtras'
import { getMonthPlan } from '../../server/services/plan'
import { addRequirementRecord, getEmployeeRequirements, getMyRequirements, listDueRequirements } from '../../server/services/requirements'
import { acknowledgeWarnings } from '../../server/services/warningAcks'
import { warningAckKey, warningSignature } from '../../shared/domain/warningList'
import type { Warning } from '../../shared/domain/warnings'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, codeId, createTestDb, requirementTypeId } from '../helpers/fixtures'

let db: Db
let admin: SessionUser
let lena: number
beforeEach(() => {
  db = createTestDb()
  admin = addUser(db, 'leitung', 'admin')
  // Born on 10 December 2008: under 18 until 9 December 2026.
  lena = addEmployee(db, 'Lena', { validFrom: '2026-08-01' })
  db.update(employees).set({ birthday: '12-10', birthYear: 2008, qualification: 'azubi_1' }).where(eq(employees.id, lena)).run()
})

const without = (user: SessionUser, ...keys: string[]): SessionUser =>
  ({ ...user, permissions: new Set([...user.permissions].filter(key => !keys.includes(key))) }) as SessionUser
const special = (date: string, start: number, end: number, extra: { breakStart?: number; breakEnd?: number } = {}) =>
  applyToCells(db, admin, 1, [{ employeeId: lena, date }], 'add', { kind: 'special', start, end, ...extra })
const YOUTH = new Set(['youth', 'youth_birth_year', 'youth_birthday'])
const youth = (year: number, month: number, viewer = admin) =>
  getMonthPlan(db, viewer, 1, year, month, '2026-11-01').admin!.warnings.filter(warning => YOUTH.has(warning.type))
const brief = (warnings: Warning[]) => warnings.map(warning => warning.type === 'youth'
  ? [warning.rule, warning.date, warning.value, warning.limit]
  : [warning.type, warning.date])

describe('Jugendarbeitsschutz in the plan', () => {
  it('gives the hints on the days the person is under 18, from the planned entries', () => {
    special('2026-11-03', 450, 1020, { breakStart: 720, breakEnd: 780 }) // Tuesday 7:30–17:00, 60 min break: 8:30 h
    special('2026-11-14', 480, 600) // Saturday of the next week (a shorter day in the same week would allow 8:30 h)
    expect(brief(youth(2026, 11))).toEqual([
      ['hours', '2026-11-03', 510, 480],
      ['saturday', '2026-11-14', 120, 0],
    ])
  })
  it('stops on the 18th birthday', () => {
    special('2026-12-09', 420, 1020, { breakStart: 690, breakEnd: 750 }) // Wednesday: 9:00 h
    special('2026-12-10', 420, 1020, { breakStart: 690, breakEnd: 750 }) // the birthday
    expect(brief(youth(2026, 12))).toEqual([['hours', '2026-12-09', 540, 480]])
  })
  it('counts the week across the month boundary on the days under 18', () => {
    // Week of Monday 30 November 2026: 5 × 8:00 h, 2 days in November, 3 in December; Saturday 5 December 1:00 h more.
    for (const date of ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04']) {
      special(date, 480, 1020, { breakStart: 720, breakEnd: 780 })
    }
    special('2026-12-05', 480, 540)
    expect(brief(youth(2026, 12))).toEqual([
      ['saturday', '2026-12-05', 60, 0],
      ['week', '2026-12-05', 2460, 2400],
      ['days', '2026-12-05', 6, 5],
    ])
    expect(brief(youth(2026, 11))).toEqual([])
  })
  it('says nothing for an adult', () => {
    special('2026-11-03', 420, 1080)
    db.update(employees).set({ birthYear: 2000 }).where(eq(employees.id, lena)).run()
    expect(youth(2026, 11)).toEqual([])
    db.update(employees).set({ birthYear: 2000, birthday: null }).where(eq(employees.id, lena)).run()
    expect(youth(2026, 11)).toEqual([])
  })
  it('checks with the birth year alone while she is certainly under 18', () => {
    special('2026-11-03', 450, 1020, { breakStart: 720, breakEnd: 780 })
    db.update(employees).set({ birthYear: 2010, birthday: null }).where(eq(employees.id, lena)).run()
    expect(brief(youth(2026, 11))).toEqual([['hours', '2026-11-03', 510, 480]])
  })
  it('credits a long school day with the average daily working time of the contract', () => {
    // 39 hours on 5 days: 7:48 h. Week of 2 November: Monday school all day, Tuesday to Friday 8:00 h, Saturday 0:10 h
    // makes 39:58 h (with 8 h for the school day it would be 40:10 h).
    applyToCells(db, admin, 1, [{ employeeId: lena, date: '2026-11-02' }], 'replace', { kind: 'code', codeId: codeId(db, 'school') })
    for (const date of ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']) special(date, 480, 1020, { breakStart: 720, breakEnd: 780 })
    special('2026-11-07', 600, 610)
    expect(brief(youth(2026, 11)).filter(row => row[0] === 'week')).toEqual([])
    special('2026-11-07', 610, 615)
    expect(brief(youth(2026, 11)).filter(row => row[0] === 'week')).toEqual([['week', '2026-11-07', 2403, 2400]])
  })
  it('counts nothing for whole-day absences, private ones included, and tells no viewer about them', () => {
    for (const date of ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']) {
      applyToCells(db, admin, 1, [{ employeeId: lena, date }], 'replace', { kind: 'code', codeId: codeId(db, 'sick') })
    }
    special('2026-11-07', 480, 600)
    expect(brief(youth(2026, 11))).toEqual([['saturday', '2026-11-07', 120, 0]])
    expect(brief(youth(2026, 11, without(admin, 'employees.sickness')))).toEqual([['saturday', '2026-11-07', 120, 0]])
  })
  it('can be acknowledged per rule, and the acknowledgement goes with the employee', () => {
    special('2026-11-07', 480, 600)
    const [warning] = youth(2026, 11) as [Warning]
    acknowledgeWarnings(db, 1, admin, [{ key: warningAckKey(warning), signature: warningSignature(warning) }])
    expect(getMonthPlan(db, admin, 1, 2026, 11, '2026-11-01').admin!.warningAcks.map(ack => [ack.key, ack.signature]))
      .toEqual([[`youth|2026-11-07|${lena}|saturday`, '120/0']])
    db.update(employees).set({ leftOn: '2026-11-30' }).where(eq(employees.id, lena)).run()
    deleteLeftEmployee(db, admin, 1, lena, 'Lena', '2026-12-19')
    expect(db.select().from(warningAcks).all()).toEqual([])
  })
})

describe('„Geburtsjahr fehlt“', () => {
  it('reminds the Leitung once a month for a trainee without a birth year', () => {
    db.update(employees).set({ birthYear: null }).where(eq(employees.id, lena)).run()
    expect(brief(youth(2026, 11))).toEqual([['youth_birth_year', '2026-11-01']])
    // On the first day of the employment.
    expect(brief(youth(2026, 8))).toEqual([['youth_birth_year', '2026-08-01']])
    expect(youth(2026, 7)).toEqual([])
    // Not for a plan editor who cannot enter the birth year.
    expect(youth(2026, 11, without(admin, 'employees.personal'))).toEqual([])
  })
  it('only for trainees, students, interns and „keine pädagogische Kraft“', () => {
    db.update(employees).set({ birthYear: null, qualification: 'fachkraft' }).where(eq(employees.id, lena)).run()
    expect(youth(2026, 11)).toEqual([])
    db.update(employees).set({ qualification: 'none' }).where(eq(employees.id, lena)).run()
    expect(brief(youth(2026, 11))).toEqual([['youth_birth_year', '2026-11-01']])
    db.update(employees).set({ qualification: null }).where(eq(employees.id, lena)).run()
    expect(youth(2026, 11)).toEqual([])
  })
  it('„Geburtstag fehlt“ in the year of the 18th birthday when only the year is known, for any qualification', () => {
    db.update(employees).set({ birthYear: 2008, birthday: null, qualification: 'fachkraft' }).where(eq(employees.id, lena)).run()
    special('2026-11-03', 420, 1080)
    // 2026 − 2008 = 18: maybe already 18, so nothing is checked, but the Leitung is asked for the birthday.
    expect(brief(youth(2026, 11))).toEqual([['youth_birthday', '2026-11-01']])
    expect(youth(2026, 11, without(admin, 'employees.personal'))).toEqual([])
    // 2027: certainly 18.
    expect(youth(2027, 1)).toEqual([])
    // Born 2009: 17 years in 2026, certainly under 18 — the rules apply, no hint.
    db.update(employees).set({ birthYear: 2009 }).where(eq(employees.id, lena)).run()
    expect(brief(youth(2026, 11))).toEqual([['hours', '2026-11-03', 660, 480], ['break', '2026-11-03', 0, 60], ['stretch', '2026-11-03', 660, 270]])
  })
  it('can be acknowledged, and goes with the employee', () => {
    db.update(employees).set({ birthYear: null }).where(eq(employees.id, lena)).run()
    const [warning] = youth(2026, 11) as [Warning]
    acknowledgeWarnings(db, 1, admin, [{ key: warningAckKey(warning), signature: warningSignature(warning) }])
    expect(db.select().from(warningAcks).all().map(ack => ack.key)).toEqual([`youth_birth_year|2026-11-01|${lena}`])
    db.update(employees).set({ leftOn: '2026-11-30' }).where(eq(employees.id, lena)).run()
    deleteLeftEmployee(db, admin, 1, lena, 'Lena', '2026-12-19')
    expect(db.select().from(warningAcks).all()).toEqual([])
  })
})

describe('examinations (§§ 32, 33 JArbSchG) among the Pflichttermine', () => {
  const TODAY = '2026-10-12'
  const INITIAL = 'Erstuntersuchung (§ 32 JArbSchG)'
  const FOLLOW_UP = 'Nachuntersuchung (§ 33 JArbSchG)'
  let mia: number
  beforeEach(() => {
    // 16 when she starts on 1 August 2026, still 17 a year later.
    mia = addEmployee(db, 'Mia', { validFrom: '2026-08-01' })
    db.update(employees).set({ birthday: '03-01', birthYear: 2010, qualification: 'azubi_1' }).where(eq(employees.id, mia)).run()
  })
  const youthKinds = (employeeId: number, today = TODAY) => getEmployeeRequirements(db, 1, employeeId, today).kinds
    .filter(kind => kind.type.builtinKey?.startsWith('youth'))
    .map(kind => [kind.type.name, kind.state, kind.dueOn, kind.lastDate])
  const dueYouth = (today = TODAY) => listDueRequirements(db, 1, today)
    .filter(row => row.typeName.includes('JArbSchG')).map(row => [row.employeeName, row.typeName, row.state, row.dueOn])

  it('shows both for someone under 18, due by the start and a year after it', () => {
    expect(youthKinds(mia)).toEqual([[INITIAL, 'overdue', '2026-08-01', null], [FOLLOW_UP, 'ok', '2027-08-01', null]])
    // Lena turns 18 before her year is over: only the first examination.
    expect(youthKinds(lena).map(row => row[0])).toEqual([INITIAL])
    expect(dueYouth()).toEqual([['Lena', INITIAL, 'overdue', '2026-08-01'], ['Mia', INITIAL, 'overdue', '2026-08-01']])
    expect(dueYouth('2027-06-15')).toEqual([['Mia', INITIAL, 'overdue', '2026-08-01'], ['Mia', FOLLOW_UP, 'soon', '2027-08-01']])
  })
  it('takes „beschäftigt seit“ as the start when it is entered', () => {
    db.update(employees).set({ employedSince: '2025-09-01' }).where(eq(employees.id, mia)).run()
    expect(youthKinds(mia)).toEqual([[INITIAL, 'overdue', '2025-09-01', null], [FOLLOW_UP, 'overdue', '2026-09-01', null]])
  })
  it('is settled by a record, which also shows after the 18th birthday', () => {
    addRequirementRecord(db, 1, lena, { typeId: requirementTypeId(db, 'youth_initial'), date: '2026-07-20' }, TODAY)
    expect(youthKinds(lena)).toEqual([[INITIAL, 'ok', null, '2026-07-20']])
    expect(youthKinds(lena, '2027-01-04')).toEqual([[INITIAL, 'ok', null, '2026-07-20']])
    expect(dueYouth().map(row => row[0])).toEqual(['Mia'])
  })
  it('applies to nobody of 18 or without the full birth date, and ends with the 18th birthday', () => {
    db.update(employees).set({ birthYear: null }).where(eq(employees.id, mia)).run()
    db.update(employees).set({ birthYear: 2000 }).where(eq(employees.id, lena)).run()
    expect(youthKinds(mia)).toEqual([])
    expect(youthKinds(lena)).toEqual([])
    expect(dueYouth()).toEqual([])
    db.update(employees).set({ birthYear: 2008 }).where(eq(employees.id, lena)).run()
    expect(youthKinds(lena, '2026-12-10')).toEqual([])
  })
  it('announces the first examination before the first day, nothing else of a joiner', () => {
    const tom = addEmployee(db, 'Tom', { validFrom: '2026-11-16' })
    db.update(employees).set({ birthday: '05-05', birthYear: 2010 }).where(eq(employees.id, tom)).run()
    const anne = addEmployee(db, 'Anne', { validFrom: '2026-11-16' })
    expect(listDueRequirements(db, 1, TODAY).filter(row => row.employeeId === tom || row.employeeId === anne)
      .map(row => [row.employeeName, row.typeName, row.state, row.dueOn]))
      .toEqual([['Tom', INITIAL, 'soon', '2026-11-16']])
    // The employee list shows it in the Pflichttermine column.
    expect(listEmployeeListExtras(db, 1, TODAY, admin.permissions).find(row => row.employeeId === tom)!.requirements)
      .toEqual([{ typeId: requirementTypeId(db, 'youth_initial'), typeName: INITIAL, state: 'soon', dueOn: '2026-11-16' }])
    // „Beschäftigt seit“ is the start for both: due by it, and listed while it lies ahead.
    db.update(employees).set({ employedSince: '2026-12-01' }).where(eq(employees.id, tom)).run()
    expect(listDueRequirements(db, 1, TODAY).filter(row => row.employeeId === tom).map(row => [row.typeName, row.state, row.dueOn]))
      .toEqual([[INITIAL, 'soon', '2026-12-01']])
  })
  it('shows the employee their own examinations', () => {
    const viewer = addUser(db, 'mia', 'observer', mia)
    expect(getMyRequirements(db, viewer, TODAY).kinds.filter(kind => kind.type.name.includes('JArbSchG')).map(kind => [kind.type.name, kind.dueOn]))
      .toEqual([[INITIAL, '2026-08-01'], [FOLLOW_UP, '2027-08-01']])
  })
})
