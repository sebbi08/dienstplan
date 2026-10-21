import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { saveEarlySickLeave } from '../../server/services/earlySickLeaves'
import { applyToCells } from '../../server/services/entries'
import { getMyTime } from '../../server/services/myTime'
import { setTimeMarkSettings } from '../../server/services/timeMarkSettings'
import { createRecord, getTimeMonth, loadTimeRecords, stamp, updateRecord } from '../../server/services/timeTracking'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addHelpOut, addUser, codeId, createTestDb, templateId } from '../helpers/fixtures'

const NOW = new Date('2026-10-08T10:00:00Z') // 12:00 Berlin on 08.10.
const TODAY = '2026-10-08'

describe('late arrival and early leave marks in the time tracking', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna', { validFrom: '2026-10-01' })
    setTimeTrackingFrom(db, 1, '2026-10-01')
  })
  /** An M shift (7:45–16:00) of the home plan. */
  const planM = (date: string) =>
    applyToCells(db, admin, 1, [{ employeeId: anna, date }], 'replace', { kind: 'shift', templateId: templateId(db, 'M') })
  const record = (date: string, start: number, end: number) =>
    createRecord(db, admin, 1, { employeeId: anna, date, start, end }, NOW)
  const month = (nowMinutes?: number) => getTimeMonth(db, 1, anna, 2026, 10, TODAY, nowMinutes)
  const day = (date: string, nowMinutes?: number) => month(nowMinutes).days.find(candidate => candidate.date === date)!

  it('marks a late arrival and an early leave beyond the tolerance and sums them under the month', () => {
    planM('2026-10-05')
    planM('2026-10-06')
    planM('2026-10-07')
    record('2026-10-05', 475, 960) // 10 min late
    record('2026-10-06', 465, 930) // 30 min early
    record('2026-10-07', 470, 955) // within the 5 minutes
    expect(day('2026-10-05')).toMatchObject({ lateMinutes: 10, earlyMinutes: null })
    expect(day('2026-10-06')).toMatchObject({ lateMinutes: null, earlyMinutes: 30 })
    expect(day('2026-10-07')).toMatchObject({ lateMinutes: null, earlyMinutes: null })
    expect(month().marks).toEqual({
      lateCount: 1, lateMinutes: 10, earlyCount: 1, earlyMinutes: 30, toleranceMinutes: 5, markEarlyLeave: true,
    })
  })

  it('follows the facility\'s tolerance and early-leave switch', () => {
    planM('2026-10-05')
    record('2026-10-05', 475, 930)
    setTimeMarkSettings(db, 1, { toleranceMinutes: 10, markEarlyLeave: false })
    expect(day('2026-10-05')).toMatchObject({ lateMinutes: null, earlyMinutes: null })
    expect(month().marks).toMatchObject({ lateCount: 0, earlyCount: 0, toleranceMinutes: 10, markEarlyLeave: false })
    setTimeMarkSettings(db, 1, { toleranceMinutes: 9, markEarlyLeave: true })
    expect(day('2026-10-05')).toMatchObject({ lateMinutes: 10, earlyMinutes: 30 })
  })

  it('evaluates the times after the Leitung corrected them', () => {
    planM('2026-10-05')
    record('2026-10-05', 500, 960)
    expect(day('2026-10-05').lateMinutes).toBe(35)
    const [stamped] = loadTimeRecords(db, { employeeId: anna })
    updateRecord(db, admin, 1, stamped!.id, { start: 465, end: 960 }, NOW)
    expect(day('2026-10-05').lateMinutes).toBeNull()
  })

  it('marks nothing on absence days, days without a duty or a still open stay', () => {
    applyToCells(db, admin, 1, [{ employeeId: anna, date: '2026-10-05' }], 'replace', { kind: 'code', codeId: codeId(db, 'sick') })
    record('2026-10-05', 600, 700)
    record('2026-10-06', 600, 700) // no plan at all
    planM('2026-10-07')
    stamp(db, anna, 'in', 'self', new Date('2026-10-07T06:00:00Z')) // 8:00, never clocked out
    expect(day('2026-10-05')).toMatchObject({ lateMinutes: null, earlyMinutes: null })
    expect(day('2026-10-06')).toMatchObject({ lateMinutes: null, earlyMinutes: null })
    expect(day('2026-10-07')).toMatchObject({ lateMinutes: 15, earlyMinutes: null })
  })

  it('today marks a late arrival at once and early leaving only once the planned end has passed', () => {
    planM(TODAY)
    stamp(db, anna, 'in', 'self', new Date('2026-10-08T06:00:00Z')) // 8:00
    stamp(db, anna, 'out', 'self', new Date('2026-10-08T09:40:00Z')) // 11:40, e.g. a stamped break
    expect(day(TODAY, 720)).toMatchObject({ lateMinutes: 15, earlyMinutes: null })
    expect(day(TODAY, 960)).toMatchObject({ lateMinutes: 15, earlyMinutes: 260 })
  })

  it('leaves no early-leave mark on a day marked "Im Dienst erkrankt"', () => {
    planM('2026-10-05')
    record('2026-10-05', 480, 700)
    saveEarlySickLeave(db, admin, 1, { employeeId: anna, date: '2026-10-05', leftAt: null }, NOW)
    expect(day('2026-10-05')).toMatchObject({ lateMinutes: 15, earlyMinutes: null })
  })

  it('compares with a help-out duty in another facility like the time warnings do', () => {
    const krippe = addFacility(db, 'Krippe')
    const leitungB = addUser(db, 'leitung-b', 'admin', null, krippe)
    addHelpOut(db, anna, krippe, 2026, 10)
    applyToCells(db, leitungB, krippe, [{ employeeId: anna, date: '2026-10-06' }], 'replace',
      { kind: 'shift', templateId: templateId(db, 'F1', krippe) })
    expect(day('2026-10-06').plan).toContain('7:00–13:15')
    record('2026-10-06', 440, 795) // F1 7:00–13:15, came 7:20
    expect(day('2026-10-06').lateMinutes).toBe(20)
  })

  it('never puts the marks into the staff member\'s own time view', () => {
    planM('2026-10-05')
    record('2026-10-05', 500, 900)
    expect(day('2026-10-05')).toMatchObject({ lateMinutes: 35, earlyMinutes: 60 })
    const viewer = addUser(db, 'anna', 'observer', anna)
    const mine = JSON.stringify(getMyTime(db, viewer, 2026, 10, NOW))
    expect(mine).not.toMatch(/late|early|marks|tolerance/i)
  })
})
