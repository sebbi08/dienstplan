import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { berlinInstant } from '../../shared/domain/tablet'
import { closures, employees, entries, terminalUnlocks, users } from '../../server/db/schema'
import { createClosure, deleteClosure, updateClosure } from '../../server/services/closures'
import { setFacilityOpeningHours } from '../../server/services/openingHours'
import { saveBundleOverride } from '../../server/services/permissions'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { applyToCells } from '../../server/services/entries'
import { clearPin, setPin, terminalStamp } from '../../server/services/terminal'
import {
  deleteExpiredUnlocks, lockChildren, tabletChildViewer, tabletUnlockStatus, unlockChildren,
} from '../../server/services/tabletUnlock'
import { setTabletSettings, type TabletSettingsInput } from '../../server/services/tabletSettings'
import { addEmployee, addFacility, addHelpOut, addUser, allowChildEditing, createTestDb, errorCode, permissionsOf, templateId } from '../helpers/fixtures'

const at = (iso: string) => new Date(iso)
const NOW = at('2026-10-06T06:00:00Z')
const after = (seconds: number) => new Date(NOW.getTime() + seconds * 1000)

describe('unlocking the tablet for child records', () => {
  let db: Db
  let anna: number
  let berta: number
  let tablet: { id: number; facilityId: number }
  const unlock = (employeeId = anna, pin = '123456', now = NOW) => unlockChildren(db, tablet, employeeId, pin, now)
  const viewer = (token: string | undefined, now = NOW, touch?: boolean) => tabletChildViewer(db, tablet, token, now, touch)
  const rows = () => db.select().from(terminalUnlocks).all()
  // Saved at NOW (saving deletes the unlocks that ran out by then).
  const settings = (changes: Partial<TabletSettingsInput> = {}, now = NOW) => setTabletSettings(
    db, 1, { lockMinutes: 2, showWaitlist: false, showFutureContracts: false, ...changes }, now,
  )

  beforeEach(() => {
    db = createTestDb()
    anna = addEmployee(db, 'Anna')
    berta = addEmployee(db, 'Berta')
    setTimeTrackingFrom(db, 1, '2026-10-01')
    setPin(db, 1, anna, '123456')
    setPin(db, 1, berta, '654321')
    const account = addUser(db, 'tablet', 'terminal')
    tablet = { id: account.id, facilityId: account.facilityId! }
  })

  it('unlocks with the right PIN and returns the person and rights', () => {
    const { token, status } = unlock()
    expect(status).toEqual({
      unlocked: true, employeeId: anna, name: 'Anna', lockMinutes: 2, noLockPeriods: [],
      rights: { canEdit: false, isManager: false, canMoveFacility: false, showWaitlist: false, showFutureContracts: false },
      // No account of her own: never „Dienstplan bearbeiten“.
      planEdit: null,
      // Without „Nur Kinderzahlen“ the child records as her rights say.
      countsOnly: false,
    })
    expect(token.length).toBeGreaterThanOrEqual(40)
    expect(tabletUnlockStatus(db, tablet, token, NOW)).toEqual(status)
  })

  it('counts wrong PINs together with stamping', () => {
    for (let attempt = 1; attempt <= 4; attempt++) {
      expect(errorCode(() => unlock(anna, '000000'))).toBe('pin_invalid')
    }
    expect(errorCode(() => terminalStamp(db, 1, anna, '000000', 'in', NOW))).toBe('pin_locked')
    expect(errorCode(() => unlock(anna, '123456', after(14 * 60)))).toBe('pin_locked')
    expect(unlock(anna, '123456', after(16 * 60)).status.unlocked).toBe(true)
    expect(rows()).toHaveLength(1)
  })

  it('escalates the lock across unlocking and stamping, and the right PIN at the tablet resets it', () => {
    const minutes = (value: number) => after(value * 60)
    const wrongUnlocks = (when: Date) => {
      for (let attempt = 1; attempt < 5; attempt++) expect(errorCode(() => unlock(anna, '000000', when))).toBe('pin_invalid')
      return errorCode(() => unlock(anna, '000000', when))
    }
    const wrongStamps = (when: Date) => {
      for (let attempt = 1; attempt < 5; attempt++) expect(errorCode(() => terminalStamp(db, 1, anna, '000000', 'in', when))).toBe('pin_invalid')
      return errorCode(() => terminalStamp(db, 1, anna, '000000', 'in', when))
    }
    const level = () => db.select().from(employees).where(eq(employees.id, anna)).get()!.pinLockLevel

    expect(wrongUnlocks(NOW)).toBe('pin_locked')
    expect(wrongStamps(minutes(15))).toBe('pin_locked_long')
    expect(errorCode(() => unlock(anna, '123456', minutes(44)))).toBe('pin_locked_long')
    expect(unlock(anna, '123456', minutes(45)).status.unlocked).toBe(true)
    expect(level()).toBe(0)

    expect(wrongStamps(minutes(46))).toBe('pin_locked')
    expect(wrongUnlocks(minutes(61))).toBe('pin_locked_long')
    expect(wrongStamps(minutes(91))).toBe('pin_locked_permanent')
    expect(errorCode(() => unlock(anna, '123456', minutes(600)))).toBe('pin_locked_permanent')
    expect(level()).toBe(3)
  })

  it('refuses people who are not on the tablet list, without counting an attempt', () => {
    const carla = addEmployee(db, 'Carla')
    const dora = addEmployee(db, 'Dora', { leftOn: '2026-09-30' })
    setPin(db, 1, dora, '123456')
    const krippe = addFacility(db, 'Krippe')
    const kim = addEmployee(db, 'Kim', { facilityId: krippe })
    setTimeTrackingFrom(db, krippe, '2026-10-01')
    setPin(db, krippe, kim, '123456')
    for (const id of [carla, dora, kim, 9999]) {
      for (let attempt = 1; attempt <= 6; attempt++) expect(errorCode(() => unlock(id, '000000'))).toBe('employee_not_found')
    }
    expect(db.select().from(employees).where(eq(employees.id, kim)).get()).toMatchObject({ pinFailed: 0, pinLockedUntil: null, pinLockLevel: 0 })
    expect(rows()).toEqual([])
  })

  it('locks after the lock time plus grace', () => {
    const { token } = unlock()
    expect(viewer(token, after(2 * 60 + 29), false)).toMatchObject({ onTablet: true })
    expect(errorCode(() => viewer(token, after(2 * 60 + 31), false))).toBe('tablet_locked')
  })

  it('keeps the tablet unlocked while it is used', () => {
    const { token } = unlock()
    viewer(token, after(60))
    expect(viewer(token, after(3 * 60 + 29), false)).toMatchObject({ onTablet: true })
    expect(errorCode(() => viewer(token, after(3 * 60 + 31), false))).toBe('tablet_locked')
  })

  it('does not extend the unlock when it only asks for the status', () => {
    const { token } = unlock()
    expect(tabletUnlockStatus(db, tablet, token, after(2 * 60))).toMatchObject({ unlocked: true })
    expect(tabletUnlockStatus(db, tablet, token, after(2 * 60 + 31))).toEqual({ unlocked: false })
    expect(rows()[0]!.lastActiveAt).toBe(NOW.toISOString())
  })

  it('applies a changed lock time at once', () => {
    const { token } = unlock()
    settings({ lockMinutes: 1 })
    expect(errorCode(() => viewer(token, after(60 + 31), false))).toBe('tablet_locked')
    settings({ lockMinutes: 10 })
    expect(viewer(token, after(60 + 31), false)).toMatchObject({ onTablet: true })
  })

  it('locks without a token', () => {
    expect(errorCode(() => viewer(undefined))).toBe('tablet_locked')
    expect(errorCode(() => viewer('nonsense'))).toBe('tablet_locked')
    expect(tabletUnlockStatus(db, tablet, undefined, NOW)).toEqual({ unlocked: false })
  })

  it('ends the unlock by locking, and by a second unlock', () => {
    const first = unlock()
    lockChildren(db, tablet.id, first.token)
    expect(errorCode(() => viewer(first.token))).toBe('tablet_locked')
    expect(tabletUnlockStatus(db, tablet, first.token, NOW)).toEqual({ unlocked: false })

    const second = unlock(anna)
    const third = unlock(berta, '654321')
    expect(errorCode(() => viewer(second.token))).toBe('tablet_locked')
    expect(tabletUnlockStatus(db, tablet, third.token, NOW)).toMatchObject({ unlocked: true, employeeId: berta, name: 'Berta' })
    expect(rows()).toHaveLength(1)
  })

  it('leaves a newer unlock alone when a device locks with its replaced token', () => {
    // Device A unlocked, then device B with the same account; A notices, goes to its start page and locks there.
    const deviceA = unlock(anna)
    const deviceB = unlock(berta, '654321')
    lockChildren(db, tablet.id, deviceA.token)
    lockChildren(db, tablet.id, undefined)
    expect(tabletUnlockStatus(db, tablet, deviceB.token, NOW)).toMatchObject({ unlocked: true, employeeId: berta })
    // Another tablet account cannot end it with the token either.
    const other = addUser(db, 'tablet-2', 'terminal')
    lockChildren(db, other.id, deviceB.token)
    expect(tabletUnlockStatus(db, tablet, deviceB.token, NOW)).toMatchObject({ unlocked: true })
    lockChildren(db, tablet.id, deviceB.token)
    expect(rows()).toEqual([])
  })

  it('locks a token of another tablet or facility', () => {
    const { token } = unlock()
    const krippe = addFacility(db, 'Krippe')
    const other = addUser(db, 'tablet-krippe', 'terminal', null, krippe)
    expect(errorCode(() => tabletChildViewer(db, { id: other.id, facilityId: krippe }, token, NOW))).toBe('tablet_locked')
    expect(tabletUnlockStatus(db, { id: other.id, facilityId: krippe }, token, NOW)).toEqual({ unlocked: false })
    // The same account with another facility is locked too.
    expect(errorCode(() => tabletChildViewer(db, { id: tablet.id, facilityId: krippe }, token, NOW))).toBe('tablet_locked')
    expect(viewer(token)).toMatchObject({ onTablet: true })
  })

  it('removes the unlock with the tablet account', () => {
    unlock()
    db.delete(users).where(eq(users.id, tablet.id)).run()
    expect(rows()).toEqual([])
  })

  describe('rights follow the account freshly', () => {
    it('gives a person without account read rights only', () => {
      const { token } = unlock()
      expect(viewer(token)).toEqual({
        id: null, employeeId: anna, name: 'Anna', role: 'observer', facilityId: 1,
        permissions: permissionsOf('observer'), visibility: { waitlist: false, futureContracts: false }, onTablet: true, groups: null,
        writeGroups: { attendance: null, edit: null },
      })
    })
    it('gives a Mitarbeiter account its child-edit exception, as it is now', () => {
      const account = addUser(db, 'anna', 'observer', anna)
      allowChildEditing(db, account.id)
      const { token, status } = unlock()
      expect(viewer(token)).toMatchObject({ id: account.id, role: 'observer' })
      expect(viewer(token).permissions.has('children.edit')).toBe(true)
      expect(status).toMatchObject({ rights: { canEdit: true, isManager: false } })
      saveBundleOverride(db, account.id, 'childrenEdit', null)
      expect(viewer(token)).toMatchObject({ id: account.id })
      expect(viewer(token).permissions.has('children.edit')).toBe(false)
      expect(tabletUnlockStatus(db, tablet, token, NOW)).toMatchObject({ rights: { canEdit: false } })
    })
    it('treats a deactivated account as read only', () => {
      const account = addUser(db, 'anna', 'observer', anna)
      allowChildEditing(db, account.id)
      db.update(users).set({ active: false }).where(eq(users.id, account.id)).run()
      const { token } = unlock()
      expect(viewer(token)).toMatchObject({ id: null, role: 'observer' })
      expect(viewer(token).permissions.has('children.edit')).toBe(false)
    })
    it('gives the Leitung every right and every child', () => {
      const account = addUser(db, 'leitung', 'admin', anna)
      const { token, status } = unlock()
      expect(viewer(token)).toMatchObject({
        id: account.id, employeeId: anna, name: 'Anna', role: 'admin', visibility: null, onTablet: true,
      })
      expect(status).toMatchObject({
        rights: { canEdit: true, isManager: true, canMoveFacility: false, showWaitlist: true, showFutureContracts: true },
      })
    })
    it('shows the switched-on lists to everyone without manager rights', () => {
      const { token } = unlock()
      settings({ showWaitlist: true })
      expect(viewer(token)).toMatchObject({ visibility: { waitlist: true, futureContracts: false } })
      settings({ showWaitlist: true, showFutureContracts: true })
      expect(tabletUnlockStatus(db, tablet, token, NOW)).toMatchObject({ rights: { showWaitlist: true, showFutureContracts: true } })
    })
  })

  describe('for helpers', () => {
    const tuesday = '2026-10-06'
    let krippe: number
    let helperTablet: { id: number; facilityId: number }
    beforeEach(() => {
      krippe = addFacility(db, 'Krippe')
      const leitung = addUser(db, 'leitung-krippe', 'admin', null, krippe)
      helperTablet = { id: addUser(db, 'tablet-krippe', 'terminal', null, krippe).id, facilityId: krippe }
      addHelpOut(db, anna, krippe, 2026, 10)
      applyToCells(db, leitung, krippe, [{ employeeId: anna, date: tuesday }], 'replace', { kind: 'shift', templateId: templateId(db, 'M', krippe) })
    })

    it('lets a helper read only, and only on planned days', () => {
      const account = addUser(db, 'anna', 'observer', anna)
      allowChildEditing(db, account.id)
      const { token } = unlockChildren(db, helperTablet, anna, '123456', NOW)
      expect(tabletChildViewer(db, helperTablet, token, NOW)).toMatchObject({
        id: null, role: 'observer', facilityId: krippe, onTablet: true,
      })
      expect(tabletUnlockStatus(db, helperTablet, token, NOW)).toMatchObject({ unlocked: true, employeeId: anna, rights: { canEdit: false } })

      db.delete(entries).where(eq(entries.employeeId, anna)).run()
      expect(errorCode(() => tabletChildViewer(db, helperTablet, token, NOW))).toBe('tablet_locked')
      expect(db.select().from(terminalUnlocks).all()).toEqual([])
    })
    it('does not let a helper unlock on other days', () => {
      expect(errorCode(() => unlockChildren(db, helperTablet, anna, '123456', at('2026-10-05T06:00:00Z')))).toBe('employee_not_found')
    })
  })

  it('locks when the PIN is cleared or the employment ends, and drops the unlock', () => {
    const first = unlock()
    clearPin(db, 1, anna)
    expect(errorCode(() => viewer(first.token))).toBe('tablet_locked')
    expect(rows()).toEqual([])

    const second = unlock(berta, '654321')
    db.update(employees).set({ leftOn: '2026-10-05' }).where(eq(employees.id, berta)).run()
    expect(errorCode(() => viewer(second.token))).toBe('tablet_locked')
    expect(rows()).toEqual([])
  })

  it('does not delete the row when only the status is asked for', () => {
    const { token } = unlock()
    clearPin(db, 1, anna)
    expect(tabletUnlockStatus(db, tablet, token, NOW)).toEqual({ unlocked: false })
    expect(rows()).toHaveLength(1)
  })

  describe('deleteExpiredUnlocks', () => {
    it('removes only expired rows, of every tablet', () => {
      const krippe = addFacility(db, 'Krippe')
      const kim = addEmployee(db, 'Kim', { facilityId: krippe })
      setTimeTrackingFrom(db, krippe, '2026-10-01')
      setPin(db, krippe, kim, '111111')
      const other = addUser(db, 'tablet-krippe', 'terminal', null, krippe)
      unlockChildren(db, { id: other.id, facilityId: krippe }, kim, '111111', NOW)
      const mine = unlock()

      expect(deleteExpiredUnlocks(db, after(2 * 60 + 29))).toBe(0)
      expect(rows()).toHaveLength(2)
      // Only the first facility has a longer lock time.
      settings({ lockMinutes: 5 })
      expect(deleteExpiredUnlocks(db, after(2 * 60 + 31))).toBe(1)
      expect(rows().map(row => row.terminalUserId)).toEqual([tablet.id])
      expect(viewer(mine.token, after(2 * 60 + 31), false)).toMatchObject({ onTablet: true })
      expect(deleteExpiredUnlocks(db, after(5 * 60 + 31))).toBe(1)
      expect(rows()).toEqual([])
    })
  })

  describe('windows without the automatic lock', () => {
    // NOW is Tuesday 2026-10-06, 8:00 Berlin time; `clock` gives a Berlin time of that day (seconds optional).
    const clock = (hours: number, minutes: number, seconds = 0, date = '2026-10-06') =>
      new Date(berlinInstant(date, hours * 60 + minutes) + seconds * 1000)
    const windows = (...list: [number, number][]) => settings({ noLockWindows: list.map(([start, end]) => ({ start, end })) })
    const status = (token: string, now: Date) => tabletUnlockStatus(db, tablet, token, now)

    it('keeps an unlock open inside a window; from its end the lock time counts again', () => {
      windows([7 * 60 + 50, 8 * 60 + 30])
      const { token, status: first } = unlock()
      // Only today's window (the day of the last use).
      expect(first).toMatchObject({
        unlocked: true, noLockPeriods: [{ from: clock(7, 50).toISOString(), until: clock(8, 30).toISOString() }],
      })
      expect(status(token, clock(8, 25))).toMatchObject({ unlocked: true })
      expect(viewer(token, clock(8, 29), false)).toMatchObject({ onTablet: true })
      // Window end 8:30 + 2 minutes + grace.
      expect(status(token, clock(8, 32, 30))).toMatchObject({ unlocked: true })
      expect(status(token, clock(8, 32, 31))).toEqual({ unlocked: false })
      expect(errorCode(() => viewer(token, clock(8, 32, 31)))).toBe('tablet_locked')
    })

    it('counts from the last use when that is after the window end (unlocked inside, used after it)', () => {
      windows([7 * 60 + 50, 8 * 60 + 10])
      const { token } = unlock()
      // Used at 8:12, after the window (8:10 + 2 minutes + grace would hold until 8:12:30).
      expect(viewer(token, clock(8, 12))).toMatchObject({ onTablet: true })
      expect(status(token, clock(8, 14, 30))).toMatchObject({ unlocked: true })
      expect(status(token, clock(8, 14, 31))).toEqual({ unlocked: false })
    })

    it('carries an unlock still valid at the window start through it, but does not revive one that ran out before', () => {
      windows([8 * 60 + 5, 8 * 60 + 30])
      const { token } = unlock()
      // Last use 8:00, 2 minutes + grace: ran out 8:02:30, before the window.
      expect(status(token, clock(8, 10))).toEqual({ unlocked: false })
      settings({ lockMinutes: 10 })
      // Still valid at 8:05: open until 8:30 + 10 minutes + grace.
      expect(status(token, clock(8, 20))).toMatchObject({ unlocked: true })
      expect(status(token, clock(8, 40, 30))).toMatchObject({ unlocked: true })
      expect(status(token, clock(8, 40, 31))).toEqual({ unlocked: false })
    })

    it('ends by „Sperren“ and by another person unlocking, also inside a window', () => {
      windows([7 * 60, 9 * 60])
      const first = unlock()
      lockChildren(db, tablet.id, first.token)
      expect(status(first.token, clock(8, 1))).toEqual({ unlocked: false })
      const second = unlock(anna, '123456', clock(8, 2))
      const third = unlock(berta, '654321', clock(8, 3))
      expect(status(second.token, clock(8, 4))).toEqual({ unlocked: false })
      expect(status(third.token, clock(8, 50))).toMatchObject({ unlocked: true, name: 'Berta' })
    })

    it('applies only on days the facility is open: not on a weekend, a holiday, a closure day or a weekday marked closed', () => {
      windows([7 * 60, 9 * 60])
      const saturday = clock(8, 0, 0, '2026-10-10')
      const onSaturday = unlock(anna, '123456', saturday)
      expect(onSaturday.status).toMatchObject({ noLockPeriods: [] })
      expect(status(onSaturday.token, new Date(saturday.getTime() + 2 * 60_000 + 31_000))).toEqual({ unlocked: false })

      // 1. Weihnachtstag, a Friday.
      const christmas = clock(8, 0, 0, '2026-12-25')
      const onHoliday = unlock(anna, '123456', christmas)
      expect(onHoliday.status).toMatchObject({ noLockPeriods: [] })
      expect(status(onHoliday.token, new Date(christmas.getTime() + 2 * 60_000 + 31_000))).toEqual({ unlocked: false })

      db.insert(closures).values({ facilityId: 1, startDate: '2026-10-06', endDate: '2026-10-06', label: 'Team', mode: 'closure_day' }).run()
      const onClosure = unlock()
      expect(status(onClosure.token, after(2 * 60 + 31))).toEqual({ unlocked: false })
      db.delete(closures).run()

      const tuesdayClosed = { open: null, close: null, closed: true }
      const none = { open: null, close: null, closed: false }
      setFacilityOpeningHours(db, 1, { days: [none, tuesdayClosed, none, none, none], minAtOpening: 1, minAtClosing: 1 })
      const onClosedWeekday = unlock()
      expect(status(onClosedWeekday.token, after(2 * 60 + 31))).toEqual({ unlocked: false })
      setFacilityOpeningHours(db, 1, null)
      expect(status(unlock().token, after(30 * 60))).toMatchObject({ unlocked: true })
    })

    it('keeps the rows of unlocks inside a window when the expired ones are deleted', () => {
      windows([7 * 60 + 50, 8 * 60 + 30])
      unlock()
      expect(deleteExpiredUnlocks(db, clock(8, 25))).toBe(0)
      expect(deleteExpiredUnlocks(db, clock(8, 32, 31))).toBe(1)
    })

    it('never carries an unlock over midnight into the next day\'s window', () => {
      // Opening hours 0:00–23:59 every weekday, so the day may hold windows at both ends (cut to 23:59).
      const day = { open: 0, close: 23 * 60 + 59, closed: false }
      setFacilityOpeningHours(db, 1, { days: [day, day, day, day, day], minAtOpening: 1, minAtClosing: 1 }, NOW)
      windows([23 * 60, 1440], [0, 60])
      const late = unlock(anna, '123456', clock(23, 30))
      expect(status(late.token, clock(23, 59))).toMatchObject({ unlocked: true })
      // 23:59 + 2 minutes + grace, although 0:00–1:00 of Wednesday starts within the lock time.
      expect(status(late.token, clock(0, 1, 30, '2026-10-07'))).toMatchObject({ unlocked: true })
      expect(status(late.token, clock(0, 1, 31, '2026-10-07'))).toEqual({ unlocked: false })
      // Touched after midnight: the new day's window applies.
      const touched = unlock(anna, '123456', clock(23, 30))
      viewer(touched.token, clock(0, 1, 0, '2026-10-07'))
      expect(status(touched.token, clock(1, 2, 30, '2026-10-07'))).toMatchObject({ unlocked: true })
      expect(status(touched.token, clock(1, 2, 31, '2026-10-07'))).toEqual({ unlocked: false })
    })

    it('cuts the windows to the day\'s opening hours; 0:00–24:00 only with opening hours for every weekday', () => {
      expect(errorCode(() => windows([0, 1440]))).toBe('tablet_window_too_long')
      const day = { open: 7 * 60, close: 17 * 60, closed: false }
      setFacilityOpeningHours(db, 1, { days: [day, day, day, day, day], minAtOpening: 1, minAtClosing: 1 })
      windows([0, 1440])
      const { token, status: first } = unlock()
      expect(first).toMatchObject({ noLockPeriods: [{ from: clock(7, 0).toISOString(), until: clock(17, 0).toISOString() }] })
      expect(status(token, clock(16, 59))).toMatchObject({ unlocked: true })
      // Closing time 17:00 + 2 minutes + grace; nothing on the next day.
      expect(status(token, clock(17, 2, 30))).toMatchObject({ unlocked: true })
      expect(status(token, clock(17, 2, 31))).toEqual({ unlocked: false })
      expect(status(token, clock(8, 0, 0, '2026-10-07'))).toEqual({ unlocked: false })
    })

    it('without opening hours for every weekday refuses windows spanning more than 14 hours, and caps them at runtime', () => {
      expect(errorCode(() => windows([0, 14 * 60], [14 * 60, 1440]))).toBe('tablet_windows_span_too_long')
      expect(errorCode(() => windows([5 * 60, 14 * 60], [14 * 60 + 20, 1440]))).toBe('tablet_windows_span_too_long')
      // Stored while complete opening hours existed, which were removed since: nothing reaches past 5:00 + 14 hours.
      const day = { open: 5 * 60, close: 24 * 60 - 1, closed: false }
      setFacilityOpeningHours(db, 1, { days: [day, day, day, day, day], minAtOpening: 1, minAtClosing: 1 }, NOW)
      settings({ lockMinutes: 30, noLockWindows: [{ start: 5 * 60, end: 14 * 60 }, { start: 14 * 60 + 20, end: 1440 }] })
      setFacilityOpeningHours(db, 1, null, NOW)
      const { token, status: first } = unlock()
      expect(first).toMatchObject({
        noLockPeriods: [
          { from: clock(5, 0).toISOString(), until: clock(14, 0).toISOString() },
          { from: clock(14, 20).toISOString(), until: clock(19, 0).toISOString() },
        ],
      })
      // 19:00 + 30 minutes + grace.
      expect(status(token, clock(19, 30, 30))).toMatchObject({ unlocked: true })
      expect(status(token, clock(19, 30, 31))).toEqual({ unlocked: false })
    })

    it('does not revive an unlock that ran out when the opening hours or the closures change', () => {
      const admin = addUser(db, 'leitung', 'admin')
      const hours = (close: number) => {
        const day = { open: 7 * 60, close, closed: false }
        return { days: [day, day, day, day, day], minAtOpening: 1, minAtClosing: 1 }
      }
      setFacilityOpeningHours(db, 1, hours(17 * 60), NOW)
      windows([0, 1440])
      // Last use 16:58, the window ends at closing time 17:00: ran out at 17:02:30.
      const late = unlock(anna, '123456', clock(16, 58))
      setFacilityOpeningHours(db, 1, hours(18 * 60), clock(17, 10))
      expect(rows()).toEqual([])
      expect(status(late.token, clock(17, 11))).toEqual({ unlocked: false })
      // One still valid stays (and gets the longer hours).
      const valid = unlock(anna, '123456', clock(16, 59))
      setFacilityOpeningHours(db, 1, hours(17 * 60 + 30), clock(17, 1))
      expect(status(valid.token, clock(17, 20))).toMatchObject({ unlocked: true })

      // Today a closure day: no window; unlocked 8:00, ran out 8:02:30; deleting the closure at 8:10 revives nothing.
      setFacilityOpeningHours(db, 1, null, NOW)
      windows([7 * 60, 9 * 60])
      const closure = createClosure(db, admin, 1, { startDate: '2026-10-06', endDate: '2026-10-06', label: 'Team', mode: 'closure_day' }, NOW)
      const onClosure = unlock()
      deleteClosure(db, admin, 1, closure.id, clock(8, 10))
      expect(rows()).toEqual([])
      expect(status(onClosure.token, clock(8, 11))).toEqual({ unlocked: false })
      // Moving a closure away from today (update) and creating one delete the expired ones too.
      const moved = createClosure(db, admin, 1, { startDate: '2026-10-06', endDate: '2026-10-06', label: 'Team', mode: 'closure_day' }, NOW)
      const again = unlock()
      updateClosure(db, admin, 1, moved.id, { startDate: '2026-10-20', endDate: '2026-10-20', label: 'Team', mode: 'closure_day' }, clock(8, 10))
      expect(status(again.token, clock(8, 11))).toEqual({ unlocked: false })
      windows()
      const third = unlock()
      createClosure(db, admin, 1, { startDate: '2026-10-21', endDate: '2026-10-21', label: 'Team', mode: 'closure_day' }, clock(8, 10))
      expect(rows()).toEqual([])
      expect(status(third.token, clock(8, 11))).toEqual({ unlocked: false })
    })

    it('does not revive an unlock that ran out when a window is saved', () => {
      const { token } = unlock()
      // 8:20: the unlock of 8:00 ran out at 8:02:30; the new window 7:00–9:00 would cover its last use.
      setTabletSettings(db, 1, { lockMinutes: 2, showWaitlist: false, showFutureContracts: false, noLockWindows: [{ start: 420, end: 540 }] }, clock(8, 20))
      expect(rows()).toEqual([])
      expect(status(token, clock(8, 21))).toEqual({ unlocked: false })
    })

    it('keeps an unlock that is still valid when a window is saved', () => {
      const { token } = unlock()
      setTabletSettings(db, 1, { lockMinutes: 2, showWaitlist: false, showFutureContracts: false, noLockWindows: [{ start: 420, end: 540 }] }, clock(8, 1))
      expect(status(token, clock(8, 50))).toMatchObject({ unlocked: true })
    })

    it('leaves stamping alone: it needs the PIN and unlocks nothing', () => {
      windows([7 * 60, 9 * 60])
      expect(errorCode(() => terminalStamp(db, 1, anna, '000000', 'in', NOW))).toBe('pin_invalid')
      terminalStamp(db, 1, anna, '123456', 'in', NOW)
      expect(rows()).toEqual([])
    })
  })
})
