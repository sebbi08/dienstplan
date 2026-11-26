import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { changeLog, entries, monthPlans, terminalUnlocks, users } from '../../server/db/schema'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { applyToCells } from '../../server/services/entries'
import { saveBundleOverride } from '../../server/services/permissions'
import { releaseMonth } from '../../server/services/release'
import { setTabletSettings } from '../../server/services/tabletSettings'
import { setPin } from '../../server/services/terminal'
import {
  deleteExpiredUnlocks, lockChildren, startPlanEdit, tabletChildViewer, tabletPlanEditor, tabletPlanReader, tabletUnlockStatus,
  unlockChildren,
} from '../../server/services/tabletUnlock'
import { berlinInstant } from '../../shared/domain/tablet'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addHelpOut, addUser, createTestDb, errorCode, templateId } from '../helpers/fixtures'

// Tuesday 2026-10-06, 8:00 Berlin time.
const NOW = new Date('2026-10-06T06:00:00Z')
const after = (seconds: number) => new Date(NOW.getTime() + seconds * 1000)
const clock = (hours: number, minutes: number, seconds = 0) => new Date(berlinInstant('2026-10-06', hours * 60 + minutes) + seconds * 1000)

describe('„Dienstplan bearbeiten“ at the tablet', () => {
  let db: Db
  let tablet: { id: number; facilityId: number }
  let lena: number
  let mia: number
  let nora: number
  let leitung: SessionUser
  let mitarbeiterin: SessionUser
  const unlock = (employeeId: number, pin: string, now = NOW) => unlockChildren(db, tablet, employeeId, pin, now).token
  const rows = () => db.select().from(terminalUnlocks).all()

  beforeEach(() => {
    db = createTestDb()
    lena = addEmployee(db, 'Lena')
    mia = addEmployee(db, 'Mia')
    nora = addEmployee(db, 'Nora')
    setTimeTrackingFrom(db, 1, '2026-10-01')
    setPin(db, 1, lena, '111111')
    setPin(db, 1, mia, '222222')
    setPin(db, 1, nora, '333333')
    // Lena: Leitung account (plan.edit, plan.release); Mia: Mitarbeiter account (no plan.edit); Nora: no account.
    leitung = addUser(db, 'lena', 'admin', lena)
    mitarbeiterin = addUser(db, 'mia', 'observer', mia)
    tablet = { id: addUser(db, 'tablet', 'terminal').id, facilityId: 1 }
    setTabletSettings(db, 1, { lockMinutes: 2, showWaitlist: false, showFutureContracts: false }, NOW)
  })

  it('offers editing only to a person whose own account has plan.edit here, with what else that account may', () => {
    const token = unlock(lena, '111111')
    expect(tabletUnlockStatus(db, tablet, token, NOW)).toMatchObject({
      unlocked: true, planEdit: { active: false, canRelease: true, seesPersonal: true },
    })
    expect(tabletUnlockStatus(db, tablet, unlock(mia, '222222'), NOW)).toMatchObject({ unlocked: true, planEdit: null })
    expect(tabletUnlockStatus(db, tablet, unlock(nora, '333333'), NOW)).toMatchObject({ unlocked: true, planEdit: null })
    // A Mitarbeiter account with the exception „Dienstplan bearbeiten“: plan.edit, not plan.release.
    saveBundleOverride(db, mitarbeiterin.id, 'planEdit', 'grant')
    expect(tabletUnlockStatus(db, tablet, unlock(mia, '222222'), NOW)).toMatchObject({
      planEdit: { active: false, canRelease: false, seesPersonal: false },
    })
  })

  it('refuses the editor without an unlock, without the start, and without the right', () => {
    expect(errorCode(() => tabletPlanEditor(db, tablet, undefined, NOW))).toBe('tablet_locked')
    expect(errorCode(() => tabletPlanEditor(db, tablet, 'no-such-token', NOW))).toBe('tablet_locked')
    expect(errorCode(() => startPlanEdit(db, tablet, undefined, NOW))).toBe('tablet_locked')
    const lenaToken = unlock(lena, '111111')
    // Unlocked for the child records only: no plan editing.
    expect(errorCode(() => tabletPlanEditor(db, tablet, lenaToken, NOW))).toBe('forbidden')
    expect(tabletPlanReader(db, tablet, lenaToken, NOW)).toBeNull()
    // Mitarbeiterin and a person without account cannot start it.
    expect(errorCode(() => startPlanEdit(db, tablet, unlock(mia, '222222'), NOW))).toBe('forbidden')
    const noraToken = unlock(nora, '333333')
    expect(errorCode(() => startPlanEdit(db, tablet, noraToken, NOW))).toBe('forbidden')
    expect(rows()).toEqual([expect.objectContaining({ id: noraToken, planEditSince: null })])
  })

  it('edits as the person\'s own account in the tablet\'s facility, and every change names that account', () => {
    const token = unlock(lena, '111111')
    expect(startPlanEdit(db, tablet, token, NOW)).toMatchObject({ unlocked: true, planEdit: { active: true }, noLockPeriods: [] })
    expect(tabletPlanReader(db, tablet, token, NOW)).toMatchObject({ id: leitung.id, facilityId: 1 })
    const editor = tabletPlanEditor(db, tablet, token, after(10))
    expect(editor).toMatchObject({ id: leitung.id, username: 'lena', role: 'admin', employeeId: lena, facilityId: 1 })
    expect(editor.permissions.has('plan.edit')).toBe(true)
    // The request counts as use of the tablet.
    expect(rows()[0]!.lastActiveAt).toBe(after(10).toISOString())

    // A released month: the change shows in its history with the person's account, never the tablet's.
    releaseMonth(db, editor, 1, 2026, 10, after(20))
    expect(db.select().from(monthPlans).get()).toMatchObject({ releasedBy: leitung.id })
    applyToCells(db, editor, editor.facilityId, [{ employeeId: mia, date: '2026-10-07' }], 'replace',
      { kind: 'shift', templateId: templateId(db, 'M') }, { now: after(30) })
    expect(db.select().from(entries).where(eq(entries.employeeId, mia)).get()).toMatchObject({ updatedBy: leitung.id })
    expect(db.select().from(changeLog).all()).toEqual([expect.objectContaining({ changedBy: leitung.id, employeeId: mia })])
  })

  it('ends with the lock, another person\'s unlock and the lock time', () => {
    const token = unlock(lena, '111111')
    startPlanEdit(db, tablet, token, NOW)
    lockChildren(db, tablet.id, token)
    expect(errorCode(() => tabletPlanEditor(db, tablet, token, NOW))).toBe('tablet_locked')

    const again = unlock(lena, '111111')
    startPlanEdit(db, tablet, again, NOW)
    unlock(mia, '222222')
    expect(errorCode(() => tabletPlanEditor(db, tablet, again, NOW))).toBe('tablet_locked')

    const third = unlock(lena, '111111')
    startPlanEdit(db, tablet, third, NOW)
    // 2 minutes plus grace after the last use.
    expect(tabletPlanEditor(db, tablet, third, after(150)).id).toBe(leitung.id)
    expect(errorCode(() => tabletPlanEditor(db, tablet, third, after(150 + 151)))).toBe('tablet_locked')
  })

  it('does not keep the plan open through a window without the automatic lock (the child records alone it does)', () => {
    setTabletSettings(db, 1, { lockMinutes: 2, showWaitlist: false, showFutureContracts: false, noLockWindows: [{ start: 7 * 60, end: 12 * 60 }] }, NOW)
    const childOnly = unlock(mia, '222222')
    expect(tabletChildViewer(db, tablet, childOnly, clock(9, 0), false)).toMatchObject({ onTablet: true })

    const token = unlock(lena, '111111')
    expect(tabletUnlockStatus(db, tablet, token, NOW)).toMatchObject({ noLockPeriods: [expect.anything()] })
    expect(startPlanEdit(db, tablet, token, NOW)).toMatchObject({ noLockPeriods: [] })
    expect(tabletUnlockStatus(db, tablet, token, clock(8, 2, 30))).toMatchObject({ unlocked: true })
    expect(tabletUnlockStatus(db, tablet, token, clock(8, 2, 31))).toEqual({ unlocked: false })
    expect(errorCode(() => tabletChildViewer(db, tablet, token, clock(8, 2, 31)))).toBe('tablet_locked')
    expect(errorCode(() => tabletPlanEditor(db, tablet, token, clock(8, 2, 31)))).toBe('tablet_locked')
    // The clean-up (before saving settings, the daily run) judges such an unlock the same way.
    expect(deleteExpiredUnlocks(db, clock(8, 2, 30))).toBe(0)
    expect(deleteExpiredUnlocks(db, clock(8, 2, 31))).toBe(1)
    expect(rows()).toEqual([])
  })

  it('locks the tablet once the editing person\'s account loses plan.edit, is deactivated, or the person leaves the list', () => {
    saveBundleOverride(db, mitarbeiterin.id, 'planEdit', 'grant')
    const token = unlock(mia, '222222')
    startPlanEdit(db, tablet, token, NOW)
    expect(tabletPlanEditor(db, tablet, token, NOW).permissions.has('plan.release')).toBe(false)
    saveBundleOverride(db, mitarbeiterin.id, 'planEdit', null)
    expect(tabletUnlockStatus(db, tablet, token, NOW)).toEqual({ unlocked: false })
    expect(errorCode(() => tabletPlanEditor(db, tablet, token, NOW))).toBe('tablet_locked')
    expect(rows()).toEqual([])

    // Unlocked for the child records only, the same loss changes nothing there.
    const childOnly = unlock(lena, '111111')
    saveBundleOverride(db, leitung.id, 'planEdit', 'revoke')
    expect(tabletChildViewer(db, tablet, childOnly, NOW)).toMatchObject({ onTablet: true })
  })

  it('never lets one tablet\'s unlock edit at another facility, nor a helper from another facility', () => {
    const krippe = addFacility(db, 'Krippe')
    const krippeTablet = { id: addUser(db, 'tablet-krippe', 'terminal', null, krippe).id, facilityId: krippe }
    const token = unlock(lena, '111111')
    startPlanEdit(db, tablet, token, NOW)
    expect(errorCode(() => tabletPlanEditor(db, krippeTablet, token, NOW))).toBe('tablet_locked')
    expect(tabletPlanReader(db, krippeTablet, token, NOW)).toBeNull()

    // Lena helps out in the Krippe today: on its tablet's list, but her account is the Leitung of facility 1.
    const krippeLeitung = addUser(db, 'leitung-krippe', 'admin', null, krippe)
    addHelpOut(db, lena, krippe, 2026, 10)
    applyToCells(db, krippeLeitung, krippe, [{ employeeId: lena, date: '2026-10-06' }], 'replace', { kind: 'shift', templateId: templateId(db, 'M', krippe) })
    const helper = unlockChildren(db, krippeTablet, lena, '111111', NOW)
    expect(helper.status).toMatchObject({ unlocked: true, planEdit: null })
    expect(errorCode(() => startPlanEdit(db, krippeTablet, helper.token, NOW))).toBe('forbidden')
  })

  it('tells whether the sick days right comes along', () => {
    expect(tabletUnlockStatus(db, tablet, unlock(lena, '111111'), NOW)).toMatchObject({ planEdit: { seesSickness: true } })
    saveBundleOverride(db, mitarbeiterin.id, 'planEdit', 'grant')
    expect(tabletUnlockStatus(db, tablet, unlock(mia, '222222'), NOW)).toMatchObject({ planEdit: { seesSickness: false } })
  })

  it('refuses an account that must change its password first, as the login does', () => {
    db.update(users).set({ mustChangePassword: true }).where(eq(users.id, leitung.id)).run()
    const token = unlock(lena, '111111')
    expect(tabletUnlockStatus(db, tablet, token, NOW)).toMatchObject({ unlocked: true, planEdit: null })
    expect(errorCode(() => startPlanEdit(db, tablet, token, NOW))).toBe('forbidden')
    // Flagged while editing: the tablet locks.
    db.update(users).set({ mustChangePassword: false }).where(eq(users.id, leitung.id)).run()
    const again = unlock(lena, '111111')
    startPlanEdit(db, tablet, again, NOW)
    db.update(users).set({ mustChangePassword: true }).where(eq(users.id, leitung.id)).run()
    expect(errorCode(() => tabletPlanEditor(db, tablet, again, NOW))).toBe('tablet_locked')
  })

  it('needs the account itself in the tablet\'s facility, not only its employee', () => {
    const krippe = addFacility(db, 'Krippe')
    db.update(users).set({ facilityId: krippe }).where(eq(users.id, leitung.id)).run()
    expect(tabletUnlockStatus(db, tablet, unlock(lena, '111111'), NOW)).toMatchObject({ planEdit: null })
  })

  it('locks after at most 5 minutes without use while editing, whatever the facility\'s lock time', () => {
    setTabletSettings(db, 1, { lockMinutes: 30, showWaitlist: false, showFutureContracts: false }, NOW)
    const token = unlock(lena, '111111')
    expect(tabletUnlockStatus(db, tablet, token, NOW)).toMatchObject({ lockMinutes: 30 })
    expect(startPlanEdit(db, tablet, token, NOW)).toMatchObject({ lockMinutes: 5 })
    expect(tabletUnlockStatus(db, tablet, token, after(5 * 60 + 30))).toMatchObject({ unlocked: true })
    expect(tabletUnlockStatus(db, tablet, token, after(5 * 60 + 31))).toEqual({ unlocked: false })
    expect(deleteExpiredUnlocks(db, after(5 * 60 + 31))).toBe(1)
  })

  it('reads the plan as the editor only from a valid editing unlock, else as the tablet (never refusing)', () => {
    const token = unlock(lena, '111111')
    expect(tabletPlanReader(db, tablet, token, NOW)).toBeNull()
    startPlanEdit(db, tablet, token, NOW)
    expect(tabletPlanReader(db, tablet, token, after(60))).toMatchObject({ id: leitung.id })
    expect(rows()[0]!.lastActiveAt).toBe(after(60).toISOString())
    // Run out but not yet deleted: the released plan, no 403.
    expect(tabletPlanReader(db, tablet, token, after(60 + 151))).toBeNull()
    expect(tabletPlanReader(db, tablet, undefined, NOW)).toBeNull()
  })

  it('ends an editing session 60 minutes after its start, however much it is used', () => {
    const token = unlock(lena, '111111')
    expect(startPlanEdit(db, tablet, token, NOW)).toMatchObject({
      planEdit: { active: true, endsAt: after(60 * 60).toISOString() },
    })
    // Used every two minutes: the lock time never runs out, starting once more does not move the start.
    for (let seconds = 120; seconds <= 60 * 60; seconds += 120) {
      expect(tabletPlanEditor(db, tablet, token, after(seconds)).id, String(seconds)).toBe(leitung.id)
    }
    expect(startPlanEdit(db, tablet, token, after(60 * 60))).toMatchObject({ planEdit: { endsAt: after(60 * 60).toISOString() } })
    expect(tabletUnlockStatus(db, tablet, token, after(60 * 60 + 1))).toEqual({ unlocked: false })
    expect(tabletPlanReader(db, tablet, token, after(60 * 60 + 1))).toBeNull()
    // The tablet locks: a new PIN is needed (the child records end with it).
    expect(rows()).toEqual([])
    expect(errorCode(() => tabletChildViewer(db, tablet, token, after(60 * 60 + 2)))).toBe('tablet_locked')

    // The clean-up removes such a session too, even while it is in use.
    const again = unlock(lena, '111111', after(2 * 60 * 60))
    startPlanEdit(db, tablet, again, after(2 * 60 * 60))
    db.update(terminalUnlocks).set({ lastActiveAt: after(3 * 60 * 60).toISOString() }).run()
    expect(deleteExpiredUnlocks(db, after(3 * 60 * 60))).toBe(0)
    expect(deleteExpiredUnlocks(db, after(3 * 60 * 60 + 1))).toBe(1)
  })

  it('ends the person\'s unlocks with a new PIN', () => {
    const token = unlock(lena, '111111')
    startPlanEdit(db, tablet, token, NOW)
    setPin(db, 1, lena, '999999')
    expect(rows()).toEqual([])
    expect(errorCode(() => tabletPlanEditor(db, tablet, token, NOW))).toBe('tablet_locked')
  })
})
