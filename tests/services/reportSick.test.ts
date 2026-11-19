import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { changeLog, entries } from '../../server/db/schema'
import { applyToCells, deleteEntry } from '../../server/services/entries'
import { getMonthPlan } from '../../server/services/plan'
import { releaseMonth } from '../../server/services/release'
import type { CellRef, EntryInput, SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addHelpOut, addUser, codeId, createTestDb, errorCode, templateId } from '../helpers/fixtures'

// „Krank melden“ (user decision 2026-11-19, option a): a plan editor without employees.sickness may enter Krank – and
// only Krank – on a day without a private absence; afterwards the day is „abwesend“ to her like any other private entry.

const TODAY = '2026-11-19'
// 2026-11-16 is a Monday.
const WEEK = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']
const SECRETS = /\bsick\b|child_sick|maternity|employment_ban|Krank|Kind krank|Mutterschutz|Beschäftigungsverbot/

let db: Db
let leitung: SessionUser
let editor: SessionUser
let anna: number
let ben: number

const sick = (): EntryInput => ({ kind: 'code', codeId: codeId(db, 'sick') })
const cell = (employeeId: number, date: string): CellRef => ({ employeeId, date })
const day = (employeeId: number, date: string) => db.select().from(entries)
  .where(and(eq(entries.employeeId, employeeId), eq(entries.date, date))).all()
const codesOn = (employeeId: number, date: string) => day(employeeId, date).map(entry => entry.absenceCodeId)
const codeOn = (employeeId: number, date: string, key: string) =>
  db.insert(entries).values({ employeeId, date, kind: 'code', absenceCodeId: codeId(db, key), note: 'privat', updatedAt: '2026-11-01T00:00:00.000Z' })
    .returning({ id: entries.id }).get().id

beforeEach(() => {
  db = createTestDb()
  leitung = addUser(db, 'leitung', 'admin', addEmployee(db, 'Lea Leitung'))
  anna = addEmployee(db, 'Anna Muster')
  ben = addEmployee(db, 'Ben Beispiel')
  editor = { ...leitung, permissions: new Set([...leitung.permissions].filter(key => key !== 'employees.sickness')) } as SessionUser
})

describe('„Krank melden“ by a plan editor without the sick days right', () => {
  it('enters Krank on an empty day; she then sees „abwesend“, the Leitung „Krank“, and the change is logged', () => {
    releaseMonth(db, leitung, 1, 2026, 11)
    const result = applyToCells(db, editor, 1, [cell(anna, WEEK[1]!)], 'replace', sick())
    expect(result).toEqual({ skippedAbsent: false })
    expect(codesOn(anna, WEEK[1]!)).toEqual([codeId(db, 'sick')])
    const mine = getMonthPlan(db, editor, 1, 2026, 11, TODAY).entries.find(entry => entry.employeeId === anna && entry.date === WEEK[1])!
    expect(mine).toMatchObject({ label: 'abwesend', codeKey: null, codeId: null })
    const lead = getMonthPlan(db, leitung, 1, 2026, 11, TODAY).entries.find(entry => entry.employeeId === anna && entry.date === WEEK[1])!
    expect(lead).toMatchObject({ label: 'Krank', codeKey: 'sick' })
    const log = db.select().from(changeLog).where(and(eq(changeLog.employeeId, anna), eq(changeLog.date, WEEK[1]!))).all()
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ before: '—', changedBy: editor.id })
    expect(log[0]!.after).toContain('Krank')
    // Her plan, with its pending change, tells nothing more than „abwesend“.
    expect(JSON.stringify(getMonthPlan(db, editor, 1, 2026, 11, TODAY))).not.toMatch(SECRETS)
  })

  it('replaces a duty with Krank', () => {
    applyToCells(db, leitung, 1, [cell(anna, WEEK[0]!)], 'replace', { kind: 'shift', templateId: templateId(db, 'F1') })
    applyToCells(db, editor, 1, [cell(anna, WEEK[0]!)], 'replace', sick())
    expect(codesOn(anna, WEEK[0]!)).toEqual([codeId(db, 'sick')])
  })

  it('may not enter Kind krank, Mutterschutz or Beschäftigungsverbot', () => {
    for (const key of ['child_sick', 'maternity', 'employment_ban']) {
      expect(errorCode(() => applyToCells(db, editor, 1, [cell(anna, WEEK[0]!)], 'replace', { kind: 'code', codeId: codeId(db, key) })))
        .toBe('protected_cell')
    }
    expect(day(anna, WEEK[0]!)).toEqual([])
  })

  it('cannot change, clear, delete or write onto a private day, also not one she reported herself', () => {
    applyToCells(db, editor, 1, [cell(anna, WEEK[0]!)], 'replace', sick())
    const reported = day(anna, WEEK[0]!)[0]!.id
    const maternity = codeOn(anna, WEEK[1]!, 'maternity')
    for (const [date, id] of [[WEEK[0]!, reported], [WEEK[1]!, maternity]] as const) {
      const target = [cell(anna, date)]
      expect(errorCode(() => applyToCells(db, editor, 1, target, 'replace', { kind: 'special', start: 480, end: 720 }))).toBe('protected_cell')
      expect(errorCode(() => applyToCells(db, editor, 1, target, 'add', { kind: 'special', start: 480, end: 720 }))).toBe('protected_cell')
      expect(errorCode(() => applyToCells(db, editor, 1, target, 'clear', null))).toBe('protected_cell')
      expect(errorCode(() => applyToCells(db, editor, 1, target, 'replace', sick()))).toBe('protected_cell')
      expect(errorCode(() => deleteEntry(db, editor, 1, id))).toBe('protected_cell')
    }
    expect(codesOn(anna, WEEK[0]!)).toEqual([codeId(db, 'sick')])
    expect(codesOn(anna, WEEK[1]!)).toEqual([codeId(db, 'maternity')])
  })

  it('over a range leaves the „abwesend“ days alone and says so neutrally, without telling which they are', () => {
    codeOn(anna, WEEK[1]!, 'sick')
    codeOn(anna, WEEK[2]!, 'maternity')
    codeOn(anna, WEEK[3]!, 'child_sick')
    releaseMonth(db, leitung, 1, 2026, 11)
    const before = db.select().from(entries).all().filter(entry => entry.employeeId === anna)
    const result = applyToCells(db, editor, 1, WEEK.map(date => cell(anna, date)), 'replace', sick())
    expect(result).toEqual({ skippedAbsent: true })
    expect(JSON.stringify(result)).not.toMatch(SECRETS)
    expect(codesOn(anna, WEEK[0]!)).toEqual([codeId(db, 'sick')])
    expect(codesOn(anna, WEEK[4]!)).toEqual([codeId(db, 'sick')])
    // The private days are untouched (same rows, notes and authors) and got no log line.
    expect(db.select().from(entries).all().filter(entry => entry.employeeId === anna && before.some(old => old.date === entry.date)))
      .toEqual(before)
    const logged = db.select().from(changeLog).where(eq(changeLog.employeeId, anna)).all().map(line => line.date)
    expect(logged.sort()).toEqual([WEEK[0], WEEK[4]])
  })

  it('refuses when every selected day is already „abwesend“, and any other entry over a range with such a day', () => {
    codeOn(anna, WEEK[1]!, 'maternity')
    expect(errorCode(() => applyToCells(db, editor, 1, [cell(anna, WEEK[1]!)], 'replace', sick()))).toBe('protected_cell')
    expect(errorCode(() => applyToCells(db, editor, 1, [cell(anna, WEEK[0]!), cell(anna, WEEK[1]!)], 'replace', { kind: 'special', start: 480, end: 720 })))
      .toBe('protected_cell')
    expect(day(anna, WEEK[0]!)).toEqual([])
    expect(codesOn(anna, WEEK[1]!)).toEqual([codeId(db, 'maternity')])
  })

  it('reaches several people at once and keeps the other rules (no absence for a helper)', () => {
    const krippe = addFacility(db, 'Krippe')
    const kim = addEmployee(db, 'Kim', { facilityId: krippe })
    addHelpOut(db, kim, 1, 2026, 11)
    const result = applyToCells(db, editor, 1, [cell(anna, WEEK[0]!), cell(ben, WEEK[0]!)], 'replace', sick())
    expect(result).toEqual({ skippedAbsent: false })
    expect([...codesOn(anna, WEEK[0]!), ...codesOn(ben, WEEK[0]!)]).toEqual([codeId(db, 'sick'), codeId(db, 'sick')])
    expect(errorCode(() => applyToCells(db, editor, 1, [cell(kim, WEEK[0]!)], 'replace', sick()))).toBe('help_code_not_allowed')
  })
})

