import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { leaveForfeitReceipts, users } from '../../server/db/schema'
import { setEntitlement } from '../../server/services/employees'
import { applyToCells } from '../../server/services/entries'
import {
  getLeaveForfeitList, getLeaveForfeitSettings, getMyLeaveForfeitNotice, markLeaveForfeitRead, setLeaveForfeitSettings,
} from '../../server/services/leaveForfeit'
import { DEFAULT_LEAVE_FORFEIT_TEXT } from '../../shared/domain/leaveForfeit'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addUser, codeId, createTestDb, errorCode } from '../helpers/fixtures'
import { eq } from 'drizzle-orm'

const now = new Date('2026-11-19T10:00:00Z')

describe('the notice on remaining leave', () => {
  let db: Db
  let provider: SessionUser
  let anna: number
  let annaUser: SessionUser
  beforeEach(() => {
    db = createTestDb()
    provider = addUser(db, 'traeger', 'provider')
    anna = addEmployee(db, 'Anna')
    annaUser = addUser(db, 'anna', 'observer', anna)
    setEntitlement(db, 1, anna, 2026, { days: 10, carriedOverDays: 0 })
    // Mon 3. – Fri 7. August 2026: 5 days taken, 5 left.
    vacation(anna, ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07'])
  })
  function vacation(employeeId: number, dates: string[], facilityId = 1) {
    applyToCells(db, provider, facilityId, dates.map(date => ({ employeeId, date })), 'replace', { kind: 'code', codeId: codeId(db, 'vacation') })
  }

  describe('the facility setting', () => {
    it('is 31.03. with the default text unless the facility sets its own', () => {
      expect(getLeaveForfeitSettings(db, 1)).toEqual({ day: 31, month: 3, text: DEFAULT_LEAVE_FORFEIT_TEXT, isDefaultText: true })
      expect(setLeaveForfeitSettings(db, 1, { day: 31, month: 5, text: '  Noch ‹Tage› Tage aus ‹Jahr›, bis ‹Verfall›.  ' }))
        .toEqual({ day: 31, month: 5, text: 'Noch ‹Tage› Tage aus ‹Jahr›, bis ‹Verfall›.', isDefaultText: false })
      const other = addFacility(db, 'Krippe')
      expect(getLeaveForfeitSettings(db, other)).toMatchObject({ day: 31, month: 3, isDefaultText: true })
    })

    it('goes back to the default text when it is emptied or equals the default', () => {
      setLeaveForfeitSettings(db, 1, { day: 31, month: 3, text: 'Noch ‹Tage› Tage bis ‹Verfall›.' })
      expect(setLeaveForfeitSettings(db, 1, { day: 31, month: 3, text: '' })).toMatchObject({ text: DEFAULT_LEAVE_FORFEIT_TEXT, isDefaultText: true })
      setLeaveForfeitSettings(db, 1, { day: 31, month: 3, text: 'Noch ‹Tage› Tage bis ‹Verfall›.' })
      expect(setLeaveForfeitSettings(db, 1, { day: 31, month: 3, text: DEFAULT_LEAVE_FORFEIT_TEXT })).toMatchObject({ isDefaultText: true })
    })

    it('refuses a date that does not exist every year or lies from October on', () => {
      expect(errorCode(() => setLeaveForfeitSettings(db, 1, { day: 29, month: 2, text: '' }))).toBe('invalid_forfeit_date')
      expect(errorCode(() => setLeaveForfeitSettings(db, 1, { day: 31, month: 10, text: '' }))).toBe('invalid_forfeit_date')
      expect(errorCode(() => getLeaveForfeitSettings(db, 999))).toBe('facility_not_found')
    })

    it('refuses an own text without the days or the forfeiture date', () => {
      expect(errorCode(() => setLeaveForfeitSettings(db, 1, { day: 31, month: 3, text: 'Bitte Urlaub planen.' }))).toBe('invalid_forfeit_text')
      expect(errorCode(() => setLeaveForfeitSettings(db, 1, { day: 31, month: 3, text: 'Noch ‹Tage› Tage.' }))).toBe('invalid_forfeit_text')
      expect(errorCode(() => setLeaveForfeitSettings(db, 1, { day: 31, month: 3, text: 'Bis ‹Verfall› planen.' }))).toBe('invalid_forfeit_text')
      expect(getLeaveForfeitSettings(db, 1)).toMatchObject({ isDefaultText: true })
    })
  })

  describe('what the employee sees', () => {
    it('shows from 1 October until the forfeiture date of the next year, then no more', () => {
      expect(getMyLeaveForfeitNotice(db, annaUser, '2026-09-30')).toBeNull()
      expect(getMyLeaveForfeitNotice(db, annaUser, '2026-10-01')).toEqual({
        year: 2026, days: 5, forfeitDate: '2027-03-31',
        text: 'Du hast noch 5 Tage Urlaub aus 2026. Bitte plane sie rechtzeitig ein. Urlaub, der bis zum 31.03.2027 nicht genommen ist, verfällt.',
      })
      expect(getMyLeaveForfeitNotice(db, annaUser, '2026-12-31')).toMatchObject({ year: 2026, days: 5 })
      expect(getMyLeaveForfeitNotice(db, annaUser, '2027-03-31')).toMatchObject({ year: 2026, days: 5 })
      expect(getMyLeaveForfeitNotice(db, annaUser, '2027-04-01')).toBeNull()
    })

    it('counts the free days of the year until 31.12., then the carried-over days not used by the forfeiture date', () => {
      // Planned in December: no longer free in the year.
      vacation(anna, ['2026-12-01'])
      expect(getMyLeaveForfeitNotice(db, annaUser, '2026-11-19')).toMatchObject({ days: 4 })
      // February 2027 (before the forfeiture date) uses the carry-over, April 2027 does not.
      vacation(anna, ['2027-02-01', '2027-02-02', '2027-04-06'])
      expect(getMyLeaveForfeitNotice(db, annaUser, '2026-11-19')).toMatchObject({ days: 4 })
      expect(getMyLeaveForfeitNotice(db, annaUser, '2027-01-05')).toMatchObject({ year: 2026, days: 2 })
      vacation(anna, ['2027-03-01', '2027-03-02'])
      expect(getMyLeaveForfeitNotice(db, annaUser, '2027-01-05')).toBeNull()
    })

    it('shows nothing without days left, without an entitlement or without an employee', () => {
      vacation(anna, ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'])
      expect(getMyLeaveForfeitNotice(db, annaUser, '2026-11-19')).toBeNull()
      const ben = addEmployee(db, 'Ben')
      expect(getMyLeaveForfeitNotice(db, addUser(db, 'ben', 'observer', ben), '2026-11-19')).toBeNull()
      expect(getMyLeaveForfeitNotice(db, provider, '2026-11-19')).toBeNull()
    })

    it('follows the facility\'s date and text with the placeholders', () => {
      setLeaveForfeitSettings(db, 1, { day: 31, month: 5, text: 'Resturlaub ‹Jahr›: ‹Tage› Tage, nimm sie bis ‹Verfall›.' })
      expect(getMyLeaveForfeitNotice(db, annaUser, '2026-10-01'))
        .toMatchObject({ forfeitDate: '2027-05-31', text: 'Resturlaub 2026: 5 Tage, nimm sie bis 31.05.2027.' })
      expect(getMyLeaveForfeitNotice(db, annaUser, '2027-05-31')).toMatchObject({ year: 2026 })
      expect(getMyLeaveForfeitNotice(db, annaUser, '2027-06-01')).toBeNull()
    })

    it('uses the home facility\'s setting', () => {
      const krippe = addFacility(db, 'Krippe')
      const carl = addEmployee(db, 'Carl', { facilityId: krippe })
      setEntitlement(db, krippe, carl, 2026, { days: 10, carriedOverDays: 0 })
      setLeaveForfeitSettings(db, krippe, { day: 28, month: 2, text: '' })
      expect(getMyLeaveForfeitNotice(db, addUser(db, 'carl', 'observer', carl), '2026-10-01'))
        .toMatchObject({ days: 10, forfeitDate: '2027-02-28' })
    })
  })

  describe('„Gelesen“', () => {
    it('stores the days and the text shown, once per year, and hides the notice', () => {
      expect(markLeaveForfeitRead(db, annaUser, 2026, '2026-11-19', now)).toEqual({ readAt: now.toISOString() })
      expect(db.select().from(leaveForfeitReceipts).all()).toEqual([{
        id: 1, employeeId: anna, year: 2026, days: 5, readAt: now.toISOString(), readBy: annaUser.id,
        text: 'Du hast noch 5 Tage Urlaub aus 2026. Bitte plane sie rechtzeitig ein. Urlaub, der bis zum 31.03.2027 nicht genommen ist, verfällt.',
      }])
      expect(getMyLeaveForfeitNotice(db, annaUser, '2026-11-19')).toBeNull()
      expect(getMyLeaveForfeitNotice(db, annaUser, '2027-02-01')).toBeNull()
    })

    it('is idempotent: a second click keeps the first record', () => {
      markLeaveForfeitRead(db, annaUser, 2026, '2026-11-19', now)
      vacation(anna, ['2026-12-01'])
      expect(markLeaveForfeitRead(db, annaUser, 2026, '2026-11-20', new Date('2026-11-20T08:00:00Z'))).toEqual({ readAt: now.toISOString() })
      expect(db.select().from(leaveForfeitReceipts).all()).toMatchObject([{ days: 5, readAt: now.toISOString() }])
    })

    it('shows the next year\'s notice again', () => {
      markLeaveForfeitRead(db, annaUser, 2026, '2026-11-19', now)
      setEntitlement(db, 1, anna, 2027, { days: 10, carriedOverDays: 0 })
      expect(getMyLeaveForfeitNotice(db, annaUser, '2027-10-01')).toMatchObject({ year: 2027, days: 15 })
    })

    it('needs a notice of that year and an employee', () => {
      expect(errorCode(() => markLeaveForfeitRead(db, annaUser, 2026, '2026-09-30', now))).toBe('leave_forfeit_no_notice')
      expect(errorCode(() => markLeaveForfeitRead(db, annaUser, 2025, '2026-11-19', now))).toBe('leave_forfeit_no_notice')
      expect(errorCode(() => markLeaveForfeitRead(db, provider, 2026, '2026-11-19', now))).toBe('no_employee')
      expect(db.select().from(leaveForfeitReceipts).all()).toEqual([])
    })

    it('shows again when the days rise above the ones read, and keeps the first receipt', () => {
      markLeaveForfeitRead(db, annaUser, 2026, '2026-11-19', now)
      // Fewer days need no new notice.
      vacation(anna, ['2026-12-01'])
      expect(getMyLeaveForfeitNotice(db, annaUser, '2026-11-20')).toBeNull()
      // An entitlement corrected upwards: 12 − 6 = 6 days, more than the 5 read.
      setEntitlement(db, 1, anna, 2026, { days: 12, carriedOverDays: 0 })
      expect(getMyLeaveForfeitNotice(db, annaUser, '2026-11-20')).toMatchObject({ days: 6 })
      const later = new Date('2026-11-20T09:00:00Z')
      expect(markLeaveForfeitRead(db, annaUser, 2026, '2026-11-20', later)).toEqual({ readAt: later.toISOString() })
      expect(db.select().from(leaveForfeitReceipts).all().map(receipt => [receipt.days, receipt.readAt]))
        .toEqual([[5, now.toISOString()], [6, later.toISOString()]])
      expect(getMyLeaveForfeitNotice(db, annaUser, '2026-11-20')).toBeNull()
      // Clicked once more: nothing new.
      expect(markLeaveForfeitRead(db, annaUser, 2026, '2026-11-21', new Date('2026-11-21T09:00:00Z'))).toEqual({ readAt: later.toISOString() })
      expect(db.select().from(leaveForfeitReceipts).all()).toHaveLength(2)
    })

    it('shows again after the forfeiture date or the text changed', () => {
      markLeaveForfeitRead(db, annaUser, 2026, '2026-11-19', now)
      setLeaveForfeitSettings(db, 1, { day: 31, month: 5, text: '' })
      expect(getMyLeaveForfeitNotice(db, annaUser, '2026-11-20')).toMatchObject({ days: 5, forfeitDate: '2027-05-31' })
      markLeaveForfeitRead(db, annaUser, 2026, '2026-11-20', now)
      expect(getMyLeaveForfeitNotice(db, annaUser, '2026-11-20')).toBeNull()
      setLeaveForfeitSettings(db, 1, { day: 31, month: 5, text: 'Resturlaub ‹Jahr›: ‹Tage› Tage bis ‹Verfall›.' })
      expect(getMyLeaveForfeitNotice(db, annaUser, '2026-11-20')).toMatchObject({ text: 'Resturlaub 2026: 5 Tage bis 31.05.2027.' })
      // A click after the notice ended keeps the latest receipt.
      expect(markLeaveForfeitRead(db, annaUser, 2026, '2027-06-01', new Date())).toEqual({ readAt: now.toISOString() })
      expect(db.select().from(leaveForfeitReceipts).all()).toHaveLength(2)
    })
  })

  describe('the list on „Urlaubsplanung“', () => {
    it('lists the people with days left as read, open or without an account', () => {
      const ben = addEmployee(db, 'Ben')
      const carl = addEmployee(db, 'Carl')
      const dora = addEmployee(db, 'Dora')
      addUser(db, 'ben', 'observer', ben)
      for (const id of [ben, carl, dora]) setEntitlement(db, 1, id, 2026, { days: id === dora ? 0 : 3, carriedOverDays: 0 })
      // Eve's account is switched off: she is told in writing as well.
      const eve = addEmployee(db, 'Eve')
      setEntitlement(db, 1, eve, 2026, { days: 2, carriedOverDays: 0 })
      const eveUser = addUser(db, 'eve', 'observer', eve)
      db.update(users).set({ active: false }).where(eq(users.id, eveUser.id)).run()
      markLeaveForfeitRead(db, annaUser, 2026, '2026-11-19', now)

      expect(getLeaveForfeitList(db, 1, 2026, '2026-11-20')).toEqual({
        year: 2026, noticeFrom: '2026-10-01', forfeitDate: '2027-03-31', started: true,
        rows: [
          { employeeId: anna, name: 'Anna', days: 5, status: 'read', readAt: now.toISOString(), readDays: 5, protectedUntil: null },
          { employeeId: ben, name: 'Ben', days: 3, status: 'open', readAt: null, readDays: null, protectedUntil: null },
          { employeeId: carl, name: 'Carl', days: 3, status: 'no_account', readAt: null, readDays: null, protectedUntil: null },
          { employeeId: eve, name: 'Eve', days: 2, status: 'no_account', readAt: null, readDays: null, protectedUntil: null },
        ],
      })
    })

    it('keeps a person who read the notice though no days are left now; after the forfeiture date it shows what lapsed', () => {
      markLeaveForfeitRead(db, annaUser, 2026, '2026-11-19', now)
      vacation(anna, ['2027-02-01', '2027-02-02', '2027-02-03', '2027-02-04', '2027-02-05'])
      expect(getLeaveForfeitList(db, 1, 2026, '2027-02-10').rows).toMatchObject([{ days: 0, status: 'read', readDays: 5 }])
      const ben = addEmployee(db, 'Ben')
      setEntitlement(db, 1, ben, 2026, { days: 4, carriedOverDays: 0 })
      vacation(ben, ['2027-03-01', '2027-04-06'])
      expect(getLeaveForfeitList(db, 1, 2026, '2027-06-01').rows).toMatchObject([{ name: 'Anna', days: 0 }, { name: 'Ben', days: 3 }])
    })

    it('marks a person read before as open again when the days rose, without an account as „kein Konto“', () => {
      markLeaveForfeitRead(db, annaUser, 2026, '2026-11-19', now)
      setEntitlement(db, 1, anna, 2026, { days: 12, carriedOverDays: 0 })
      expect(getLeaveForfeitList(db, 1, 2026, '2026-11-20').rows)
        .toEqual([{ employeeId: anna, name: 'Anna', days: 7, status: 'reopened', readAt: now.toISOString(), readDays: 5, protectedUntil: null }])
      db.update(users).set({ active: false }).where(eq(users.id, annaUser.id)).run()
      expect(getLeaveForfeitList(db, 1, 2026, '2026-11-20').rows).toMatchObject([{ status: 'no_account', readDays: 5 }])
    })

    it('lists nobody before the notice window of the year', () => {
      expect(getLeaveForfeitList(db, 1, 2027, '2026-11-20')).toEqual({
        year: 2027, noticeFrom: '2027-10-01', forfeitDate: '2028-03-31', started: false, rows: [],
      })
      expect(getLeaveForfeitList(db, 1, 2026, '2026-09-30')).toMatchObject({ started: false, rows: [] })
      expect(getLeaveForfeitList(db, 1, 2026, '2026-10-01')).toMatchObject({ started: true, rows: [{ name: 'Anna', status: 'open' }] })
    })

    it('only lists the facility\'s staff', () => {
      const krippe = addFacility(db, 'Krippe')
      const carl = addEmployee(db, 'Carl', { facilityId: krippe })
      setEntitlement(db, krippe, carl, 2026, { days: 10, carriedOverDays: 0 })
      expect(getLeaveForfeitList(db, krippe, 2026, '2026-11-19').rows.map(row => row.name)).toEqual(['Carl'])
      expect(getLeaveForfeitList(db, 1, 2026, '2026-11-19').rows.map(row => row.name)).toEqual(['Anna'])
    })
  })
})
