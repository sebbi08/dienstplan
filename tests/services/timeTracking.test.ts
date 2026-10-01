import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { actualTimeFor, loadTimeRecords, stamp } from '../../server/services/timeTracking'
import { addEmployee, createTestDb, errorCode } from '../helpers/fixtures'

const at = (iso: string) => new Date(iso) // UTC; October 2026 is CEST (UTC+2)

describe('stamping', () => {
  let db: Db
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    anna = addEmployee(db, 'Anna')
    setTimeTrackingFrom(db, '2026-10-01')
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
    setTimeTrackingFrom(db, null)
    expect(errorCode(() => stamp(db, anna, 'in', 'self', at('2026-10-06T06:00:00Z')))).toBe('time_tracking_off')
  })
  it('provides recorded minutes per day for the balance (closed records only)', () => {
    stamp(db, anna, 'in', 'self', at('2026-10-06T05:42:00Z'))
    stamp(db, anna, 'out', 'self', at('2026-10-06T09:40:00Z'))
    stamp(db, anna, 'in', 'self', at('2026-10-06T10:10:00Z'))
    const actual = actualTimeFor(db, '2026-10-08')(anna)!
    expect(actual).toMatchObject({ from: '2026-10-01', today: '2026-10-08' })
    expect(actual.minutesByDate.get('2026-10-06')).toBe(238)
    expect(actualTimeFor(db, '2026-09-30')(anna)).toBeUndefined()
  })
})
