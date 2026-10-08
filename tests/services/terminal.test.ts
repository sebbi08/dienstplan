import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { getBalanceOverview } from '../../server/services/balances'
import { setStampingOptions } from '../../server/services/employees'
import { applyToCells } from '../../server/services/entries'
import { clearPin, setPin, terminalStamp, terminalStatus } from '../../server/services/terminal'
import { actualTimeFor, loadTimeRecords } from '../../server/services/timeTracking'
import { addEmployee, addFacility, addHelpOut, addUser, createTestDb, errorCode, templateId } from '../helpers/fixtures'

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

describe('terminal for helpers', () => {
  const tuesday = '2026-10-06'
  let db: Db
  let krippe: number
  let anna: number
  let kim: number
  const helpOutShift = () => ({ kind: 'shift' as const, templateId: templateId(db, 'M', krippe) })

  beforeEach(() => {
    db = createTestDb()
    krippe = addFacility(db, 'Krippe')
    const leitungB = addUser(db, 'leitung-b', 'admin', null, krippe)
    anna = addEmployee(db, 'Anna')
    kim = addEmployee(db, 'Kim', { facilityId: krippe })
    setTimeTrackingFrom(db, 1, '2026-10-01')
    setTimeTrackingFrom(db, krippe, '2026-10-01')
    setPin(db, 1, anna, '1234')
    setPin(db, krippe, kim, '4321')
    addHelpOut(db, anna, krippe, 2026, 10)
    applyToCells(db, leitungB, krippe, [{ employeeId: anna, date: tuesday }], 'replace', helpOutShift())
  })

  it('lists the helper on the day of the help-out and lets them stamp there', () => {
    expect(terminalStatus(db, krippe, at('2026-10-06T06:00:00Z'))).toEqual([
      { employeeId: kim, name: 'Kim', clockedIn: false },
      { employeeId: anna, name: 'Anna', clockedIn: false },
    ])
    expect(terminalStamp(db, krippe, anna, '1234', 'in', at('2026-10-06T06:00:00Z'))).toMatchObject({ employeeId: anna, source: 'terminal', start: 480 })
    expect(terminalStatus(db, krippe, at('2026-10-06T06:01:00Z')).find(person => person.employeeId === anna)!.clockedIn).toBe(true)
    expect(terminalStamp(db, krippe, anna, '1234', 'out', at('2026-10-06T10:00:00Z'))).toMatchObject({ end: 720 })
  })
  it('does not list the helper on other days and refuses them before the PIN is checked', () => {
    expect(terminalStatus(db, krippe, at('2026-10-05T06:00:00Z')).map(person => person.employeeId)).toEqual([kim])
    for (let attempt = 1; attempt <= 6; attempt++) {
      expect(errorCode(() => terminalStamp(db, krippe, anna, '0000', 'in', at('2026-10-05T06:00:00Z')))).toBe('employee_not_found')
    }
    // No attempt was counted, so the right PIN still works (here at home).
    expect(terminalStamp(db, 1, anna, '1234', 'in', at('2026-10-05T06:00:00Z'))).toMatchObject({ employeeId: anna })
  })
  it('does not let another facility list or accept the helper', () => {
    const hort = addFacility(db, 'Hort')
    expect(errorCode(() => terminalStamp(db, hort, anna, '1234', 'in', at('2026-10-06T06:00:00Z')))).toBe('employee_not_found')
    expect(terminalStatus(db, hort, at('2026-10-06T06:00:00Z'))).toEqual([])
  })
  it('leaves the PIN of the helper to the home facility', () => {
    expect(errorCode(() => setPin(db, krippe, anna, '9999'))).toBe('employee_not_found')
    expect(errorCode(() => clearPin(db, krippe, anna))).toBe('employee_not_found')
  })
  it('lists only helpers with a PIN who are employed, and refuses the others', () => {
    const berta = addEmployee(db, 'Berta')
    const dora = addEmployee(db, 'Dora', { leftOn: '2026-10-05' })
    setPin(db, 1, dora, '1234')
    addHelpOut(db, berta, krippe, 2026, 10)
    addHelpOut(db, dora, krippe, 2026, 10)
    const leitungB = addUser(db, 'leitung-b2', 'admin', null, krippe)
    applyToCells(db, leitungB, krippe, [{ employeeId: berta, date: tuesday }, { employeeId: dora, date: tuesday }], 'replace', helpOutShift())
    expect(terminalStatus(db, krippe, at('2026-10-06T06:00:00Z')).map(person => person.employeeId)).toEqual([kim, anna])
    expect(errorCode(() => terminalStamp(db, krippe, berta, '1234', 'in', at('2026-10-06T06:00:00Z')))).toBe('pin_missing')
    expect(errorCode(() => terminalStamp(db, krippe, dora, '1234', 'in', at('2026-10-06T06:00:00Z')))).toBe('employee_not_employed')
  })
  it('does not list a helper whose home facility does not track time (yet)', () => {
    const hort = addFacility(db, 'Hort')
    const zoe = addEmployee(db, 'Zoe', { facilityId: hort })
    setPin(db, hort, zoe, '5555')
    addHelpOut(db, zoe, krippe, 2026, 10)
    const leitungB = addUser(db, 'leitung-b3', 'admin', null, krippe)
    applyToCells(db, leitungB, krippe, [{ employeeId: zoe, date: tuesday }], 'replace', helpOutShift())
    expect(terminalStatus(db, krippe, at('2026-10-06T06:00:00Z')).map(person => person.employeeId)).toEqual([kim, anna])
    setTimeTrackingFrom(db, hort, '2026-10-07')
    expect(terminalStatus(db, krippe, at('2026-10-06T06:00:00Z')).map(person => person.employeeId)).toEqual([kim, anna])
    setTimeTrackingFrom(db, hort, '2026-10-06')
    expect(terminalStatus(db, krippe, at('2026-10-06T06:00:00Z')).map(person => person.employeeId)).toEqual([kim, anna, zoe])
  })
  it('still works on the home tablet on the help-out day', () => {
    expect(terminalStatus(db, 1, at('2026-10-06T06:00:00Z')).map(person => person.employeeId)).toEqual([anna])
    expect(terminalStamp(db, 1, anna, '1234', 'in', at('2026-10-06T06:00:00Z'))).toMatchObject({ source: 'terminal' })
  })
  it("counts the record in the helper's home balance", () => {
    const balanceOf = () => getBalanceOverview(db, 1, 2026, 10, '2026-10-07').find(row => row.employeeId === anna)!.today
    const before = balanceOf()
    terminalStamp(db, krippe, anna, '1234', 'in', at('2026-10-06T06:00:00Z'))
    terminalStamp(db, krippe, anna, '1234', 'out', at('2026-10-06T10:00:00Z'))
    expect(actualTimeFor(db, 1, '2026-10-07')(anna)!.minutesByDate.get(tuesday)).toBe(240)
    expect(balanceOf()).not.toBe(before)
    expect(loadTimeRecords(db, { facilityId: 1 }).map(record => record.employeeId)).toEqual([anna])
    expect(loadTimeRecords(db, { facilityId: krippe })).toEqual([])
  })
})
