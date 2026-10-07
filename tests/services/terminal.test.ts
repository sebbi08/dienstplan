import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { setStampingOptions } from '../../server/services/employees'
import { clearPin, setPin, terminalStamp, terminalStatus } from '../../server/services/terminal'
import { loadTimeRecords } from '../../server/services/timeTracking'
import { addEmployee, createTestDb, errorCode } from '../helpers/fixtures'

const at = (iso: string) => new Date(iso)

describe('terminal', () => {
  let db: Db
  let anna: number
  let berta: number
  beforeEach(() => {
    db = createTestDb()
    anna = addEmployee(db, 'Anna')
    berta = addEmployee(db, 'Berta')
    addEmployee(db, 'Carl', { leftOn: '2026-09-30' })
    setTimeTrackingFrom(db, 1, '2026-10-01')
    setPin(db, 1, anna, '1234')
  })

  it('lists employed people with a PIN and whether they are clocked in', () => {
    expect(terminalStatus(db, 1, at('2026-10-06T06:00:00Z'))).toEqual([{ employeeId: anna, name: 'Anna', clockedIn: false }])
    terminalStamp(db, 1, anna, '1234', 'in', at('2026-10-06T06:00:00Z'))
    expect(terminalStatus(db, 1, at('2026-10-06T06:01:00Z'))[0]!.clockedIn).toBe(true)
  })
  it('stamps with the right PIN as terminal source', () => {
    terminalStamp(db, 1, anna, '1234', 'in', at('2026-10-06T06:00:00Z'))
    expect(loadTimeRecords(db, { employeeId: anna })[0]).toMatchObject({ source: 'terminal', start: 480 })
  })
  it('locks after 5 wrong PINs for 15 minutes and resets on success', () => {
    for (let attempt = 1; attempt <= 4; attempt++) {
      expect(errorCode(() => terminalStamp(db, 1, anna, '0000', 'in', at('2026-10-06T06:00:00Z')))).toBe('pin_invalid')
    }
    expect(errorCode(() => terminalStamp(db, 1, anna, '0000', 'in', at('2026-10-06T06:00:00Z')))).toBe('pin_locked')
    expect(errorCode(() => terminalStamp(db, 1, anna, '1234', 'in', at('2026-10-06T06:14:00Z')))).toBe('pin_locked')
    terminalStamp(db, 1, anna, '1234', 'in', at('2026-10-06T06:16:00Z'))
    expect(errorCode(() => terminalStamp(db, 1, anna, '0000', 'out', at('2026-10-06T06:17:00Z')))).toBe('pin_invalid')
  })
  it('refuses people who are no longer employed', () => {
    const dora = addEmployee(db, 'Dora', { leftOn: '2026-10-05' })
    setPin(db, 1, dora, '1234')
    expect(errorCode(() => terminalStamp(db, 1, dora, '1234', 'in', at('2026-10-06T06:00:00Z')))).toBe('employee_not_employed')
    expect(loadTimeRecords(db, { employeeId: dora })).toEqual([])
  })
  it('rejects people without PIN, bad PIN formats and cleared PINs', () => {
    expect(errorCode(() => terminalStamp(db, 1, berta, '1234', 'in', at('2026-10-06T06:00:00Z')))).toBe('pin_missing')
    expect(errorCode(() => setPin(db, 1, berta, '12a4'))).toBe('pin_format')
    clearPin(db, 1, anna)
    expect(errorCode(() => terminalStamp(db, 1, anna, '1234', 'in', at('2026-10-06T06:00:00Z')))).toBe('pin_missing')
  })
})

describe('terminal and stamping options', () => {
  it('always lets people stamp on the tablet, whatever their phone setting', () => {
    const db = createTestDb()
    const anna = addEmployee(db, 'Anna')
    setTimeTrackingFrom(db, 1, '2026-10-01')
    setPin(db, 1, anna, '1234')
    setStampingOptions(db, 1, anna, { stampVia: 'tablet', breakMode: 'stamp' })
    expect(terminalStatus(db, 1, at('2026-10-06T06:00:00Z'))).toEqual([{ employeeId: anna, name: 'Anna', clockedIn: false }])
    expect(terminalStamp(db, 1, anna, '1234', 'in', at('2026-10-06T06:00:00Z'))).toMatchObject({ source: 'terminal' })
  })
})
