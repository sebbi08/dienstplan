import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { employees, warningAcks } from '../../server/db/schema'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { saveEarlySickLeave } from '../../server/services/earlySickLeaves'
import { deleteLeftEmployee } from '../../server/services/employeeDeletion'
import { setStampingOptions } from '../../server/services/employees'
import { applyToCells } from '../../server/services/entries'
import { getMonthPlan } from '../../server/services/plan'
import { createRecord, getTimeMonth, stamp } from '../../server/services/timeTracking'
import { acknowledgeWarnings } from '../../server/services/warningAcks'
import { warningAckKey, warningSignature } from '../../shared/domain/warningList'
import type { Warning } from '../../shared/domain/warnings'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, codeId, createTestDb, templateId } from '../helpers/fixtures'

let db: Db
let admin: SessionUser
let anna: number
beforeEach(() => {
  db = createTestDb()
  admin = addUser(db, 'leitung', 'admin')
  anna = addEmployee(db, 'Anna')
})

type Extra = { breakStart?: number; breakEnd?: number; homeOffice?: boolean }
const special = (date: string, start: number, end: number, extra: Extra = {}) =>
  applyToCells(db, admin, 1, [{ employeeId: anna, date }], 'add', { kind: 'special', start, end, ...extra })
const shiftOn = (date: string, template: string) =>
  applyToCells(db, admin, 1, [{ employeeId: anna, date }], 'replace', { kind: 'shift', templateId: templateId(db, template) })
const PLAN_TYPES = new Set(['max_hours', 'short_rest'])
const RECORDED_TYPES = new Set(['max_hours_recorded', 'short_rest_recorded'])
const planLaw = (year: number, month: number, today: string, types = PLAN_TYPES) =>
  getMonthPlan(db, admin, 1, year, month, today).admin!.warnings.filter(warning => types.has(warning.type))
const record = (date: string, start: number, end: number) =>
  createRecord(db, admin, 1, { employeeId: anna, date, start, end }, new Date('2026-12-01T12:00:00Z'))
const timeLaw = (year: number, month: number, today: string) => getTimeMonth(db, 1, anna, year, month, today, 0).days
  .flatMap(day => day.warnings).filter(warning => RECORDED_TYPES.has(warning.type))

describe('working time law hints in the plan', () => {
  it('warns of more than 10 hours planned on a day, breaks left out, home office included', () => {
    special('2026-10-06', 420, 1050, { breakStart: 720, breakEnd: 750 }) // 7:00–17:30 with a 30 min break: 10:00 h
    special('2026-10-07', 420, 780)
    special('2026-10-07', 840, 1105, { homeOffice: true }) // 6:00 h + 4:25 h at home
    expect(planLaw(2026, 10, '2026-10-01')).toEqual([{ type: 'max_hours', date: '2026-10-07', employeeId: anna, minutes: 625 }])
  })
  it('checks weekends too and stays quiet on a full-day absence', () => {
    special('2026-10-10', 420, 1080)
    applyToCells(db, admin, 1, [{ employeeId: anna, date: '2026-10-12' }], 'replace', { kind: 'code', codeId: codeId(db, 'vacation') })
    expect(planLaw(2026, 10, '2026-10-01').map(w => [w.type, w.date])).toEqual([['max_hours', '2026-10-10']])
  })
  it('warns of less than 11 hours rest, also after the last day of the previous month', () => {
    // February 2027 starts on a Monday, so its weeks begin with it: the day before is loaded for the rest period only.
    special('2027-01-31', 840, 1320) // Sunday 14:00–22:00
    shiftOn('2027-02-01', 'F1') // 7:00–13:15
    special('2027-02-02', 600, 1260) // 10:00–21:00: 11 h, rest from 13:15 enough
    shiftOn('2027-02-03', 'F2') // from 7:30: 10:30 h rest
    expect(planLaw(2027, 2, '2027-01-15')).toEqual([
      { type: 'short_rest', date: '2027-02-01', employeeId: anna, from: 1320, to: 420 },
      { type: 'max_hours', date: '2027-02-02', employeeId: anna, minutes: 660 },
      { type: 'short_rest', date: '2027-02-03', employeeId: anna, from: 1260, to: 450 },
    ])
  })
  it('can be acknowledged, and the acknowledgement goes when the employee is deleted', () => {
    special('2026-10-06', 840, 1320)
    special('2026-10-07', 420, 780)
    const [warning] = planLaw(2026, 10, '2026-10-01') as [Warning]
    acknowledgeWarnings(db, 1, admin, [{ key: warningAckKey(warning), signature: warningSignature(warning) }])
    expect(getMonthPlan(db, admin, 1, 2026, 10, '2026-10-01').admin!.warningAcks.map(ack => [ack.key, ack.signature]))
      .toEqual([[`short_rest|2026-10-07|${anna}`, '1320-420']])
    db.update(employees).set({ leftOn: '2026-10-31' }).where(eq(employees.id, anna)).run()
    deleteLeftEmployee(db, admin, 1, anna, 'Anna', '2026-11-19')
    expect(db.select().from(warningAcks).all()).toEqual([])
  })
})

