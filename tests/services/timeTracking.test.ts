import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { setStampingOptions } from '../../server/services/employees'
import { applyToCells } from '../../server/services/entries'
import { getMonthPlan } from '../../server/services/plan'
import { actualTimeFor, loadTimeRecords, stamp } from '../../server/services/timeTracking'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, createTestDb, errorCode, templateId } from '../helpers/fixtures'

const at = (iso: string) => new Date(iso) // UTC; October 2026 is CEST (UTC+2)

describe('stamping', () => {
  let db: Db
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    anna = addEmployee(db, 'Anna')
    setTimeTrackingFrom(db, 1, '2026-10-01')
  })
  const records = () => loadTimeRecords(db, { employeeId: anna })

  it('clocks in and out with server time', () => {
    stamp(db, anna, 'in', 'self', at('2026-10-06T05:42:00Z'))
    stamp(db, anna, 'out', 'self', at('2026-10-06T09:40:00Z'))
    stamp(db, anna, 'in', 'terminal', at('2026-10-06T10:10:00Z'))
    expect(records().map(r => [r.date, r.start, r.end, r.source])).toEqual([
      ['2026-10-06', 462, 700, 'self'], ['2026-10-06', 730, null, 'terminal'],
    ])
  })
  it('rejects double clock-in and clock-out without clock-in', () => {
    stamp(db, anna, 'in', 'self', at('2026-10-06T05:42:00Z'))
    expect(errorCode(() => stamp(db, anna, 'in', 'terminal', at('2026-10-06T05:42:30Z')))).toBe('already_clocked_in')
    expect(records()).toHaveLength(1)
    stamp(db, anna, 'out', 'self', at('2026-10-06T09:40:00Z'))
    expect(errorCode(() => stamp(db, anna, 'out', 'self', at('2026-10-06T09:41:00Z')))).toBe('not_clocked_in')
  })
  it('lets a record left open yesterday stay open and clocks in today', () => {
    stamp(db, anna, 'in', 'self', at('2026-10-05T05:42:00Z'))
    stamp(db, anna, 'in', 'self', at('2026-10-06T05:45:00Z'))
    expect(errorCode(() => stamp(db, anna, 'out', 'self', at('2026-10-07T05:00:00Z')))).toBe('not_clocked_in')
    expect(records().map(r => [r.date, r.end])).toEqual([['2026-10-05', null], ['2026-10-06', null]])
  })
  it('allows a zero-minute record', () => {
    stamp(db, anna, 'in', 'self', at('2026-10-06T05:42:10Z'))
    stamp(db, anna, 'out', 'self', at('2026-10-06T05:42:50Z'))
    expect(records()[0]).toMatchObject({ start: 462, end: 462 })
  })
  it('refuses stamping before the start date or without tracking', () => {
    expect(errorCode(() => stamp(db, anna, 'in', 'self', at('2026-09-30T06:00:00Z')))).toBe('time_tracking_off')
    setTimeTrackingFrom(db, 1, null)
    expect(errorCode(() => stamp(db, anna, 'in', 'self', at('2026-10-06T06:00:00Z')))).toBe('time_tracking_off')
  })
  it('provides recorded minutes per day for the balance (closed records only)', () => {
    stamp(db, anna, 'in', 'self', at('2026-10-06T05:42:00Z'))
    stamp(db, anna, 'out', 'self', at('2026-10-06T09:40:00Z'))
    stamp(db, anna, 'in', 'self', at('2026-10-06T10:10:00Z'))
    const actual = actualTimeFor(db, 1, '2026-10-08')(anna)!
    expect(actual).toMatchObject({ from: '2026-10-01', today: '2026-10-08' })
    expect(actual.minutesByDate.get('2026-10-06')).toBe(238)
    expect(actualTimeFor(db, 1, '2026-09-30')(anna)).toBeUndefined()
  })
})

describe('stamping options per employee', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
    setTimeTrackingFrom(db, 1, '2026-10-01')
  })

  it('always allows the tablet and the own phone only when the Leitung chose both', () => {
    setStampingOptions(db, 1, anna, { stampVia: 'tablet', breakMode: 'stamp' })
    expect(errorCode(() => stamp(db, anna, 'in', 'self', at('2026-10-06T05:42:00Z')))).toBe('stamp_tablet_only')
    stamp(db, anna, 'in', 'terminal', at('2026-10-06T05:42:00Z'))
    setStampingOptions(db, 1, anna, { stampVia: 'both', breakMode: 'stamp' })
    stamp(db, anna, 'out', 'self', at('2026-10-06T14:00:00Z'))
    expect(loadTimeRecords(db, { employeeId: anna })).toHaveLength(1)
  })
  it('deducts the planned break when breaks are automatic and stops the break warning', () => {
    applyToCells(db, admin, 1, [{ employeeId: anna, date: '2026-10-06' }], 'replace', { kind: 'shift', templateId: templateId(db, 'M') })
    stamp(db, anna, 'in', 'self', at('2026-10-06T05:45:00Z')) // 7:45
    stamp(db, anna, 'out', 'self', at('2026-10-06T14:00:00Z')) // 16:00, no break clocked
    const minutes = () => actualTimeFor(db, 1, '2026-10-08')(anna)!.minutesByDate.get('2026-10-06')
    const breakWarning = () => getMonthPlan(db, admin, 2026, 10, '2026-10-08').admin!.warnings
      .some(w => w.type === 'break_rule' && w.date === '2026-10-06')
    expect([minutes(), breakWarning()]).toEqual([495, true])
    setStampingOptions(db, 1, anna, { stampVia: 'both', breakMode: 'auto' })
    expect([minutes(), breakWarning()]).toEqual([465, false]) // M's break 11:40–12:10 deducted
  })
})
