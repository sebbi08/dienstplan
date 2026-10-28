import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { employees, groupReadAccess } from '../../server/db/schema'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { applyToCells } from '../../server/services/entries'
import {
  getReadAccess, listReadAccess, readAccessFacility, setReadAccess,
} from '../../server/services/groupReadAccess'
import { deleteGroup } from '../../server/services/groups'
import { resolveChildViewer, unlockChildren } from '../../server/services/tabletUnlock'
import { setPin } from '../../server/services/terminal'
import type { SessionUser } from '../../shared/types/api'
import {
  addEmployee, addFacility, addGroup, addHelpOut, addUser, asChildViewer, createTestDb, errorCode, permissionsOf, templateId,
} from '../helpers/fixtures'

const TODAY = '2026-10-06'
const NOW = new Date('2026-10-06T06:00:00Z')

describe('group read access', () => {
  let db: Db
  let a: number
  let b: number
  let c: number

  beforeEach(() => {
    db = createTestDb()
    a = addGroup(db, 1, 'Bären')
    b = addGroup(db, 1, 'Mäuse')
    c = addGroup(db, 1, 'Füchse')
  })

  it('is empty by default', () => {
    expect(getReadAccess(db, 1, a)).toEqual([])
  })

  it('stores one direction only and replaces the earlier list', () => {
    setReadAccess(db, 1, a, [b])
    expect(getReadAccess(db, 1, a)).toEqual([b])
    expect(getReadAccess(db, 1, b)).toEqual([])

    setReadAccess(db, 1, a, [c, b, c])
    expect(getReadAccess(db, 1, a)).toEqual([b, c])
    setReadAccess(db, 1, a, [])
    expect(getReadAccess(db, 1, a)).toEqual([])
  })

  it('ignores the group itself', () => {
    setReadAccess(db, 1, a, [a, b])
    expect(getReadAccess(db, 1, a)).toEqual([b])
    expect(db.select().from(groupReadAccess).all()).toEqual([{ groupId: a, readableGroupId: b }])
  })

  it('refuses a group of another facility on either side', () => {
    const krippe = addFacility(db, 'Krippe')
    const foreign = addGroup(db, krippe, 'Igel')
    expect(errorCode(() => setReadAccess(db, 1, a, [foreign]))).toBe('group_not_found')
    expect(errorCode(() => setReadAccess(db, 1, foreign, [a]))).toBe('group_not_found')
    expect(errorCode(() => setReadAccess(db, 1, 9999, []))).toBe('group_not_found')
    expect(errorCode(() => getReadAccess(db, 1, foreign))).toBe('group_not_found')
    // A refused list changes nothing.
    setReadAccess(db, 1, a, [b])
    expect(errorCode(() => setReadAccess(db, 1, a, [c, foreign]))).toBe('group_not_found')
    expect(getReadAccess(db, 1, a)).toEqual([b])
  })

  it('lists every group of the facility with its grants', () => {
    const krippe = addFacility(db, 'Krippe')
    const igel = addGroup(db, krippe, 'Igel')
    const hasen = addGroup(db, krippe, 'Hasen')
    setReadAccess(db, 1, a, [c, b])
    setReadAccess(db, krippe, igel, [hasen])
    expect(listReadAccess(db, 1)).toEqual({ [a]: [b, c], [b]: [], [c]: [] })
    expect(listReadAccess(db, krippe)).toEqual({ [igel]: [hasen], [hasen]: [] })
    expect(listReadAccess(db, addFacility(db, 'Hort'))).toEqual({})
  })

  it('lets the Leitung set read access only in her active facility, the Träger in the group\'s own', () => {
    const krippe = addFacility(db, 'Krippe')
    const igel = addGroup(db, krippe, 'Igel')
    const hasen = addGroup(db, krippe, 'Hasen')
    const leitung = { permissions: permissionsOf('admin'), facilityId: 1 }
    const traeger = { permissions: permissionsOf('provider'), facilityId: 1 }
    // The Leitung of facility 1 names a Krippe group: refused, nothing stored.
    expect(errorCode(() => setReadAccess(db, readAccessFacility(db, leitung, igel), igel, [hasen]))).toBe('group_not_found')
    expect(errorCode(() => getReadAccess(db, readAccessFacility(db, leitung, igel), igel))).toBe('group_not_found')
    expect(listReadAccess(db, krippe)).toEqual({ [igel]: [], [hasen]: [] })
    // In her own facility it works.
    setReadAccess(db, readAccessFacility(db, leitung, a), a, [b])
    expect(getReadAccess(db, 1, a)).toEqual([b])
    // The Träger (active facility 1) sets it for the Krippe group, but never across facilities.
    setReadAccess(db, readAccessFacility(db, traeger, igel), igel, [hasen])
    expect(getReadAccess(db, krippe, igel)).toEqual([hasen])
    expect(errorCode(() => setReadAccess(db, readAccessFacility(db, traeger, igel), igel, [a]))).toBe('group_not_found')
    expect(errorCode(() => readAccessFacility(db, traeger, 9999))).toBe('group_not_found')
  })

  it('goes with either group when it is deleted', () => {
    setReadAccess(db, 1, a, [b, c])
    setReadAccess(db, 1, b, [a])
    deleteGroup(db, 1, c, TODAY)
    expect(getReadAccess(db, 1, a)).toEqual([b])
    deleteGroup(db, 1, a, TODAY)
    expect(getReadAccess(db, 1, b)).toEqual([])
    expect(db.select().from(groupReadAccess).all()).toEqual([])
  })

  describe('on the child viewer', () => {
    let tablet: SessionUser
    let anna: number
    const unlock = (employeeId: number, pin = '123456') =>
      unlockChildren(db, { id: tablet.id, facilityId: 1 }, employeeId, pin, NOW).token
    const viewerOf = (employeeId: number) => resolveChildViewer(db, tablet, unlock(employeeId), NOW)

    beforeEach(() => {
      setTimeTrackingFrom(db, 1, '2026-10-01')
      tablet = addUser(db, 'tablet', 'terminal')
      anna = addEmployee(db, 'Anna', { groupId: a })
      setPin(db, 1, anna, '123456')
    })

    it('gives a person with a group the own group and the granted ones', () => {
      expect(viewerOf(anna).groups).toEqual({ own: a, readable: [] })
      setReadAccess(db, 1, a, [b])
      expect(viewerOf(anna).groups).toEqual({ own: a, readable: [b] })
      // Also with a Mitarbeiter account of their own.
      addUser(db, 'anna', 'observer', anna)
      expect(viewerOf(anna)).toMatchObject({ role: 'observer', groups: { own: a, readable: [b] } })
    })

    it('applies a changed grant with the next request of the unlocked tablet', () => {
      setReadAccess(db, 1, a, [b])
      const token = unlock(anna)
      expect(resolveChildViewer(db, tablet, token, NOW).groups).toEqual({ own: a, readable: [b] })
      setReadAccess(db, 1, a, [])
      expect(resolveChildViewer(db, tablet, token, NOW).groups).toEqual({ own: a, readable: [] })
      // A change of the person's group too.
      db.update(employees).set({ groupId: c }).where(eq(employees.id, anna)).run()
      expect(resolveChildViewer(db, tablet, token, NOW).groups).toEqual({ own: c, readable: [] })
    })

    it('gives a person without group every group', () => {
      const berta = addEmployee(db, 'Berta')
      setPin(db, 1, berta, '123456')
      expect(viewerOf(berta).groups).toBeNull()
    })

    it('gives a Leitung with a group of her own every group, at the tablet and in the office', () => {
      setReadAccess(db, 1, a, [b])
      const leitung = addUser(db, 'leitung', 'admin', anna)
      expect(viewerOf(anna)).toMatchObject({ role: 'admin', groups: null })
      expect(resolveChildViewer(db, leitung, undefined, NOW).groups).toBeNull()
      expect(resolveChildViewer(db, addUser(db, 'traeger', 'provider'), undefined, NOW).groups).toBeNull()
    })

    it('gives a helper every group of the facility they help out in', () => {
      const krippe = addFacility(db, 'Krippe')
      setReadAccess(db, 1, a, [b])
      const leitung = addUser(db, 'leitung-krippe', 'admin', null, krippe)
      const helperTablet = addUser(db, 'tablet-krippe', 'terminal', null, krippe)
      addHelpOut(db, anna, krippe, 2026, 10)
      applyToCells(db, leitung, krippe, [{ employeeId: anna, date: TODAY }], 'replace', { kind: 'shift', templateId: templateId(db, 'M', krippe) })
      const { token } = unlockChildren(db, { id: helperTablet.id, facilityId: krippe }, anna, '123456', NOW)
      expect(resolveChildViewer(db, helperTablet, token, NOW)).toMatchObject({ facilityId: krippe, groups: null })
    })

    it('leaves the office test viewer without group access', () => {
      expect(asChildViewer(addUser(db, 'leitung-buero', 'admin')).groups).toBeNull()
    })
  })
})
