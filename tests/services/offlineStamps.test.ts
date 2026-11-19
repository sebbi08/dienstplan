import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { employees, offlineStamps } from '../../server/db/schema'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { getMyTime } from '../../server/services/myTime'
import {
  allowOfflineSync, checkOfflineStampHint, listOfflineStampHints, offlineStampReminders, syncOfflineStamps, type OfflineStampInput,
} from '../../server/services/offlineStamps'
import { OFFLINE_MAX_OPEN_HINTS } from '../../shared/domain/offlineStamps'
import { setPin, terminalStamp } from '../../server/services/terminal'
import { getTimeMonth, loadTimeRecords } from '../../server/services/timeTracking'
import { rolePermissions } from '../../server/services/permissions'
import { applyToCells } from '../../server/services/entries'
import { addEmployee, addFacility, addHelpOut, addUser, createTestDb, errorCode, templateId } from '../helpers/fixtures'

/** Server time of the sync: Thursday 19 November 2026, 10:00 in Berlin. */
const NOW = new Date('2026-11-19T09:00:00Z')
let db: Db
let anna: number
let berta: number
let counter = 0

/** A stamp from the tablet's queue; the time is Berlin local time of 19 November unless a full ISO string is given. */
function stamp(employeeId: number, action: 'in' | 'out', time: string, pin = '123456'): OfflineStampInput {
  counter++
  const stampedAt = time.length === 5 ? `2026-11-19T${time}:00+01:00` : time
  return { clientId: `client-${counter}-${Math.random().toString(36).slice(2)}`, employeeId, pin, action, stampedAt }
}
const sync = (stamps: OfflineStampInput[], clientNow = NOW.toISOString(), now = NOW) =>
  syncOfflineStamps(db, 1, { clientNow, stamps }, now).results
const recordsOf = (employeeId: number) => loadTimeRecords(db, { employeeId })
const pinState = (employeeId: number) => db.select().from(employees).where(eq(employees.id, employeeId)).get()!

beforeEach(() => {
  db = createTestDb()
  anna = addEmployee(db, 'Anna')
  berta = addEmployee(db, 'Berta')
  setTimeTrackingFrom(db, 1, '2026-10-01')
  setPin(db, 1, anna, '123456')
  setPin(db, 1, berta, '654321')
})