describe('working time law hints of the time tracking', () => {
  beforeEach(() => {
    setTimeTrackingFrom(db, 1, '2026-10-01')
    for (const date of ['2026-10-05', '2026-10-06', '2026-10-07']) shiftOn(date, 'M') // 7:45–16:00
  })

  it('warns of more than 10 hours stamped on the time page and in the plan', () => {
    record('2026-10-06', 400, 700)
    record('2026-10-06', 730, 1031) // 5:00 + 5:01 h
    const expected = [{ type: 'max_hours_recorded', date: '2026-10-06', employeeId: anna, minutes: 601 }]
    expect(timeLaw(2026, 10, '2026-10-20')).toEqual(expected)
    expect(planLaw(2026, 10, '2026-10-20', RECORDED_TYPES)).toEqual(expected)
  })
  it('counts the credited time: automatic breaks deduct the planned break', () => {
    record('2026-10-06', 420, 1050) // 7:00–17:30 without a clocked break
    expect(timeLaw(2026, 10, '2026-10-20')).toEqual([{ type: 'max_hours_recorded', date: '2026-10-06', employeeId: anna, minutes: 630 }])
    setStampingOptions(db, 1, anna, { stampVia: 'both', breakMode: 'auto' }) // M's break 11:40–12:10 deducted: 10:00 h
    expect(timeLaw(2026, 10, '2026-10-20')).toEqual([])
  })
  it('warns of less than 11 hours between the stamped times of two days, not for today or later', () => {
    record('2026-10-05', 465, 1305) // until 21:45
    record('2026-10-06', 465, 960) // from 7:45: 10:00 h rest
    record('2026-10-07', 525, 960) // from 8:45: 16:45 h rest
    const expected = [{ type: 'short_rest_recorded', date: '2026-10-06', employeeId: anna, from: 1305, to: 465 }]
    expect(timeLaw(2026, 10, '2026-10-20')).toEqual([{ type: 'max_hours_recorded', date: '2026-10-05', employeeId: anna, minutes: 840 }, ...expected])
    expect(planLaw(2026, 10, '2026-10-20', RECORDED_TYPES).filter(w => w.type === 'short_rest_recorded')).toEqual(expected)
    expect(timeLaw(2026, 10, '2026-10-06').filter(w => w.type === 'short_rest_recorded')).toEqual([])
  })
  it('compares with the last day of the previous month', () => {
    shiftOn('2026-11-02', 'M')
    special('2026-10-31', 840, 1320)
    record('2026-10-31', 840, 1320) // Saturday until 22:00
    record('2026-11-01', 420, 600) // Sunday from 7:00
    const expected = [{ type: 'short_rest_recorded', date: '2026-11-01', employeeId: anna, from: 1320, to: 420 }]
    expect(timeLaw(2026, 11, '2026-11-10')).toEqual(expected)
    expect(planLaw(2026, 11, '2026-11-10', RECORDED_TYPES)).toEqual(expected)
  })
  it('does not take the stamped end of a day marked „Im Dienst erkrankt“ for the next day\'s rest', () => {
    record('2026-10-05', 465, 1305) // until 21:45
    record('2026-10-06', 465, 960) // from 7:45: 10:00 h rest
    const rest = () => timeLaw(2026, 10, '2026-10-20').filter(w => w.type === 'short_rest_recorded')
    expect(rest()).toHaveLength(1)
    saveEarlySickLeave(db, admin, 1, { employeeId: anna, date: '2026-10-05', leftAt: 600, note: null }, new Date('2026-10-20T10:00:00Z'))
    expect(rest()).toEqual([])
    expect(planLaw(2026, 10, '2026-10-20', RECORDED_TYPES).filter(w => w.type === 'short_rest_recorded')).toEqual([])
  })
  it('shows only the stamped hints on a past day with stamps, the planned ones on days without', () => {
    shiftOn('2026-10-08', 'M')
    special('2026-10-06', 960, 1140) // M 7:45–16:00 plus 16:00–19:00 planned: 10:45 h
    special('2026-10-07', 960, 1140)
    special('2026-10-08', 960, 1140)
    record('2026-10-06', 465, 960) // stamped only 7:45–16:00
    stamp(db, anna, 'in', 'terminal', new Date('2026-10-07T05:45:00Z')) // only an open record: the plan still tells
    const all = new Set([...PLAN_TYPES, ...RECORDED_TYPES])
    expect(planLaw(2026, 10, '2026-10-20', all).map(w => [w.type, w.date])).toEqual([
      ['max_hours', '2026-10-07'], ['max_hours', '2026-10-08'],
    ])
  })
  it('does not use stamped days before „Zeiterfassung ab“', () => {
    record('2026-10-05', 465, 1305)
    record('2026-10-06', 465, 960)
    setTimeTrackingFrom(db, 1, '2026-10-06')
    expect(timeLaw(2026, 10, '2026-10-20')).toEqual([])
    expect(planLaw(2026, 10, '2026-10-20', RECORDED_TYPES)).toEqual([])
  })
})

describe('§ 4 Satz 3 ArbZG in the plan: more than 6 hours in a row without a break', () => {
  const stretchOf = (today = '2026-10-01') => getMonthPlan(db, admin, 1, 2026, 10, today).admin!.warnings
    .filter(warning => warning.type === 'long_stretch' || (warning.type === 'youth' && warning.rule === 'stretch'))
  it('warns an adult, a break of 30 minutes in time is enough', () => {
    special('2026-10-06', 420, 840) // 7:00–14:00 without a break
    special('2026-10-07', 420, 900, { breakStart: 660, breakEnd: 690 }) // break after 4 hours
    expect(stretchOf()).toEqual([{ type: 'long_stretch', date: '2026-10-06', employeeId: anna, minutes: 420 }])
  })
  it('leaves an under-18 to the JArbSchG (4:30 h) instead of warning twice', () => {
    db.update(employees).set({ birthday: '12-10', birthYear: 2010 }).where(eq(employees.id, anna)).run()
    special('2026-10-06', 420, 840)
    expect(stretchOf().map(warning => warning.type)).toEqual(['youth'])
  })
})