describe('a helper whose home day is private tells the other facility nothing', () => {
  it('its editor without the right gets the same refusals as one with it', () => {
    const krippe = addFacility(db, 'Krippe')
    const leitungB = addUser(db, 'leitung-b', 'admin', null, krippe)
    const editorB = { ...leitungB, permissions: new Set([...leitungB.permissions].filter(key => key !== 'employees.sickness')) } as SessionUser
    addHelpOut(db, anna, krippe, 2026, 11)
    codeOn(anna, WEEK[0]!, 'sick')
    const shift: EntryInput = { kind: 'shift', templateId: templateId(db, 'F1', krippe) }
    for (const actor of [leitungB, editorB]) {
      expect(errorCode(() => applyToCells(db, actor, krippe, [cell(anna, WEEK[0]!)], 'replace', shift))).toBe('cell_taken')
      expect(errorCode(() => applyToCells(db, actor, krippe, [cell(anna, WEEK[0]!)], 'replace', sick()))).toBe('help_code_not_allowed')
    }
    expect(codesOn(anna, WEEK[0]!)).toEqual([codeId(db, 'sick')])
  })
})

describe('the plan offers „Krank melden“ only to editors without the right', () => {
  it('gives the editor the Krank code apart from the code list, nobody else', () => {
    const plan = getMonthPlan(db, editor, 1, 2026, 11, TODAY)
    expect(plan.reportSickCodeId).toBe(codeId(db, 'sick'))
    expect(plan.codes.some(code => code.key === 'sick')).toBe(false)
    expect(JSON.stringify(plan)).not.toMatch(SECRETS)
    const lead = getMonthPlan(db, leitung, 1, 2026, 11, TODAY)
    expect(lead.reportSickCodeId).toBeNull()
    expect(lead.codes.some(code => code.key === 'sick')).toBe(true)
  })
})

describe('the editor with the right is unchanged', () => {
  it('overwrites a private day over a range, and nothing is skipped', () => {
    codeOn(anna, WEEK[1]!, 'maternity')
    const result = applyToCells(db, leitung, 1, WEEK.slice(0, 3).map(date => cell(anna, date)), 'replace', sick())
    expect(result).toEqual({ skippedAbsent: false })
    expect(WEEK.slice(0, 3).flatMap(date => codesOn(anna, date))).toEqual(Array(3).fill(codeId(db, 'sick')))
    applyToCells(db, leitung, 1, [cell(anna, WEEK[0]!)], 'replace', { kind: 'code', codeId: codeId(db, 'child_sick') })
    expect(codesOn(anna, WEEK[0]!)).toEqual([codeId(db, 'child_sick')])
  })
})
