import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { applyToCells } from '../../server/services/entries'
import {
  createRecord, deleteRecord, getTimeMonth, listOpenRecords, loadTimeRecords, stamp, updateRecord,
} from '../../server/services/timeTracking'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, codeId, createTestDb, errorCode, templateId } from '../helpers/fixtures'

const NOW = new Date('2026-10-08T10:00:00Z') // 12:00 Berlin on 08.10.

describe('admin corrections', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
    setTimeTrackingFrom(db, 1, '2026-10-01')
  })
  const records = () => loadTimeRecords(db, { employeeId: anna })

  it('adds, changes and deletes records with a protocol', () => {
    createRecord(db, admin, 1, { employeeId: anna, date: '2026-10-06', start: 462, end: 700 }, NOW)
    const [record] = records()
    expect(record).toMatchObject({ source: 'admin', edited: true, editedBy: 'leitung' })
    updateRecord(db, admin, 1, record!.id, { start: 465, end: 705 }, NOW)
    deleteRecord(db, admin, 1, record!.id, NOW)
    expect(records()).toEqual([])
    const day = getTimeMonth(db, 1, anna, 2026, 10, '2026-10-08').days.find(d => d.date === '2026-10-06')!
    expect(day.changes.map(c => [c.before, c.after, c.actor])).toEqual([
      ['—', '7:42–11:40', 'leitung'], ['7:42–11:40', '7:45–11:45', 'leitung'], ['7:45–11:45', '—', 'leitung'],
    ])
  })
  it('closes a forgotten clock-out and marks it as edited', () => {
    stamp(db, anna, 'in', 'self', new Date('2026-10-06T05:42:00Z'))
    const [open] = records()
    updateRecord(db, admin, 1, open!.id, { start: open!.start, end: 960 }, NOW)
    expect(records()[0]).toMatchObject({ source: 'self', end: 960, edited: true })
  })
  it('rejects invalid corrections without changing anything', () => {
    createRecord(db, admin, 1, { employeeId: anna, date: '2026-10-06', start: 462, end: 700 }, NOW)
    const input = { employeeId: anna, date: '2026-10-06' }
    expect(errorCode(() => createRecord(db, admin, 1, { ...input, start: 690, end: 800 }, NOW))).toBe('record_overlap')
    expect(errorCode(() => createRecord(db, admin, 1, { ...input, start: 800, end: 800 }, NOW))).toBe('span_end_before_start')
    expect(errorCode(() => createRecord(db, admin, 1, { ...input, date: '2026-10-09', start: 400, end: 500 }, NOW))).toBe('record_in_future')
    expect(errorCode(() => updateRecord(db, admin, 1, 999, { start: 1, end: 2 }, NOW))).toBe('record_not_found')
    expect(records()).toHaveLength(1)
  })
  it('lists open records of earlier days', () => {
    stamp(db, anna, 'in', 'self', new Date('2026-10-06T05:42:00Z'))
    stamp(db, anna, 'in', 'self', new Date('2026-10-08T05:42:00Z'))
    expect(listOpenRecords(db, 1, '2026-10-08').map(r => [r.name, r.date, r.start])).toEqual([['Anna', '2026-10-06', 462]])
  })
  it('builds the month view with plan, records, credit and warnings', () => {
    applyToCells(db, admin, 1, [{ employeeId: anna, date: '2026-10-06' }], 'replace', { kind: 'shift', templateId: templateId(db, 'M') })
    applyToCells(db, admin, 1, [{ employeeId: anna, date: '2026-10-07' }], 'replace', { kind: 'code', codeId: codeId(db, 'sick') })
    createRecord(db, admin, 1, { employeeId: anna, date: '2026-10-06', start: 465, end: 700 }, NOW)
    createRecord(db, admin, 1, { employeeId: anna, date: '2026-10-06', start: 730, end: 965 }, NOW)
    const month = getTimeMonth(db, 1, anna, 2026, 10, '2026-10-08')
    expect(month.trackingFrom).toBe('2026-10-01')
    expect(month.absenceCodes.map(c => c.key)).toEqual(['vacation', 'special_leave', 'sick', 'training', 'school'])
    const oct6 = month.days.find(d => d.date === '2026-10-06')!
    expect(oct6).toMatchObject({ plannedMinutes: 465, recordedMinutes: 470, counted: 470, usesRecords: true, absence: false, warnings: [] })
    expect(oct6.plan).toContain('7:45–16:00')
    expect(month.days.find(d => d.date === '2026-10-07')).toMatchObject({ counted: 468, absence: true, warnings: [] })
    expect(month.days.find(d => d.date === '2026-10-08')).toMatchObject({ usesRecords: false })
  })
  it('flags only the four absence codes as removable absence and tells other plan entries apart', () => {
    applyToCells(db, admin, 1, [{ employeeId: anna, date: '2026-10-05' }], 'replace', { kind: 'shift', templateId: templateId(db, 'M') })
    applyToCells(db, admin, 1, [{ employeeId: anna, date: '2026-10-06' }], 'replace', { kind: 'code', codeId: codeId(db, 'vacation') })
    applyToCells(db, admin, 1, [{ employeeId: anna, date: '2026-10-07' }], 'replace', { kind: 'code', codeId: codeId(db, 'closure_day') })
    applyToCells(db, admin, 1, [{ employeeId: anna, date: '2026-10-09' }], 'replace', { kind: 'code', codeId: codeId(db, 'holiday') })
    const flags = (date: string) => {
      const day = getTimeMonth(db, 1, anna, 2026, 10, '2026-10-08').days.find(d => d.date === date)!
      return { absence: day.absence, otherEntries: day.otherEntries, targetCredit: day.targetCredit }
    }
    expect(flags('2026-10-05')).toEqual({ absence: false, otherEntries: true, targetCredit: false })
    expect(flags('2026-10-06')).toEqual({ absence: true, otherEntries: false, targetCredit: true })
    expect(flags('2026-10-07')).toEqual({ absence: false, otherEntries: true, targetCredit: true })
    expect(flags('2026-10-09')).toEqual({ absence: false, otherEntries: true, targetCredit: true })
    expect(flags('2026-10-12')).toEqual({ absence: false, otherEntries: false, targetCredit: false })
    // The balance still credits the daily target on the closure day.
    expect(getTimeMonth(db, 1, anna, 2026, 10, '2026-10-08').days.find(d => d.date === '2026-10-07')!.counted).toBe(468)
  })
})
