import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { employees } from '../../server/db/schema'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { getBalanceOverview } from '../../server/services/balances'
import { getEmployee, listEmployees, setStampingOptions } from '../../server/services/employees'
import { applyToCells } from '../../server/services/entries'
import { clearPin, setPin, terminalStamp, terminalStatus, unlockPin } from '../../server/services/terminal'
import { actualTimeFor, loadTimeRecords } from '../../server/services/timeTracking'
import type { ServiceError } from '../../server/lib/errors'
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
    setPin(db, 1, anna, '123456')
  })

  it('lists employed people with a PIN and whether they are clocked in', () => {
    expect(terminalStatus(db, 1, at('2026-10-06T06:00:00Z'))).toEqual([{ employeeId: anna, name: 'Anna', clockedIn: false }])
    terminalStamp(db, 1, anna, '123456', 'in', at('2026-10-06T06:00:00Z'))
    expect(terminalStatus(db, 1, at('2026-10-06T06:01:00Z'))[0]!.clockedIn).toBe(true)
  })
  it('stamps with the right PIN as terminal source', () => {
    terminalStamp(db, 1, anna, '123456', 'in', at('2026-10-06T06:00:00Z'))
    expect(loadTimeRecords(db, { employeeId: anna })[0]).toMatchObject({ source: 'terminal', start: 480 })
  })
  it('locks after 5 wrong PINs for 15 minutes and resets on success', () => {
    for (let attempt = 1; attempt <= 4; attempt++) {
      expect(errorCode(() => terminalStamp(db, 1, anna, '000000', 'in', at('2026-10-06T06:00:00Z')))).toBe('pin_invalid')
    }
    expect(errorCode(() => terminalStamp(db, 1, anna, '000000', 'in', at('2026-10-06T06:00:00Z')))).toBe('pin_locked')
    expect(errorCode(() => terminalStamp(db, 1, anna, '123456', 'in', at('2026-10-06T06:14:00Z')))).toBe('pin_locked')
    terminalStamp(db, 1, anna, '123456', 'in', at('2026-10-06T06:16:00Z'))
    expect(errorCode(() => terminalStamp(db, 1, anna, '000000', 'out', at('2026-10-06T06:17:00Z')))).toBe('pin_invalid')
  })
  it('refuses people who are no longer employed', () => {
    const dora = addEmployee(db, 'Dora', { leftOn: '2026-10-05' })
    setPin(db, 1, dora, '123456')
    expect(errorCode(() => terminalStamp(db, 1, dora, '123456', 'in', at('2026-10-06T06:00:00Z')))).toBe('employee_not_employed')
    expect(loadTimeRecords(db, { employeeId: dora })).toEqual([])
  })
  it('rejects people without PIN, bad PIN formats and cleared PINs', () => {
    expect(errorCode(() => terminalStamp(db, 1, berta, '123456', 'in', at('2026-10-06T06:00:00Z')))).toBe('pin_missing')
    expect(errorCode(() => setPin(db, 1, berta, '12a4'))).toBe('pin_format')
    clearPin(db, 1, anna)
    expect(errorCode(() => terminalStamp(db, 1, anna, '123456', 'in', at('2026-10-06T06:00:00Z')))).toBe('pin_missing')
  })
})