describe('offline stamps from the tablet', () => {
  it('records Kommt and Geht at the tablet time with the mark „offline erfasst“', () => {
    const kommt = stamp(anna, 'in', '07:58')
    const geht = stamp(anna, 'out', '09:45')
    expect(sync([kommt, geht])).toEqual([
      { clientId: kommt.clientId, status: 'recorded', reason: null },
      { clientId: geht.clientId, status: 'recorded', reason: null },
    ])
    expect(recordsOf(anna)).toEqual([expect.objectContaining({
      date: '2026-11-19', start: 7 * 60 + 58, end: 9 * 60 + 45, source: 'terminal', offline: true, clockSkewMinutes: null,
    })])
  })

  it('closes an online Kommt with an offline Geht and marks the record offline', () => {
    terminalStamp(db, 1, anna, '123456', 'in', new Date('2026-11-19T06:30:00Z'))
    expect(recordsOf(anna)[0]).toMatchObject({ offline: false })
    sync([stamp(anna, 'out', '09:30')])
    expect(recordsOf(anna)).toEqual([expect.objectContaining({ start: 450, end: 570, offline: true })])
  })

  it('takes a stamp sent twice only once (same client id)', () => {
    const kommt = stamp(anna, 'in', '07:58')
    sync([kommt])
    expect(sync([kommt])).toEqual([{ clientId: kommt.clientId, status: 'duplicate', reason: null }])
    expect(recordsOf(anna)).toHaveLength(1)
    expect(db.select().from(offlineStamps).all()).toHaveLength(1)
  })

  it('does not record a wrong PIN, leaves a hint and counts it toward the PIN lock like a wrong try at the tablet', () => {
    const wrong = stamp(anna, 'in', '07:58', '000000')
    expect(sync([wrong])).toEqual([{ clientId: wrong.clientId, status: 'rejected', reason: 'pin_invalid' }])
    expect(recordsOf(anna)).toEqual([])
    expect(pinState(anna)).toMatchObject({ pinFailed: 1, pinLockLevel: 0 })
    expect(listOfflineStampHints(db, 1)).toEqual([expect.objectContaining({
      employeeId: anna, name: 'Anna', action: 'in', date: '2026-11-19', minutes: 478, reason: 'pin_invalid',
    })])
    // A right PIN (offline as online) resets the count.
    sync([stamp(anna, 'in', '08:00')])
    expect(pinState(anna)).toMatchObject({ pinFailed: 0 })
  })

  it('counts the same wrong PIN of a person once per request', () => {
    sync([stamp(anna, 'in', '07:58', '000000'), stamp(anna, 'out', '08:30', '000000'), stamp(anna, 'in', '09:00', '000000')])
    expect(pinState(anna)).toMatchObject({ pinFailed: 1 })
  })

  it('locks the PIN after 5 wrong offline PINs, with the online escalation; no further check while locked', () => {
    const results = sync([0, 1, 2, 3, 4, 5].map(index => stamp(anna, 'in', '07:58', `00000${index}`)).concat(stamp(anna, 'in', '08:00')))
    expect(results.map(result => result.reason)).toEqual(['pin_invalid', 'pin_invalid', 'pin_invalid', 'pin_invalid', 'pin_invalid', 'pin_locked', 'pin_locked'])
    expect(pinState(anna)).toMatchObject({ pinLockLevel: 1, pinLockedUntil: new Date(NOW.getTime() + 15 * 60_000).toISOString() })
    expect(recordsOf(anna)).toEqual([])
    // The online stamp is locked as well.
    expect(errorCode(() => terminalStamp(db, 1, anna, '123456', 'in', NOW))).toBe('pin_locked')
    // One open „PIN gesperrt“ hint, however many stamps come while locked.
    expect(listOfflineStampHints(db, 1).filter(hint => hint.reason === 'pin_locked')).toHaveLength(1)
    // „Geprüft“ does not open new tries: the lock decides.
    const leitung = addUser(db, 'leitung', 'admin')
    for (const hint of listOfflineStampHints(db, 1)) checkOfflineStampHint(db, leitung, 1, hint.id, NOW)
    expect(sync([stamp(anna, 'in', '08:01')])[0]).toMatchObject({ reason: 'pin_locked' })
    // Another person is not affected.
    expect(sync([stamp(berta, 'in', '08:00', '654321')])[0]!.status).toBe('recorded')
  })

  it('respects a lock from wrong tries at the tablet without checking the offline PIN', () => {
    for (let attempt = 0; attempt < 5; attempt++) errorCode(() => terminalStamp(db, 1, anna, '000000', 'in', NOW))
    expect(pinState(anna)).toMatchObject({ pinLockLevel: 1 })
    expect(sync([stamp(anna, 'in', '08:00')])[0]).toMatchObject({ status: 'rejected', reason: 'pin_locked' })
    expect(recordsOf(anna)).toEqual([])
    // After the lock time the right PIN works again.
    const later = new Date(NOW.getTime() + 16 * 60_000)
    expect(sync([stamp(anna, 'in', '08:05')], later.toISOString(), later)[0]!.status).toBe('recorded')
  })

  it('checks the time before the PIN: a stamp outside the window says nothing about the PIN and counts no try', () => {
    expect(sync([stamp(anna, 'in', '2026-11-20T08:00:00+01:00', '000000')])[0]).toMatchObject({ reason: 'in_future' })
    expect(sync([stamp(anna, 'in', '2026-11-20T08:00:00+01:00')])[0]).toMatchObject({ reason: 'in_future' })
    expect(sync([stamp(anna, 'in', '2026-11-01T08:00:00+01:00', '000000')])[0]).toMatchObject({ reason: 'too_old' })
    expect(pinState(anna)).toMatchObject({ pinFailed: 0 })
  })

  it('checks at most 20 PINs per request and leaves the rest queued, in order', () => {
    const people = Array.from({ length: 22 }, (_, index) => {
      const id = addEmployee(db, `Person ${index}`)
      setPin(db, 1, id, '111111')
      return id
    })
    const stamps = people.map(id => stamp(id, 'in', '08:00', '111111'))
    const results = sync(stamps)
    expect(results.map(result => result.clientId)).toEqual(stamps.slice(0, 20).map(item => item.clientId))
    expect(sync(stamps.slice(20)).map(result => result.status)).toEqual(['recorded', 'recorded'])
  }, 60_000) // 44 scrypt hashes and checks

  it('takes a stamp matching a recorded Kommt or Geht (±1 minute) as already there, without a hint', () => {
    terminalStamp(db, 1, anna, '123456', 'in', new Date('2026-11-19T06:30:00Z'))
    terminalStamp(db, 1, anna, '123456', 'out', new Date('2026-11-19T08:00:00Z'))
    expect(sync([stamp(anna, 'in', '07:31'), stamp(anna, 'out', '09:00')]).map(result => result.status)).toEqual(['recorded', 'recorded'])
    expect(recordsOf(anna)).toEqual([expect.objectContaining({ start: 450, end: 540, offline: false })])
    expect(listOfflineStampHints(db, 1)).toEqual([])
  })

  it('takes a stamp a little ahead as the server\'s now, and widens the tolerance by a known tablet lead', () => {
    sync([stamp(anna, 'in', '10:03')])
    expect(recordsOf(anna)[0]).toMatchObject({ start: 600 })
    // The tablet runs 10 minutes fast: a stamp 9 minutes ahead of the server is its last minute, taken with the mark.
    const ahead = new Date(NOW.getTime() + 10 * 60_000).toISOString()
    expect(sync([stamp(berta, 'in', '10:09', '654321')], ahead)[0]!.status).toBe('recorded')
    expect(recordsOf(berta)[0]).toMatchObject({ start: 600, clockSkewMinutes: 10 })
    // But not beyond the lead.
    expect(sync([stamp(berta, 'out', '10:20', '654321')], ahead)[0]).toMatchObject({ reason: 'in_future' })
  })

  it('refuses stamps more than 5 minutes ahead or older than 7 days, with a hint', () => {
    const ahead = stamp(anna, 'in', '10:06')
    const old = stamp(anna, 'in', '2026-11-12T08:00:00+01:00')
    expect(sync([ahead, old])).toEqual([
      { clientId: ahead.clientId, status: 'rejected', reason: 'in_future' },
      { clientId: old.clientId, status: 'rejected', reason: 'too_old' },
    ])
    expect(recordsOf(anna)).toEqual([])
    expect(listOfflineStampHints(db, 1).map(hint => hint.reason)).toEqual(['too_old', 'in_future'])
    // Within the limits: 5 minutes ahead, and six days ago.
    expect(sync([stamp(anna, 'in', '10:05')])[0]!.status).toBe('recorded')
    expect(sync([stamp(berta, 'in', '2026-11-13T08:00:00+01:00', '654321')])[0]!.status).toBe('recorded')
  })

  it('puts a Geht without open Kommt and a Kommt while clocked in on the review list', () => {
    const geht = stamp(anna, 'out', '09:00')
    expect(sync([geht])).toEqual([{ clientId: geht.clientId, status: 'review', reason: 'not_clocked_in' }])
    sync([stamp(anna, 'in', '09:10')])
    const twice = stamp(anna, 'in', '09:20')
    expect(sync([twice])).toEqual([{ clientId: twice.clientId, status: 'review', reason: 'already_clocked_in' }])
    expect(recordsOf(anna)).toEqual([expect.objectContaining({ start: 550, end: null })])
    expect(listOfflineStampHints(db, 1).map(hint => [hint.action, hint.reason])).toEqual([
      ['out', 'not_clocked_in'], ['in', 'already_clocked_in'],
    ])
  })

  it('puts a Kommt before a later recorded period on the review list', () => {
    terminalStamp(db, 1, anna, '123456', 'in', new Date('2026-11-19T07:00:00Z'))
    terminalStamp(db, 1, anna, '123456', 'out', new Date('2026-11-19T08:00:00Z'))
    expect(sync([stamp(anna, 'in', '07:00')])[0]).toMatchObject({ status: 'review', reason: 'overlap' })
    expect(recordsOf(anna)).toHaveLength(1)
  })

  it('marks the stamps when the tablet clock was off by more than 5 minutes', () => {
    const clientNow = new Date(NOW.getTime() - 12 * 60_000).toISOString()
    sync([stamp(anna, 'in', '07:58'), stamp(berta, 'in', '08:00', '654321')], clientNow)
    expect(recordsOf(anna)[0]).toMatchObject({ offline: true, clockSkewMinutes: -12 })
    expect(recordsOf(berta)[0]).toMatchObject({ clockSkewMinutes: -12 })
    const within = new Date(NOW.getTime() + 4 * 60_000).toISOString()
    sync([stamp(anna, 'out', '09:30')], within)
    // The Geht within the limit keeps the earlier mark of the record.
    expect(recordsOf(anna)[0]).toMatchObject({ end: 570, clockSkewMinutes: -12 })
  })

  it('refuses people the tablet does not know without a hint, and helpers on their planned days only', () => {
    const hort = addFacility(db, 'Hort')
    const stranger = addEmployee(db, 'Fremd', { facilityId: hort })
    setPin(db, hort, stranger, '111111')
    const unknown = stamp(stranger, 'in', '08:00', '111111')
    expect(sync([unknown])).toEqual([{ clientId: unknown.clientId, status: 'rejected', reason: 'employee_not_found' }])
    const nobody = stamp(9999, 'in', '08:00')
    expect(sync([nobody])[0]).toMatchObject({ status: 'rejected', reason: 'employee_not_found' })
    expect(listOfflineStampHints(db, 1)).toEqual([])
    expect(listOfflineStampHints(db, hort)).toEqual([])
    // Not even stored, and no PIN try counted.
    expect(db.select().from(offlineStamps).all()).toEqual([])
    expect(pinState(stranger)).toMatchObject({ pinFailed: 0 })
  })

  it('takes a helper on the day of the help-out; the hints show at the home facility', () => {
    const krippe = addFacility(db, 'Krippe')
    const leitungB = addUser(db, 'leitung-b', 'admin', null, krippe)
    setTimeTrackingFrom(db, krippe, '2026-10-01')
    addHelpOut(db, anna, krippe, 2026, 11)
    applyToCells(db, leitungB, krippe, [{ employeeId: anna, date: '2026-11-19' }], 'replace', { kind: 'shift', templateId: templateId(db, 'M', krippe) })
    const atKrippe = (stamps: OfflineStampInput[]) => syncOfflineStamps(db, krippe, { clientNow: NOW.toISOString(), stamps }, NOW).results
    expect(atKrippe([stamp(anna, 'in', '07:58')])[0]!.status).toBe('recorded')
    // Not on another day.
    expect(atKrippe([stamp(anna, 'in', '2026-11-18T08:00:00+01:00')])[0]).toMatchObject({ reason: 'employee_not_found' })
    // Nor on a planned day outside the time window (the client's date is not trusted for that).
    applyToCells(db, leitungB, krippe, [{ employeeId: anna, date: '2026-11-02' }], 'replace', { kind: 'shift', templateId: templateId(db, 'M', krippe) })
    expect(atKrippe([stamp(anna, 'in', '2026-11-02T08:00:00+01:00', '000000')])[0]).toMatchObject({ reason: 'employee_not_found' })
    expect(pinState(anna)).toMatchObject({ pinFailed: 0 })
    atKrippe([stamp(anna, 'out', '09:00', '000000')])
    expect(listOfflineStampHints(db, krippe)).toEqual([])
    expect(listOfflineStampHints(db, 1).map(hint => hint.reason)).toEqual(['pin_invalid'])
  })

  it('refuses people no longer employed and days without time tracking', () => {
    const dora = addEmployee(db, 'Dora', { leftOn: '2026-11-15' })
    setPin(db, 1, dora, '222222')
    expect(sync([stamp(dora, 'in', '08:00', '222222')])[0]).toMatchObject({ status: 'rejected', reason: 'not_employed' })
    setTimeTrackingFrom(db, 1, '2026-11-20')
    expect(sync([stamp(anna, 'in', '08:00')])[0]).toMatchObject({ status: 'rejected', reason: 'time_tracking_off' })
    expect(listOfflineStampHints(db, 1)).toEqual([])
  })

  it('handles the stamps in the order sent', () => {
    const results = sync([stamp(anna, 'in', '07:00'), stamp(anna, 'out', '08:00'), stamp(anna, 'in', '08:30'), stamp(anna, 'out', '09:00')])
    expect(results.map(result => result.status)).toEqual(['recorded', 'recorded', 'recorded', 'recorded'])
    expect(recordsOf(anna).map(record => [record.start, record.end])).toEqual([[420, 480], [510, 540]])
  })
})

