import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { employees, entries, terminalUnlocks, users } from '../../server/db/schema'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { applyToCells } from '../../server/services/entries'
import { clearPin, setPin, terminalStamp } from '../../server/services/terminal'
import {
  deleteExpiredUnlocks, lockChildren, tabletChildViewer, tabletUnlockStatus, unlockChildren,
} from '../../server/services/tabletUnlock'
import { setTabletSettings } from '../../server/services/tabletSettings'
import { addEmployee, addFacility, addHelpOut, addUser, createTestDb, errorCode, templateId } from '../helpers/fixtures'

const at = (iso: string) => new Date(iso)
const NOW = at('2026-10-06T06:00:00Z')
const after = (seconds: number) => new Date(NOW.getTime() + seconds * 1000)

describe('unlocking the tablet for child records', () => {
  let db: Db
  let anna: number
  let berta: number
  let tablet: { id: number; facilityId: number }
  const unlock = (employeeId = anna, pin = '1234', now = NOW) => unlockChildren(db, tablet, employeeId, pin, now)
  const viewer = (token: string | undefined, now = NOW, touch?: boolean) => tabletChildViewer(db, tablet, token, now, touch)
  const rows = () => db.select().from(terminalUnlocks).all()
  const settings = (changes: Partial<{ lockMinutes: number; showWaitlist: boolean; showFutureContracts: boolean }> = {}) => setTabletSettings(
    db, 1, { lockMinutes: 2, showWaitlist: false, showFutureContracts: false, ...changes },
  )

  beforeEach(() => {
    db = createTestDb()
    anna = addEmployee(db, 'Anna')
    berta = addEmployee(db, 'Berta')
    setTimeTrackingFrom(db, 1, '2026-10-01')
    setPin(db, 1, anna, '1234')
    setPin(db, 1, berta, '4321')
    const account = addUser(db, 'tablet', 'terminal')
    tablet = { id: account.id, facilityId: account.facilityId! }
  })

  it('unlocks with the right PIN and returns the person and rights', () => {
    const { token, status } = unlock()
    expect(status).toEqual({
      unlocked: true, employeeId: anna, name: 'Anna', lockMinutes: 2,
      rights: { canEdit: false, isManager: false, canMoveFacility: false, showWaitlist: false, showFutureContracts: false },
    })
    expect(token.length).toBeGreaterThanOrEqual(40)
    expect(tabletUnlockStatus(db, tablet, token, NOW)).toEqual(status)
  })

  it('counts wrong PINs together with stamping', () => {
    for (let attempt = 1; attempt <= 4; attempt++) {
      expect(errorCode(() => unlock(anna, '0000'))).toBe('pin_invalid')
    }
    expect(errorCode(() => terminalStamp(db, 1, anna, '0000', 'in', NOW))).toBe('pin_locked')
    expect(errorCode(() => unlock(anna, '1234', after(14 * 60)))).toBe('pin_locked')
    expect(unlock(anna, '1234', after(16 * 60)).status.unlocked).toBe(true)
    expect(rows()).toHaveLength(1)
  })

  it('refuses people who are not on the tablet list, without counting an attempt', () => {
    const carla = addEmployee(db, 'Carla')
    const dora = addEmployee(db, 'Dora', { leftOn: '2026-09-30' })
    setPin(db, 1, dora, '1234')
    const krippe = addFacility(db, 'Krippe')
    const kim = addEmployee(db, 'Kim', { facilityId: krippe })
    setTimeTrackingFrom(db, krippe, '2026-10-01')
    setPin(db, krippe, kim, '1234')
    for (const id of [carla, dora, kim, 9999]) {
      for (let attempt = 1; attempt <= 6; attempt++) expect(errorCode(() => unlock(id, '0000'))).toBe('employee_not_found')
    }
    expect(db.select().from(employees).where(eq(employees.id, kim)).get()).toMatchObject({ pinFailed: 0, pinLockedUntil: null })
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
    const third = unlock(berta, '4321')
    expect(errorCode(() => viewer(second.token))).toBe('tablet_locked')
    expect(tabletUnlockStatus(db, tablet, third.token, NOW)).toMatchObject({ unlocked: true, employeeId: berta, name: 'Berta' })
    expect(rows()).toHaveLength(1)
  })

  it('leaves a newer unlock alone when a device locks with its replaced token', () => {
    // Device A unlocked, then device B with the same account; A notices, goes to its start page and locks there.
    const deviceA = unlock(anna)
    const deviceB = unlock(berta, '4321')
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
        id: null, employeeId: anna, name: 'Anna', role: 'observer', canEditChildren: false, facilityId: 1,
        visibility: { waitlist: false, futureContracts: false }, onTablet: true,
      })
    })
    it('gives a Mitarbeiter account its edit flag, as it is now', () => {
      const account = addUser(db, 'anna', 'observer', anna)
      db.update(users).set({ canEditChildren: true }).where(eq(users.id, account.id)).run()
      const { token, status } = unlock()
      expect(viewer(token)).toMatchObject({ id: account.id, role: 'observer', canEditChildren: true })
      expect(status).toMatchObject({ rights: { canEdit: true, isManager: false } })
      db.update(users).set({ canEditChildren: false }).where(eq(users.id, account.id)).run()
      expect(viewer(token)).toMatchObject({ id: account.id, canEditChildren: false })
      expect(tabletUnlockStatus(db, tablet, token, NOW)).toMatchObject({ rights: { canEdit: false } })
    })
    it('treats a deactivated account as read only', () => {
      const account = addUser(db, 'anna', 'observer', anna)
      db.update(users).set({ canEditChildren: true, active: false }).where(eq(users.id, account.id)).run()
      const { token } = unlock()
      expect(viewer(token)).toMatchObject({ id: null, role: 'observer', canEditChildren: false })
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
      db.update(users).set({ canEditChildren: true }).where(eq(users.id, account.id)).run()
      const { token } = unlockChildren(db, helperTablet, anna, '1234', NOW)
      expect(tabletChildViewer(db, helperTablet, token, NOW)).toMatchObject({
        id: null, role: 'observer', canEditChildren: false, facilityId: krippe, onTablet: true,
      })
      expect(tabletUnlockStatus(db, helperTablet, token, NOW)).toMatchObject({ unlocked: true, employeeId: anna, rights: { canEdit: false } })

      db.delete(entries).where(eq(entries.employeeId, anna)).run()
      expect(errorCode(() => tabletChildViewer(db, helperTablet, token, NOW))).toBe('tablet_locked')
      expect(db.select().from(terminalUnlocks).all()).toEqual([])
    })
    it('does not let a helper unlock on other days', () => {
      expect(errorCode(() => unlockChildren(db, helperTablet, anna, '1234', at('2026-10-05T06:00:00Z')))).toBe('employee_not_found')
    })
  })

  it('locks when the PIN is cleared or the employment ends, and drops the unlock', () => {
    const first = unlock()
    clearPin(db, 1, anna)
    expect(errorCode(() => viewer(first.token))).toBe('tablet_locked')
    expect(rows()).toEqual([])

    const second = unlock(berta, '4321')
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
      setPin(db, krippe, kim, '1111')
      const other = addUser(db, 'tablet-krippe', 'terminal', null, krippe)
      unlockChildren(db, { id: other.id, facilityId: krippe }, kim, '1111', NOW)
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
})
