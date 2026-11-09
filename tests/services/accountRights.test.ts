import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { roleBundles, userBundleOverrides } from '../../server/db/schema'
import {
  accountPermissions, accountRights, rolePermissions, saveBundleOverride, saveRoleBundle,
} from '../../server/services/permissions'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addUser, createTestDb } from '../helpers/fixtures'

/** server/services/permissions.ts: the rights of an account from the stored role settings and exceptions (RF2). */
let db: Db
let leitung: SessionUser
let anna: SessionUser
let berta: SessionUser

beforeEach(() => {
  db = createTestDb()
  leitung = addUser(db, 'leitung', 'admin')
  anna = addUser(db, 'anna', 'observer', addEmployee(db, 'Anna'))
  berta = addUser(db, 'berta', 'observer', addEmployee(db, 'Berta'))
})

describe('accountRights', () => {
  it('applies a role setting to every account of the role, an exception only to its account', () => {
    saveRoleBundle(db, 'observer', 'calendarEdit', true)
    expect(accountPermissions(db, anna).has('calendar.edit')).toBe(true)
    expect(accountPermissions(db, berta).has('calendar.edit')).toBe(true)
    expect(accountPermissions(db, leitung).has('calendar.edit')).toBe(true)
    saveBundleOverride(db, anna.id, 'calendarEdit', 'revoke')
    expect(accountPermissions(db, anna).has('calendar.edit')).toBe(false)
    expect(accountPermissions(db, berta).has('calendar.edit')).toBe(true)
    saveBundleOverride(db, anna.id, 'calendarEdit', null)
    expect(accountPermissions(db, anna).has('calendar.edit')).toBe(true)
    saveRoleBundle(db, 'observer', 'calendarEdit', false)
    expect(accountPermissions(db, anna).has('calendar.edit')).toBe(false)
  })

  it('keeps the scope of role settings and exceptions', () => {
    expect(accountRights(db, anna).scopes.get('children.view')).toBe('group')
    expect(accountRights(db, leitung).scopes.get('children.view')).toBe('facility')
    saveRoleBundle(db, 'observer', 'childrenView', true, 'facility')
    expect(accountRights(db, anna).scopes.get('children.view')).toBe('facility')
    saveBundleOverride(db, berta.id, 'childrenEdit', 'grant', 'group')
    expect(accountRights(db, berta).scopes.get('children.edit')).toBe('group')
    expect(accountRights(db, anna).permissions.has('children.edit')).toBe(false)
  })

  it('ignores unknown bundles in the database', () => {
    db.insert(roleBundles).values({ role: 'observer', bundle: 'rights.manage', enabled: true, scope: null }).run()
    db.insert(userBundleOverrides).values({ userId: anna.id, bundle: 'settingsStaffing', effect: 'grant', scope: null }).run()
    expect([...accountPermissions(db, anna)].sort()).toEqual([...accountPermissions(db, berta)].sort())
    expect(accountPermissions(db, anna).has('rights.manage')).toBe(false)
  })

  it('lets a Leitung plan leave only in its own facility', () => {
    const other = addFacility(db, 'Zweite Kita')
    saveBundleOverride(db, leitung.id, 'leavePlan', 'grant')
    expect(accountPermissions(db, leitung).has('leave.plan')).toBe(true)
    expect(accountPermissions(db, leitung, 1).has('leave.plan')).toBe(true)
    expect(accountPermissions(db, leitung, other).has('leave.plan')).toBe(false)
    expect(accountPermissions(db, leitung, null).has('leave.plan')).toBe(false)
    // Only leave planning depends on the facility.
    expect(accountPermissions(db, leitung, other).has('cash.view')).toBe(true)
  })

  it('reads the role settings for rolePermissions, without exceptions', () => {
    saveBundleOverride(db, leitung.id, 'contractView', 'grant')
    expect(rolePermissions(db, 'admin').has('employees.contractView')).toBe(false)
    saveRoleBundle(db, 'admin', 'contractView', true)
    expect(rolePermissions(db, 'admin').has('employees.contractView')).toBe(true)
    expect(rolePermissions(db, 'provider').size).toBe(67)
  })

  it('stores one row per role and bundle and per account and bundle', () => {
    saveRoleBundle(db, 'admin', 'cashClose', false)
    saveRoleBundle(db, 'admin', 'cashClose', true)
    saveBundleOverride(db, anna.id, 'childrenEdit', 'grant', 'group')
    saveBundleOverride(db, anna.id, 'childrenEdit', 'revoke')
    expect(db.select().from(roleBundles).all()).toEqual([{ role: 'admin', bundle: 'cashClose', enabled: true, scope: null }])
    expect(db.select().from(userBundleOverrides).all())
      .toEqual([{ userId: anna.id, bundle: 'childrenEdit', effect: 'revoke', scope: null }])
  })
})