describe('limits of the offline route', () => {
  it('allows at most 10 requests per tablet account and minute', () => {
    const start = new Date('2026-11-19T09:00:00Z')
    for (let index = 0; index < 10; index++) expect(allowOfflineSync(777, new Date(start.getTime() + index * 1000))).toBe(true)
    expect(allowOfflineSync(777, new Date(start.getTime() + 11_000))).toBe(false)
    // Another tablet is not affected; a minute later it works again.
    expect(allowOfflineSync(778, start)).toBe(true)
    expect(allowOfflineSync(777, new Date(start.getTime() + 61_000))).toBe(true)
  })

  it('caps the open hints per person', () => {
    const stamps = Array.from({ length: OFFLINE_MAX_OPEN_HINTS + 3 }, () => stamp(anna, 'in', '2026-11-01T08:00:00+01:00'))
    sync(stamps)
    expect(listOfflineStampHints(db, 1)).toHaveLength(OFFLINE_MAX_OPEN_HINTS)
    expect(db.select().from(offlineStamps).all()).toHaveLength(OFFLINE_MAX_OPEN_HINTS + 3)
  })
})

describe('review list of offline stamps', () => {
  it('lists open hints for the employees\' home facility, and „Geprüft“ takes them off', () => {
    const leitung = addUser(db, 'leitung', 'admin')
    sync([stamp(anna, 'in', '07:58', '000000')])
    const [hint] = listOfflineStampHints(db, 1)
    expect(errorCode(() => checkOfflineStampHint(db, leitung, 2, hint!.id, NOW))).toBe('offline_stamp_not_found')
    checkOfflineStampHint(db, leitung, 1, hint!.id, NOW)
    expect(listOfflineStampHints(db, 1)).toEqual([])
    expect(db.select().from(offlineStamps).get()).toMatchObject({ checkedAt: NOW.toISOString(), checkedBy: leitung.id })
    // Checking twice is fine.
    checkOfflineStampHint(db, leitung, 1, hint!.id, NOW)
  })

  it('reminds Leitung and Träger in the office of each open hint, never the staff or the tablet', () => {
    sync([stamp(anna, 'in', '07:58', '000000')])
    const viewer = (role: 'admin' | 'observer', onTablet = false) => ({ facilityId: 1, permissions: rolePermissions(db, role), onTablet })
    expect(offlineStampReminders(db, viewer('admin'), '2026-11-19')).toEqual([expect.objectContaining({
      kind: 'offlineStamp', date: '2026-11-19', name: 'Anna', time: 478,
      offlineStamp: expect.objectContaining({ reason: 'pin_invalid', action: 'in', employeeId: anna }),
    })])
    expect(offlineStampReminders(db, viewer('observer'), '2026-11-19')).toEqual([])
    expect(offlineStampReminders(db, viewer('admin', true), '2026-11-19')).toEqual([])
  })
})

describe('offline marks on the time pages', () => {
  it('shows „offline erfasst“ and the clock mark to Leitung/Träger, only „offline erfasst“ to the employee', () => {
    const clientNow = new Date(NOW.getTime() + 9 * 60_000).toISOString()
    sync([stamp(anna, 'in', '07:58')], clientNow)
    const day = getTimeMonth(db, 1, anna, 2026, 11, '2026-11-19', 600).days.find(item => item.date === '2026-11-19')!
    expect(day.records[0]).toMatchObject({ offline: true, clockSkewMinutes: 9 })
    const account = addUser(db, 'anna', 'observer', anna)
    const mine = getMyTime(db, account, 2026, 11, NOW)
    expect(mine.records[0]).toMatchObject({ offline: true, clockSkewMinutes: null })
  })
})