describe('six-digit PIN with escalating lock', () => {
  let db: Db
  let anna: number
  const T0 = at('2026-10-06T06:00:00Z')
  const minutesLater = (minutes: number) => new Date(T0.getTime() + minutes * 60_000)
  const stampWith = (pin: string, when: Date) => errorCode(() => terminalStamp(db, 1, anna, pin, 'in', when))
  /** Four wrong tries (pin_invalid) and the fifth one, whose code is returned. */
  const fiveWrong = (when: Date) => {
    for (let attempt = 1; attempt < 5; attempt++) expect(stampWith('000000', when)).toBe('pin_invalid')
    return stampWith('000000', when)
  }
  const row = () => db.select().from(employees).where(eq(employees.id, anna)).get()!
  beforeEach(() => {
    db = createTestDb()
    anna = addEmployee(db, 'Anna')
    setTimeTrackingFrom(db, 1, '2026-10-01')
    setPin(db, 1, anna, '123456')
  })

  it('accepts exactly six digits as PIN', () => {
    for (const pin of ['1234', '12345', '1234567', '12a456', ' 123456', '']) {
      expect(errorCode(() => setPin(db, 1, anna, pin)), pin).toBe('pin_format')
    }
    setPin(db, 1, anna, '012345')
    expect(stampWith('012345', T0)).toBeNull()
  })

  it('says whether a try just locked the PIN, and until when it is locked', () => {
    const detailsOf = (pin: string, when: Date) => {
      try {
        terminalStamp(db, 1, anna, pin, 'in', when)
      }
      catch (error) {
        return { code: (error as ServiceError).code, details: (error as ServiceError).details }
      }
      throw new Error('no error')
    }
    for (let attempt = 1; attempt < 5; attempt++) {
      expect(detailsOf('000000', T0)).toEqual({ code: 'pin_invalid', details: { remaining: 5 - attempt } })
    }
    const until = minutesLater(15).toISOString()
    expect(detailsOf('000000', T0)).toEqual({ code: 'pin_locked', details: { lockedUntil: until, newLock: true } })
    expect(detailsOf('123456', minutesLater(3))).toEqual({ code: 'pin_locked', details: { lockedUntil: until, newLock: false } })
    fiveWrong(minutesLater(15))
    fiveWrong(minutesLater(45))
    expect(detailsOf('123456', minutesLater(46)))
      .toEqual({ code: 'pin_locked_permanent', details: { lockedUntil: null, newLock: false } })
  })

  it('locks for 15 minutes, then 30 minutes, then until a manager unlocks', () => {
    expect(fiveWrong(T0)).toBe('pin_locked')
    expect(row()).toMatchObject({ pinFailed: 0, pinLockLevel: 1, pinLockedUntil: minutesLater(15).toISOString() })
    expect(stampWith('123456', minutesLater(14))).toBe('pin_locked')

    expect(fiveWrong(minutesLater(15))).toBe('pin_locked_long')
    expect(row()).toMatchObject({ pinFailed: 0, pinLockLevel: 2, pinLockedUntil: minutesLater(45).toISOString() })
    expect(stampWith('123456', minutesLater(44))).toBe('pin_locked_long')

    expect(fiveWrong(minutesLater(45))).toBe('pin_locked_permanent')
    expect(row()).toMatchObject({ pinFailed: 0, pinLockLevel: 3, pinLockedUntil: null })
    // Even days later and with the right PIN.
    expect(stampWith('123456', minutesLater(5 * 24 * 60))).toBe('pin_locked_permanent')
    expect(loadTimeRecords(db, { employeeId: anna })).toEqual([])
  })

  it('resets the attempts and the lock level with the right PIN', () => {
    for (let attempt = 1; attempt <= 4; attempt++) expect(stampWith('000000', T0)).toBe('pin_invalid')
    expect(stampWith('123456', T0)).toBeNull()
    expect(row()).toMatchObject({ pinFailed: 0, pinLockLevel: 0 })
    expect(fiveWrong(minutesLater(1))).toBe('pin_locked')
    expect(stampWith('123456', minutesLater(16))).toBe('already_clocked_in')
    expect(row()).toMatchObject({ pinFailed: 0, pinLockLevel: 0, pinLockedUntil: null })
    // The next lock starts again at 15 minutes.
    expect(fiveWrong(minutesLater(17))).toBe('pin_locked')
    expect(row().pinLockedUntil).toBe(minutesLater(32).toISOString())
  })

  it('lets the Leitung unlock the PIN of its own staff, which resets everything', () => {
    fiveWrong(T0)
    fiveWrong(minutesLater(15))
    expect(fiveWrong(minutesLater(45))).toBe('pin_locked_permanent')
    const krippe = addFacility(db, 'Krippe')
    expect(errorCode(() => unlockPin(db, krippe, anna))).toBe('employee_not_found')
    expect(row().pinLockLevel).toBe(3)

    unlockPin(db, 1, anna)
    expect(row()).toMatchObject({ pinFailed: 0, pinLockLevel: 0, pinLockedUntil: null })
    expect(stampWith('123456', minutesLater(46))).toBeNull()
    expect(fiveWrong(minutesLater(47))).toBe('pin_locked')
    unlockPin(db, 1, anna)
    expect(stampWith('123456', minutesLater(48))).toBe('already_clocked_in')
  })

  it('resets the lock when a new PIN is set or the PIN is cleared', () => {
    fiveWrong(T0)
    fiveWrong(minutesLater(15))
    setPin(db, 1, anna, '654321')
    expect(row()).toMatchObject({ pinFailed: 0, pinLockLevel: 0, pinLockedUntil: null })
    expect(stampWith('654321', minutesLater(16))).toBeNull()
    fiveWrong(minutesLater(17))
    clearPin(db, 1, anna)
    expect(row()).toMatchObject({ pinHash: null, pinFailed: 0, pinLockLevel: 0, pinLockedUntil: null })
  })

  it('shows managers who has no PIN and whose PIN is locked', () => {
    const berta = addEmployee(db, 'Berta')
    const today = '2026-10-06'
    expect(listEmployees(db, 1, today, 'admin').map(employee => [employee.name, employee.hasPin]))
      .toEqual([['Anna', true], ['Berta', false]])
    const detail = (now: Date) => getEmployee(db, 1, anna, today, 'admin', now)
    expect(detail(T0)).toMatchObject({ hasPin: true, pinLockedUntil: null, pinLockedPermanently: false, pinLockLevel: 0 })
    expect(getEmployee(db, 1, berta, today, 'admin', T0)).toMatchObject({ hasPin: false, pinLockedUntil: null, pinLockedPermanently: false })
    fiveWrong(T0)
    expect(detail(minutesLater(1))).toMatchObject({ pinLockedUntil: minutesLater(15).toISOString(), pinLockedPermanently: false, pinLockLevel: 1 })
    // An expired lock is no longer shown as running, but its level stays visible.
    expect(detail(minutesLater(15))).toMatchObject({ pinLockedUntil: null, pinLockedPermanently: false, pinLockLevel: 1 })
    fiveWrong(minutesLater(15))
    fiveWrong(minutesLater(45))
    expect(detail(minutesLater(46))).toMatchObject({ pinLockedUntil: null, pinLockedPermanently: true, pinLockLevel: 3 })
  })
})

