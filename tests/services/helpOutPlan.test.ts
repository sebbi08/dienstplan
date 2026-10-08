import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { entries, facilities, notifications, releaseSnapshots } from '../../server/db/schema'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { moveEmployeeToFacility } from '../../server/services/employees'
import { applyToCells } from '../../server/services/entries'
import { getMonthPlan } from '../../server/services/plan'
import { loadEntries } from '../../server/services/queries'
import { buildSnapshot, loadReleases, releaseMonth } from '../../server/services/release'
import { revertToRelease } from '../../server/services/revert'
import { createRecord } from '../../server/services/timeTracking'
import { cellKey } from '../../shared/domain/cells'
import type { EntryInput, SessionUser, SnapshotData } from '../../shared/types/api'
import { addEmployee, addFacility, addHelpOut, addUser, codeId, createTestDb, templateId } from '../helpers/fixtures'

// 2026-10-05 is a Monday.
const monday = '2026-10-05'
const tuesday = '2026-10-06'
const wednesday = '2026-10-07'
const today = '2026-10-01'

describe('help-outs in plans, releases, discard and notifications', () => {
  let db: Db
  /** A: the home facility (facility 1). */
  let leitungA: SessionUser
  /** B: the facility Anna helps out in. */
  let krippe: number
  let leitungB: SessionUser
  let anna: number
  let lena: number
  let kim: number
  let homeName: string

  beforeEach(() => {
    db = createTestDb()
    krippe = addFacility(db, 'Krippe')
    leitungA = addUser(db, 'leitung-a', 'admin')
    leitungB = addUser(db, 'leitung-b', 'admin', null, krippe)
    anna = addEmployee(db, 'Anna')
    lena = addEmployee(db, 'Lena')
    kim = addEmployee(db, 'Kim', { facilityId: krippe })
    addHelpOut(db, anna, krippe, 2026, 10)
    homeName = db.select().from(facilities).where(eq(facilities.id, 1)).get()!.name
  })

  const shiftIn = (facilityId: number, label = 'F1'): EntryInput => ({ kind: 'shift', templateId: templateId(db, label, facilityId) })
  const write = (actor: SessionUser, facilityId: number, employeeId: number, date: string, input: EntryInput | null, mode: 'replace' | 'add' | 'clear' = 'replace') =>
    applyToCells(db, actor, facilityId, [{ employeeId, date }], mode, input)
  const planA = () => getMonthPlan(db, leitungA, 1, 2026, 10, today)
  const planB = () => getMonthPlan(db, leitungB, krippe, 2026, 10, today)
  const cell = (employeeId: number, date: string) => loadEntries(db, { employeeId, from: date, to: date })
    .map(entry => [entry.shortLabel ?? entry.codeKey, entry.helpFacilityId])
  /** Anna helps out in B on Tuesday with an F1 of B. */
  const helpOutTuesday = (label = 'F1') => write(leitungB, krippe, anna, tuesday, shiftIn(krippe, label))
  const release = (actor: SessionUser, facilityId: number, at: string) => releaseMonth(db, actor, facilityId, 2026, 10, new Date(at))

  describe('the plan of B', () => {
    it('has a helper column with helpFrom after its own staff and shows only B\'s entries of the helper', () => {
      helpOutTuesday()
      write(leitungA, 1, anna, monday, shiftIn(1))
      write(leitungB, krippe, kim, tuesday, shiftIn(krippe))
      const plan = planB()
      expect(plan.employees).toEqual([
        { id: kim, name: 'Kim', shortName: 'Ki', helpFrom: null },
        { id: anna, name: 'Anna', shortName: 'An', helpFrom: homeName },
      ])
      expect(plan.entries.map(entry => [entry.employeeId, entry.date, entry.helpFacilityId])).toEqual([
        [anna, tuesday, krippe], [kim, tuesday, null],
      ])
      expect(plan.facilityId).toBe(krippe)
      expect(plan.facilityNames[krippe]).toBe('Krippe')
      expect(plan.admin!.helpers.map(helper => [helper.employeeId, helper.fromFacility])).toEqual([[anna, homeName]])
      // Monday belongs to A's plan: "belegt" in B.
      expect(plan.admin!.helperBusy).toEqual({ [anna]: [monday] })
    })

    it('counts the helper for coverage but gives no missing, target, totals, balance or actual for them', () => {
      setTimeTrackingFrom(db, krippe, '2026-10-01')
      helpOutTuesday()
      write(leitungB, krippe, anna, wednesday, { kind: 'code', codeId: codeId(db, 'prep_time'), start: 450, end: 570 })
      createRecord(db, leitungA, 1, { employeeId: anna, date: tuesday, start: 420, end: 795 }, new Date('2026-10-08T10:00:00Z'))
      const admin = getMonthPlan(db, leitungB, krippe, 2026, 10, '2026-10-08').admin!
      const early = (date: string) => admin.warnings.filter(w => w.type === 'coverage' && w.date === date && w.label === 'Frühdienst ab 7:00')
      expect(early(tuesday)).toEqual([])
      expect(early(monday)).toHaveLength(1)
      expect(admin.warnings.filter(w => 'employeeId' in w && w.employeeId === anna)).toEqual([])
      expect(admin.warnings.some(w => w.type === 'missing_entry' && w.employeeId === kim)).toBe(true)
      expect(admin.weeks.every(week => week.totals.every(total => total.employeeId === kim))).toBe(true)
      expect(admin.balances.map(balance => balance.employeeId)).toEqual([kim])
      expect(admin.actuals).toEqual({})
    })
  })

  describe('the plan of A', () => {
    it('shows the marker, counts the day as filled but not for coverage, and totals include the help-out hours', () => {
      helpOutTuesday()
      const plan = planA()
      expect(plan.employees.map(employee => employee.id)).toEqual([anna, lena])
      expect(plan.entries.map(entry => [entry.employeeId, entry.date, entry.helpFacilityId])).toEqual([[anna, tuesday, krippe]])
      expect(plan.facilityNames[krippe]).toBe('Krippe')
      expect(plan.facilityNames[1]).toBe(homeName)
      const admin = plan.admin!
      expect(admin.helpers).toEqual([])
      expect(admin.helperBusy).toEqual({})
      const missing = (employeeId: number, date: string) => admin.warnings.some(w => w.type === 'missing_entry' && w.employeeId === employeeId && w.date === date)
      expect(missing(anna, tuesday)).toBe(false)
      expect(missing(anna, monday)).toBe(true)
      expect(missing(lena, tuesday)).toBe(true)
      expect(admin.warnings.filter(w => w.type === 'coverage' && w.date === tuesday && w.label === 'Frühdienst ab 7:00')).toHaveLength(1)
      const week = admin.weeks.find(w => w.weekStart === monday)!
      // F1 7:00–13:15 = 375 minutes.
      expect(week.totals.find(total => total.employeeId === anna)!.credit).toBe(375)
      expect(admin.balances.map(balance => balance.employeeId)).toEqual([anna, lena])
    })

    it('has the marker in its snapshot, but never as a pending change', () => {
      release(leitungA, 1, '2026-09-25T10:00:00Z')
      helpOutTuesday()
      expect(buildSnapshot(db, 1, 2026, 10).entries.map(entry => [entry.employeeId, entry.helpFacilityId])).toEqual([[anna, krippe]])
      expect(planA().admin!.pendingChanges).toEqual({})
      release(leitungA, 1, '2026-09-26T10:00:00Z')
      // The marker entering A's released plan is no change of A's.
      expect(planA().changes).toEqual({})
      write(leitungB, krippe, anna, tuesday, null, 'clear')
      expect(planA().admin!.pendingChanges).toEqual({})
    })
  })

  describe('releases and notifications', () => {
    it('tells the helper once about B\'s changes; A\'s re-release does not tell them again', () => {
      helpOutTuesday()
      release(leitungB, krippe, '2026-09-25T10:00:00Z')
      release(leitungA, 1, '2026-09-25T11:00:00Z')
      expect(loadReleases(db, krippe, 2026, 10)[0]!.data.employees.map(employee => employee.helpFrom)).toEqual([null, homeName])
      helpOutTuesday('F2')
      expect(Object.keys(planB().admin!.pendingChanges)).toEqual([cellKey(anna, tuesday)])
      expect(planA().admin!.pendingChanges).toEqual({})
      expect(release(leitungB, krippe, '2026-09-26T10:00:00Z')).toEqual({ notified: ['Anna'] })
      expect(release(leitungA, 1, '2026-09-26T11:00:00Z')).toEqual({ notified: [] })
      const told = db.select().from(notifications).all()
      expect(told.map(row => row.employeeId)).toEqual([anna])
      expect(JSON.parse(told[0]!.changes)).toEqual([{ date: tuesday, before: 'F1 7:00–13:15', after: expect.stringContaining('F2') }])
    })
  })

  describe('discard', () => {
    it('restores a helper cell in B as B\'s entries', () => {
      helpOutTuesday()
      release(leitungB, krippe, '2026-09-25T10:00:00Z')
      helpOutTuesday('F2')
      expect(revertToRelease(db, leitungB, krippe, 2026, 10, [cellKey(anna, tuesday)])).toBe(1)
      expect(cell(anna, tuesday)).toEqual([['F1', krippe]])
      expect(planB().admin!.pendingChanges).toEqual({})
    })

    it('skips a helper cell in B after A\'s "Krank" override', () => {
      helpOutTuesday()
      release(leitungB, krippe, '2026-09-25T10:00:00Z')
      write(leitungA, 1, anna, tuesday, { kind: 'code', codeId: codeId(db, 'sick') })
      expect(Object.keys(planB().admin!.pendingChanges)).toEqual([cellKey(anna, tuesday)])
      expect(revertToRelease(db, leitungB, krippe, 2026, 10, [cellKey(anna, tuesday)])).toBe(0)
      expect(cell(anna, tuesday)).toEqual([['sick', null]])
    })

    it('a revert key for a helper cell never deletes A\'s home entries', () => {
      helpOutTuesday()
      release(leitungB, krippe, '2026-09-25T10:00:00Z')
      write(leitungB, krippe, anna, tuesday, null, 'clear')
      write(leitungA, 1, anna, tuesday, shiftIn(1, 'M'))
      expect(revertToRelease(db, leitungB, krippe, 2026, 10, [cellKey(anna, tuesday)])).toBe(0)
      expect(cell(anna, tuesday)).toEqual([['M', null]])
    })

    it('discarding in A never deletes B\'s entries and restores only A\'s own entries', () => {
      write(leitungA, 1, anna, monday, shiftIn(1, 'M'))
      helpOutTuesday()
      release(leitungA, 1, '2026-09-25T10:00:00Z')
      write(leitungA, 1, anna, monday, shiftIn(1, 'S'))
      // The marker is not A's: a key for it changes nothing.
      expect(revertToRelease(db, leitungA, 1, 2026, 10, [cellKey(anna, monday), cellKey(anna, tuesday)])).toBe(1)
      expect(cell(anna, monday)).toEqual([['M', null]])
      expect(cell(anna, tuesday)).toEqual([['F1', krippe]])
      // B plans another day after A's release; A's key for that day leaves it alone.
      write(leitungB, krippe, anna, wednesday, shiftIn(krippe))
      expect(planA().admin!.pendingChanges).toEqual({})
      expect(revertToRelease(db, leitungA, 1, 2026, 10, [cellKey(anna, wednesday)])).toBe(0)
      expect(cell(anna, wednesday)).toEqual([['F1', krippe]])
    })

    it('discarding in A skips a day B planned after A cleared it', () => {
      write(leitungA, 1, anna, tuesday, shiftIn(1, 'M'))
      release(leitungA, 1, '2026-09-25T10:00:00Z')
      write(leitungA, 1, anna, tuesday, null, 'clear')
      helpOutTuesday()
      expect(revertToRelease(db, leitungA, 1, 2026, 10, [cellKey(anna, tuesday)])).toBe(0)
      expect(cell(anna, tuesday)).toEqual([['F1', krippe]])
    })
  })

  describe('moving the helper into B', () => {
    it('leaves nothing pending in B or A for their former help-out cells', () => {
      const provider = addUser(db, 'traeger', 'provider')
      addHelpOut(db, anna, krippe, 2026, 11)
      write(leitungB, krippe, anna, '2026-11-03', shiftIn(krippe))
      releaseMonth(db, leitungB, krippe, 2026, 11, new Date('2026-10-20T08:00:00Z'))
      releaseMonth(db, leitungA, 1, 2026, 11, new Date('2026-10-20T09:00:00Z'))
      moveEmployeeToFacility(db, provider, anna, krippe, new Date('2026-10-28T08:00:00Z'))
      expect(cell(anna, '2026-11-03')).toEqual([['F1', null]])
      expect(getMonthPlan(db, leitungB, krippe, 2026, 11, '2026-10-28').admin!.pendingChanges).toEqual({})
      expect(getMonthPlan(db, leitungA, 1, 2026, 11, '2026-10-28').admin!.pendingChanges).toEqual({})
    })
  })

  describe('old snapshots', () => {
    it('reads a snapshot without helpFacilityId and helpFrom as null', () => {
      write(leitungA, 1, anna, monday, shiftIn(1))
      release(leitungA, 1, '2026-09-25T10:00:00Z')
      const stored = db.select().from(releaseSnapshots).get()!
      const data = JSON.parse(stored.data) as SnapshotData
      const old = {
        ...data,
        employees: data.employees.map(({ helpFrom: _helpFrom, ...rest }) => rest),
        entries: data.entries.map(({ helpFacilityId: _helpFacilityId, ...rest }) => rest),
      }
      db.update(releaseSnapshots).set({ data: JSON.stringify(old) }).where(eq(releaseSnapshots.id, stored.id)).run()
      expect(stored.data).not.toBe(JSON.stringify(old))

      expect(planA().admin!.pendingChanges).toEqual({})
      const observer = addUser(db, 'anna', 'observer', anna)
      const plan = getMonthPlan(db, observer, 1, 2026, 10, today)
      expect(plan.employees.map(employee => employee.helpFrom)).toEqual([null, null])
      expect(plan.entries.map(entry => [entry.employeeId, entry.helpFacilityId])).toEqual([[anna, null]])
      // A re-release compares against the old snapshot without telling anyone.
      expect(release(leitungA, 1, '2026-09-26T10:00:00Z')).toEqual({ notified: [] })
      expect(db.select().from(entries).all()).toHaveLength(1)
    })
  })
})
