import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { changeLog } from '../../server/db/schema'
import { applyToCells, deleteEntry, setDayNote } from '../../server/services/entries'
import { loadEntries } from '../../server/services/queries'
import { releaseMonth, unreleaseMonth } from '../../server/services/release'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, codeId, createTestDb, errorCode, templateId } from '../helpers/fixtures'

const date = '2026-10-05'

describe('entries service', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  let ben: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
    ben = addEmployee(db, 'Ben')
  })
  const annaCell = () => ({ employeeId: anna, date })
  const cellEntries = () => loadEntries(db, { employeeId: anna, from: date, to: date })

  it('copies the template times into new entries', () => {
    applyToCells(db, admin, [annaCell(), { employeeId: ben, date }], 'replace', { kind: 'shift', templateId: templateId(db, 'S') })
    const rows = loadEntries(db, { from: date, to: date })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      kind: 'shift', start: 525, end: 1020, breakStart: 730, breakEnd: 760,
      label: '8:45–17:00', shortLabel: 'S', color: 'neutral', creditMode: 'timed', countsAsStaff: true,
    })
  })
  it('marks housekeeping shifts as not counting as staff', () => {
    applyToCells(db, admin, [annaCell()], 'replace', { kind: 'shift', templateId: templateId(db, 'HK') })
    expect(cellEntries()[0]).toMatchObject({ countsAsStaff: false, color: 'violet' })
  })
  it('replaces, adds and clears', () => {
    applyToCells(db, admin, [annaCell()], 'replace', { kind: 'code', codeId: codeId(db, 'prep_time'), start: 450, end: 570 })
    applyToCells(db, admin, [annaCell()], 'add', { kind: 'special', start: 570, end: 870 })
    expect(cellEntries().map(e => e.label)).toEqual(['VZ 7:30–9:30', '9:30–14:30'])
    applyToCells(db, admin, [annaCell()], 'replace', { kind: 'code', codeId: codeId(db, 'sick') })
    expect(cellEntries().map(e => e.label)).toEqual(['Krank'])
    expect(cellEntries()[0]).toMatchObject({ codeKey: 'sick', creditMode: 'daily_target', color: 'gray', start: null })
    applyToCells(db, admin, [annaCell()], 'clear', null)
    expect(cellEntries()).toEqual([])
  })
  it('rejects invalid input', () => {
    expect(errorCode(() => applyToCells(db, admin, [annaCell()], 'replace', { kind: 'code', codeId: codeId(db, 'prep_time') }))).toBe('times_required')
    expect(errorCode(() => applyToCells(db, admin, [annaCell()], 'replace', { kind: 'special', start: 465, end: 960, breakStart: 700 }))).toBe('span_incomplete_break')
    expect(errorCode(() => applyToCells(db, admin, [annaCell()], 'replace', { kind: 'special', start: 465, end: 960, breakStart: 450, breakEnd: 480 }))).toBe('span_break_outside')
    expect(errorCode(() => applyToCells(db, admin, [annaCell()], 'replace', { kind: 'special', start: 600 }))).toBe('span_incomplete')
    expect(errorCode(() => applyToCells(db, admin, [annaCell()], 'replace', { kind: 'shift', templateId: 999 }))).toBe('template_not_found')
    expect(errorCode(() => applyToCells(db, admin, [annaCell()], 'replace', null))).toBe('entry_required')
  })
  it('rolls back all cells when one cell is invalid', () => {
    const cells = [annaCell(), { employeeId: 999, date }]
    expect(errorCode(() => applyToCells(db, admin, cells, 'replace', { kind: 'shift', templateId: templateId(db, 'M') }))).toBe('employee_not_found')
    expect(cellEntries()).toEqual([])
  })
  it('logs changes only for released months', () => {
    applyToCells(db, admin, [annaCell()], 'replace', { kind: 'shift', templateId: templateId(db, 'F2') }, { now: new Date('2026-09-20T10:00:00Z') })
    expect(db.select().from(changeLog).all()).toHaveLength(0)
    releaseMonth(db, admin, 2026, 10, new Date('2026-09-25T10:00:00Z'))
    applyToCells(db, admin, [annaCell()], 'replace', { kind: 'shift', templateId: templateId(db, 'F2') }, { now: new Date('2026-10-01T05:00:00Z') })
    expect(db.select().from(changeLog).all()).toHaveLength(0)
    applyToCells(db, admin, [annaCell()], 'replace', { kind: 'code', codeId: codeId(db, 'sick') }, { now: new Date('2026-10-01T06:00:00Z') })
    const log = db.select().from(changeLog).all()
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({
      date, employeeId: anna, field: 'entry', before: 'F2 7:30–15:45 [11:40–12:10]', after: 'Krank',
      changedAt: '2026-10-01T06:00:00.000Z', changedBy: admin.id,
    })
  })
  it('logs a template swap that keeps the visible times but drops the break', () => {
    applyToCells(db, admin, [annaCell()], 'replace', { kind: 'shift', templateId: templateId(db, 'F2') })
    releaseMonth(db, admin, 2026, 10)
    applyToCells(db, admin, [annaCell()], 'replace', { kind: 'special', start: 450, end: 945 })
    expect(db.select().from(changeLog).all()).toEqual([
      expect.objectContaining({ field: 'entry', before: 'F2 7:30–15:45 [11:40–12:10]', after: '7:30–15:45' }),
    ])
  })
  it('logs a note-only change', () => {
    applyToCells(db, admin, [annaCell()], 'replace', { kind: 'shift', templateId: templateId(db, 'F2') })
    releaseMonth(db, admin, 2026, 10)
    applyToCells(db, admin, [annaCell()], 'replace', { kind: 'shift', templateId: templateId(db, 'F2'), note: 'Vertretung' })
    expect(db.select().from(changeLog).all()).toEqual([
      expect.objectContaining({ field: 'entry', before: 'F2 7:30–15:45 [11:40–12:10]', after: 'F2 7:30–15:45 [11:40–12:10] · Vertretung' }),
    ])
  })
  it('rejects dates that are not on the calendar', () => {
    for (const bad of ['2026-02-31', '2026-13-45', '2026-2-3']) {
      expect(errorCode(() => applyToCells(db, admin, [{ employeeId: anna, date: bad }], 'replace', { kind: 'shift', templateId: templateId(db, 'M') }))).toBe('invalid_date')
      expect(errorCode(() => setDayNote(db, admin, bad, 'info1', 'x'))).toBe('invalid_date')
    }
    expect(loadEntries(db)).toEqual([])
  })
  it('rejects invalid months when releasing', () => {
    for (const [year, month] of [[2026, 0], [2026, 13], [2026, 1.5], [1999, 10], [2101, 10]] as const) {
      expect(errorCode(() => releaseMonth(db, admin, year, month))).toBe('invalid_month')
      expect(errorCode(() => unreleaseMonth(db, year, month))).toBe('invalid_month')
    }
  })
  it('deletes single entries and logs it', () => {
    releaseMonth(db, admin, 2026, 10)
    applyToCells(db, admin, [annaCell()], 'replace', { kind: 'shift', templateId: templateId(db, 'M') })
    deleteEntry(db, admin, cellEntries()[0]!.id)
    expect(cellEntries()).toEqual([])
    expect(db.select().from(changeLog).all().at(-1)).toMatchObject({ before: 'M 7:45–16:00 [11:40–12:10]', after: '—' })
    expect(errorCode(() => deleteEntry(db, admin, 999))).toBe('entry_not_found')
  })
  it('saves day notes and logs changes after release', () => {
    setDayNote(db, admin, date, 'info1', 'Elternabend')
    releaseMonth(db, admin, 2026, 10)
    setDayNote(db, admin, date, 'info1', 'Elternabend 19 Uhr')
    expect(db.select().from(changeLog).all()).toEqual([
      expect.objectContaining({ field: 'info1', employeeId: null, before: 'Elternabend', after: 'Elternabend 19 Uhr' }),
    ])
  })
})