describe('terminal and stamping options', () => {
  it('always lets people stamp on the tablet, whatever their phone setting', () => {
    const db = createTestDb()
    const anna = addEmployee(db, 'Anna')
    setTimeTrackingFrom(db, 1, '2026-10-01')
    setPin(db, 1, anna, '123456')
    setStampingOptions(db, 1, anna, { stampVia: 'tablet', breakMode: 'stamp' })
    expect(terminalStatus(db, 1, at('2026-10-06T06:00:00Z'))).toEqual([{ employeeId: anna, name: 'Anna', clockedIn: false }])
    expect(terminalStamp(db, 1, anna, '123456', 'in', at('2026-10-06T06:00:00Z'))).toMatchObject({ source: 'terminal' })
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
    setPin(db, 1, anna, '123456')
    setPin(db, krippe, kim, '654321')
    addHelpOut(db, anna, krippe, 2026, 10)
    applyToCells(db, leitungB, krippe, [{ employeeId: anna, date: tuesday }], 'replace', helpOutShift())
  })

  it('lists the helper on the day of the help-out and lets them stamp there', () => {
    expect(terminalStatus(db, krippe, at('2026-10-06T06:00:00Z'))).toEqual([
      { employeeId: kim, name: 'Kim', clockedIn: false },
      { employeeId: anna, name: 'Anna', clockedIn: false },
    ])
    expect(terminalStamp(db, krippe, anna, '123456', 'in', at('2026-10-06T06:00:00Z'))).toMatchObject({ employeeId: anna, source: 'terminal', start: 480 })
    expect(terminalStatus(db, krippe, at('2026-10-06T06:01:00Z')).find(person => person.employeeId === anna)!.clockedIn).toBe(true)
    expect(terminalStamp(db, krippe, anna, '123456', 'out', at('2026-10-06T10:00:00Z'))).toMatchObject({ end: 720 })
  })
  it('does not list the helper on other days and refuses them before the PIN is checked', () => {
    expect(terminalStatus(db, krippe, at('2026-10-05T06:00:00Z')).map(person => person.employeeId)).toEqual([kim])
    for (let attempt = 1; attempt <= 6; attempt++) {
      expect(errorCode(() => terminalStamp(db, krippe, anna, '000000', 'in', at('2026-10-05T06:00:00Z')))).toBe('employee_not_found')
    }
    // No attempt was counted, so the right PIN still works (here at home).
    expect(terminalStamp(db, 1, anna, '123456', 'in', at('2026-10-05T06:00:00Z'))).toMatchObject({ employeeId: anna })
  })
  it('does not let another facility list or accept the helper', () => {
    const hort = addFacility(db, 'Hort')
    expect(errorCode(() => terminalStamp(db, hort, anna, '123456', 'in', at('2026-10-06T06:00:00Z')))).toBe('employee_not_found')
    expect(terminalStatus(db, hort, at('2026-10-06T06:00:00Z'))).toEqual([])
  })
  it('leaves the PIN of the helper to the home facility', () => {
    expect(errorCode(() => setPin(db, krippe, anna, '999999'))).toBe('employee_not_found')
    expect(errorCode(() => clearPin(db, krippe, anna))).toBe('employee_not_found')
  })
  it('lists only helpers with a PIN who are employed, and refuses the others', () => {
    const berta = addEmployee(db, 'Berta')
    const dora = addEmployee(db, 'Dora', { leftOn: '2026-10-05' })
    setPin(db, 1, dora, '123456')
    addHelpOut(db, berta, krippe, 2026, 10)
    addHelpOut(db, dora, krippe, 2026, 10)
    const leitungB = addUser(db, 'leitung-b2', 'admin', null, krippe)
    applyToCells(db, leitungB, krippe, [{ employeeId: berta, date: tuesday }, { employeeId: dora, date: tuesday }], 'replace', helpOutShift())
    expect(terminalStatus(db, krippe, at('2026-10-06T06:00:00Z')).map(person => person.employeeId)).toEqual([kim, anna])
    expect(errorCode(() => terminalStamp(db, krippe, berta, '123456', 'in', at('2026-10-06T06:00:00Z')))).toBe('pin_missing')
    expect(errorCode(() => terminalStamp(db, krippe, dora, '123456', 'in', at('2026-10-06T06:00:00Z')))).toBe('employee_not_employed')
  })
  it('does not list a helper whose home facility does not track time (yet)', () => {
    const hort = addFacility(db, 'Hort')
    const zoe = addEmployee(db, 'Zoe', { facilityId: hort })
    setPin(db, hort, zoe, '555555')
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
    expect(terminalStamp(db, 1, anna, '123456', 'in', at('2026-10-06T06:00:00Z'))).toMatchObject({ source: 'terminal' })
  })
  it("counts the record in the helper's home balance", () => {
    const balanceOf = () => getBalanceOverview(db, 1, 2026, 10, '2026-10-07').find(row => row.employeeId === anna)!.today
    const before = balanceOf()
    terminalStamp(db, krippe, anna, '123456', 'in', at('2026-10-06T06:00:00Z'))
    terminalStamp(db, krippe, anna, '123456', 'out', at('2026-10-06T10:00:00Z'))
    expect(actualTimeFor(db, 1, '2026-10-07')(anna)!.minutesByDate.get(tuesday)).toBe(240)
    expect(balanceOf()).not.toBe(before)
    expect(loadTimeRecords(db, { facilityId: 1 }).map(record => record.employeeId)).toEqual([anna])
    expect(loadTimeRecords(db, { facilityId: krippe })).toEqual([])
  })
})
