import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { accountRedirect } from '../../app/utils/routeAccess'
import { navMenu } from '../../app/utils/navMenu'
import type { Db } from '../../server/db/client'
import { children, userBundleOverrides, users } from '../../server/db/schema'
import { asChildEditor, type ChildActor, type ChildViewer } from '../../server/lib/childViewer'
import { ServiceError } from '../../server/lib/errors'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { getActiveUser, login } from '../../server/services/auth'
import { createChild, getChild, listPlanned, updateChildMaster } from '../../server/services/children'
import { setReadAccess } from '../../server/services/groupReadAccess'
import { saveBundleOverride } from '../../server/services/permissions'
import {
  getRights, getUserRights, resetRoleRights, rightsRole, saveRoleRights, saveUserRights,
} from '../../server/services/rights'
import { setTabletSettings } from '../../server/services/tabletSettings'
import { resolveChildViewer, unlockChildren } from '../../server/services/tabletUnlock'
import { setPin } from '../../server/services/terminal'
import { assertPinManageable, createUser, listUsers, resetPassword, updateUser } from '../../server/services/users'
import {
  BUNDLE_DEFAULTS, DEFAULT_SCOPE, RIGHTS_ROLES, effectivePermissions, effectiveRights,
} from '../../shared/domain/permissionBundles'
import { ROLE_DEFAULTS } from '../../shared/domain/permissions'
import { accountLock, isManager, manageableRoles } from '../../shared/domain/roles'
import type { SessionUser } from '../../shared/types/api'
import {
  addChild, addEmployee, addFacility, addGroup, addUser, asChildViewer, createTestDb, errorCode, refreshPermissions,
} from '../helpers/fixtures'

/**
 * Rechte und Rollen Teil 3: the role Gruppenleitung (`group_lead`). RF1 its defaults (Mitarbeiter plus „eintragen und
 * Akten ändern“ for the own group, with the own account), RF3 who manages its accounts, RF4 the other roles unchanged.
 */

const TODAY = '2026-10-06'
const NOW = new Date('2026-10-06T06:00:00Z')
const sorted = (keys: Iterable<string>) => [...keys].sort()

function failure(fn: () => unknown): string | null {
  try {
    fn()
    return null
  }
  catch (error) {
    if (error instanceof ServiceError) return `${error.statusCode} ${error.code}`
    throw error
  }
}

describe('RF1: the Grundeinstellung of the Gruppenleitung', () => {
  it('is the Mitarbeiter defaults plus „eintragen und Akten ändern“ (own group) and the own account', () => {
    expect(RIGHTS_ROLES).toEqual(['admin', 'group_lead', 'observer'])
    expect(sorted(BUNDLE_DEFAULTS.group_lead)).toEqual(sorted([...BUNDLE_DEFAULTS.observer, 'childrenEdit', 'childrenOwnAccount']))
    expect(DEFAULT_SCOPE.group_lead).toBe('group')
    expect(sorted(effectivePermissions({ role: 'group_lead' })))
      .toEqual(sorted([...ROLE_DEFAULTS.observer, 'children.edit', 'children.ownAccount']))
    const rights = effectiveRights({ role: 'group_lead' })
    expect(Object.fromEntries(rights.scopes)).toEqual({
      'children.view': 'group', 'children.attendance': 'group', 'children.edit': 'group',
    })
  })

  it('shows „Kinder“ in the menu and opens the child pages, but no office page', () => {
    const permissions = effectivePermissions({ role: 'group_lead' })
    const can = (key: Parameters<typeof permissions.has>[0]) => permissions.has(key)
    const menu = navMenu({
      role: 'group_lead', can, employeeId: 7, isPlanner: false, openCount: 0, unread: 0, today: { year: 2026, month: 10 },
    })
    expect([...menu.main, ...menu.more, ...menu.mine].map(entry => entry.label)).toContain('Kinder')
    for (const path of ['/children', '/children/1', '/children/new']) {
      expect(accountRedirect(path, { mustChangePassword: false, can }), path).toBeUndefined()
    }
    for (const path of ['/admin/employees', '/admin/time', '/admin/users', '/admin/rights', '/cash', '/admin/settings']) {
      expect(accountRedirect(path, { mustChangePassword: false, can }), path).toBe('/')
    }
  })

  it('is no manager and manages no account but the tablet', () => {
    expect(isManager('group_lead')).toBe(false)
    expect(manageableRoles('group_lead', () => false)).toEqual(['terminal'])
  })
})

describe('RF1: a Gruppenleitung works with the children of the own group', () => {
  let db: Db
  let tablet: SessionUser
  let lead: SessionUser
  let leadEmployee: number
  let admin: ChildActor
  let a: number
  let b: number
  let c: number
  let kidA: number
  let kidB: number
  let kidC: number

  const recordOf = (id: number) => getChild(db, admin, id, TODAY)
  // Through the route guard's check (requireChildPermission(event, 'children.edit')), then the service's group rights.
  const save = (viewer: ChildViewer, id: number) =>
    updateChildMaster(db, asChildEditor(viewer), 1, id, recordOf(id).master, TODAY, NOW)
  const create = (viewer: ChildViewer, groupId: number) =>
    createChild(db, asChildEditor(viewer), 1, { ...recordOf(kidA).master, lastName: 'Neu', groupId }, NOW)
  /** The account as its next request loads it (permissions and scopes). */
  const fresh = () => getActiveUser(db, lead.id, TODAY)!

  beforeEach(() => {
    db = createTestDb()
    a = addGroup(db, 1, 'Bären')
    b = addGroup(db, 1, 'Mäuse')
    c = addGroup(db, 1, 'Füchse')
    setTimeTrackingFrom(db, 1, '2026-10-01')
    setTabletSettings(db, 1, { lockMinutes: 10, showWaitlist: true, showFutureContracts: true })
    tablet = addUser(db, 'tablet', 'terminal')
    admin = asChildViewer(addUser(db, 'leitung', 'admin'))
    leadEmployee = addEmployee(db, 'Gabi', { groupId: a })
    setPin(db, 1, leadEmployee, '123456')
    lead = addUser(db, 'gabi', 'group_lead', leadEmployee)
    setReadAccess(db, 1, a, [b])
    kidA = addChild(db, 1, { lastName: 'Amsel', groupId: a })
    kidB = addChild(db, 1, { lastName: 'Biber', groupId: b })
    kidC = addChild(db, 1, { lastName: 'Chamäleon', groupId: c })
  })

  it('belongs to the facility of its employee', () => {
    expect(lead.facilityId).toBe(1)
    expect(db.select({ facilityId: users.facilityId }).from(users).where(eq(users.id, lead.id)).get()!.facilityId).toBeNull()
  })

  it('edits and creates children of the own group with the own account, not those of other groups', () => {
    const office = resolveChildViewer(db, lead, undefined, NOW)
    expect(office.onTablet).toBe(false)
    save(office, kidA)
    expect(failure(() => save(office, kidB))).toBe('403 group_read_only')
    expect(failure(() => save(office, kidC))).toBe('404 child_not_found')
    const id = create(office, a)
    expect(db.select({ groupId: children.groupId }).from(children).where(eq(children.id, id)).get()!.groupId).toBe(a)
    expect(failure(() => create(office, b))).toBe('403 group_read_only')
    expect(failure(() => create(office, c))).toBe('404 group_not_found')
  })

  it('does the same at the tablet', () => {
    const { token } = unlockChildren(db, { id: tablet.id, facilityId: 1 }, leadEmployee, '123456', NOW)
    const viewer = resolveChildViewer(db, tablet, token, NOW)
    expect(viewer.onTablet).toBe(true)
    expect(viewer.id).toBe(lead.id)
    save(viewer, kidA)
    expect(failure(() => save(viewer, kidB))).toBe('403 group_read_only')
    expect(failure(() => save(viewer, kidC))).toBe('404 child_not_found')
  })

  it('follows the role settings the Träger changes, and its exceptions', () => {
    saveRoleRights(db, 'group_lead', [{ id: 'childrenEdit', enabled: false }])
    expect(failure(() => save(resolveChildViewer(db, fresh(), undefined, NOW), kidA))).toBe('403 forbidden')
    saveBundleOverride(db, lead.id, 'childrenEdit', 'grant', 'facility')
    // „eintragen“ for the whole facility writes in every group it sees (the read-access group too).
    const again = resolveChildViewer(db, fresh(), undefined, NOW)
    save(again, kidA)
    save(again, kidB)
  })

  it('sees the planned children with the own account only as the tablet switches allow, unless given „verwalten“', () => {
    const wish = addChild(db, 1, { lastName: 'Gans', groupId: a, entryDate: null, admissionStatus: 'waitlist', waitlistedOn: '2026-09-01' })
    const office = () => resolveChildViewer(db, fresh(), undefined, NOW)
    expect(office().visibility).toEqual({ waitlist: true, futureContracts: true })
    expect(listPlanned(db, office(), TODAY).waitlist.map(item => item.id)).toEqual([wish])
    setTabletSettings(db, 1, { lockMinutes: 10, showWaitlist: false, showFutureContracts: true })
    expect(listPlanned(db, office(), TODAY).waitlist).toEqual([])
    expect(failure(() => getChild(db, office(), wish, TODAY))).toBe('404 child_not_found')
    // The Leitung (children.planned) as before.
    expect(resolveChildViewer(db, addUser(db, 'leitung2', 'admin'), undefined, NOW).visibility).toBeNull()
    saveBundleOverride(db, lead.id, 'childrenManage', 'grant')
    expect(office().visibility).toBeNull()
    expect(getChild(db, office(), wish, TODAY).id).toBe(wish)
  })

  it('keeps a Mitarbeiter of the same group to the tablet (unchanged)', () => {
    const anna = addUser(db, 'anna', 'observer', addEmployee(db, 'Anna', { groupId: a }))
    expect(failure(() => resolveChildViewer(db, anna, undefined, NOW))).toBe('403 children_tablet_only')
  })

  it('cannot sign in after the employee has left', () => {
    createUser(db, addUser(db, 'traeger', 'provider'), { username: 'gabi2', password: 'start-1234', role: 'group_lead', employeeId: addEmployee(db, 'Gabi2', { leftOn: '2026-09-30' }) })
    expect(login(db, 'gabi2', 'start-1234', NOW)).toMatchObject({ ok: false })
    expect(getActiveUser(db, lead.id)).not.toBeNull()
  })
})

describe('RF3: who manages Gruppenleitung accounts', () => {
  let db: Db
  let provider: SessionUser
  let leitung: SessionUser
  let gabi: number
  let anna: number

  beforeEach(() => {
    db = createTestDb()
    provider = addUser(db, 'traeger', 'provider')
    leitung = addUser(db, 'leitung', 'admin', addEmployee(db, 'Lea'))
    gabi = addEmployee(db, 'Gabi')
    anna = addEmployee(db, 'Anna')
  })

  it('lets the Leitung create, list, change, reset, deactivate and give a PIN to a Gruppenleitung of its facility', () => {
    expect(manageableRoles('admin', key => key === 'users.manage')).toEqual(['admin', 'group_lead', 'observer', 'terminal'])
    const account = createUser(db, leitung, { username: 'gabi', password: 'start-1234', role: 'group_lead', employeeId: gabi })
    expect(account).toMatchObject({ role: 'group_lead', employeeId: gabi, employeeName: 'Gabi', mustChangePassword: true })
    expect(listUsers(db, leitung).map(user => user.username)).toContain('gabi')
    resetPassword(db, leitung, account.id, 'reset-1234')
    expect(updateUser(db, leitung, account.id, { role: 'group_lead', employeeId: gabi, active: false }).active).toBe(false)
    expect(() => assertPinManageable(db, leitung, 1, gabi)).not.toThrow()
    // Linked to an employee like a Mitarbeiter.
    expect(errorCode(() => createUser(db, leitung, { username: 'x', password: 'start-1234', role: 'group_lead', employeeId: null })))
      .toBe('employee_required')
  })

  it('lets the Leitung switch an account between Mitarbeiter and Gruppenleitung', () => {
    const account = createUser(db, leitung, { username: 'anna', password: 'start-1234', role: 'observer', employeeId: anna })
    expect(updateUser(db, leitung, account.id, { role: 'group_lead', employeeId: anna, active: true }).role).toBe('group_lead')
    expect(db.select({ facilityId: users.facilityId }).from(users).where(eq(users.id, account.id)).get()!.facilityId).toBeNull()
    expect(updateUser(db, leitung, account.id, { role: 'observer', employeeId: anna, active: true }).role).toBe('observer')
  })

  it('drops the Mitarbeiter grant of „eintragen“ for the own group on becoming Gruppenleitung, keeps the rest', () => {
    const overrides = (userId: number) => db.select({ bundle: userBundleOverrides.bundle, effect: userBundleOverrides.effect, scope: userBundleOverrides.scope })
      .from(userBundleOverrides).where(eq(userBundleOverrides.userId, userId)).all()
      .sort((x, y) => x.bundle.localeCompare(y.bundle))
    const account = createUser(db, leitung, { username: 'anna', password: 'start-1234', role: 'observer', employeeId: anna })
    saveUserRights(db, leitung, account.id, [{ bundle: 'childrenEdit', effect: 'grant', scope: 'group' }])
    saveBundleOverride(db, account.id, 'calendarView', 'revoke')
    updateUser(db, leitung, account.id, { role: 'group_lead', employeeId: anna, active: true })
    expect(overrides(account.id)).toEqual([{ bundle: 'calendarView', effect: 'revoke', scope: null }])
    // Once the Träger turns the column's switch off, nothing unseen gives it back.
    saveRoleRights(db, 'group_lead', [{ id: 'childrenEdit', enabled: false }])
    expect(getActiveUser(db, account.id)!.permissions.has('children.edit')).toBe(false)
    // A revoke and a grant for the whole facility (the Träger's, visible to it) stay.
    const other = createUser(db, provider, { username: 'gabi', password: 'start-1234', role: 'observer', employeeId: gabi })
    saveBundleOverride(db, other.id, 'childrenEdit', 'grant', 'facility')
    updateUser(db, provider, other.id, { role: 'group_lead', employeeId: gabi, active: true })
    expect(overrides(other.id)).toEqual([{ bundle: 'childrenEdit', effect: 'grant', scope: 'facility' }])
    saveBundleOverride(db, other.id, 'childrenEdit', 'revoke')
    updateUser(db, provider, other.id, { role: 'observer', employeeId: gabi, active: true })
    updateUser(db, provider, other.id, { role: 'group_lead', employeeId: gabi, active: true })
    expect(overrides(other.id)).toEqual([{ bundle: 'childrenEdit', effect: 'revoke', scope: null }])
  })

  it('hides a Gruppenleitung of another facility from the Leitung', () => {
    const other = addFacility(db, 'Zweite')
    const far = addEmployee(db, 'Fern', { facilityId: other })
    const account = addUser(db, 'fern', 'group_lead', far)
    expect(account.facilityId).toBe(other)
    expect(listUsers(db, leitung).map(user => user.username)).not.toContain('fern')
    expect(errorCode(() => resetPassword(db, leitung, account.id, 'reset-1234'))).toBe('user_not_found')
  })

  it('leaves the rights of a Gruppenleitung to the Träger: the Leitung sees and changes none of them', () => {
    const account = createUser(db, leitung, { username: 'gabi', password: 'start-1234', role: 'group_lead', employeeId: gabi })
    expect(failure(() => getUserRights(db, leitung, account.id))).toBe('403 forbidden')
    expect(failure(() => saveUserRights(db, leitung, account.id, [{ bundle: 'childrenEdit', effect: 'revoke' }])))
      .toBe('403 forbidden')
    const rights = saveUserRights(db, provider, account.id, [{ bundle: 'childrenEdit', effect: 'revoke' }])
    expect(rights.role).toBe('group_lead')
    expect(rights.bundles.find(bundle => bundle.id === 'childrenEdit')!.effective.enabled).toBe(false)
  })

  it('never lets a Gruppenleitung manage Leitung, Mitarbeiter, Gruppenleitung or Träger accounts, nor raise itself', () => {
    const own = addUser(db, 'gabi', 'group_lead', gabi)
    saveBundleOverride(db, own.id, 'usersManage', 'grant')
    const lead = refreshPermissions(db, own)
    expect(lead.permissions.has('users.manage')).toBe(true)
    const anna2 = createUser(db, leitung, { username: 'anna', password: 'start-1234', role: 'observer', employeeId: anna })
    for (const role of ['provider', 'admin', 'group_lead', 'observer'] as const) {
      expect(errorCode(() => createUser(db, lead, { username: `neu-${role}`, password: 'start-1234', role, employeeId: null })), role)
        .toMatch(/provider_only|role_not_manageable/)
    }
    expect(errorCode(() => updateUser(db, lead, own.id, { role: 'admin', employeeId: gabi, active: true }))).toBe('own_account')
    expect(errorCode(() => updateUser(db, lead, anna2.id, { role: 'group_lead', employeeId: anna, active: true }))).toBe('role_not_manageable')
    expect(errorCode(() => resetPassword(db, lead, leitung.id, 'reset-1234'))).toBe('role_not_manageable')
    expect(errorCode(() => assertPinManageable(db, lead, 1, anna))).toBe('pin_managers_only')
    expect(failure(() => saveUserRights(db, lead, anna2.id, [{ bundle: 'childrenEdit', effect: 'grant', scope: 'group' }])))
      .toBe('403 forbidden')
    // The tablet it may manage.
    expect(createUser(db, lead, { username: 'tablet', password: 'start-1234', role: 'terminal', employeeId: null }).role).toBe('terminal')
    const manage = (key: string) => lead.permissions.has(key as never)
    expect(accountLock(lead, manage, { id: own.id, role: 'group_lead' })).toBe('own')
    expect(accountLock(lead, manage, { id: anna2.id, role: 'observer' })).toBe('role')
    expect(accountLock(leitung, key => leitung.permissions.has(key), { id: own.id, role: 'group_lead' })).toBeNull()
  })

  it('lets the Träger set and reset the Gruppenleitung column of the rights page', () => {
    expect(getRights(db).roles.map(role => role.role)).toEqual(['admin', 'group_lead', 'observer'])
    expect(rightsRole('group_lead')).toBe('group_lead')
    const saved = saveRoleRights(db, 'group_lead', [{ id: 'cashBook', enabled: true }])
    expect(saved.isDefault).toBe(false)
    expect(saved.bundles.find(bundle => bundle.id === 'childrenEdit')).toMatchObject({ enabled: true, defaultEnabled: true, scope: 'group' })
    const account = addUser(db, 'gabi', 'group_lead', gabi)
    expect(account.permissions.has('cash.book')).toBe(true)
    expect(resetRoleRights(db, 'group_lead').isDefault).toBe(true)
    expect(refreshPermissions(db, account).permissions.has('cash.book')).toBe(false)
  })
})

describe('RF4: Leitung and Mitarbeiter unchanged', () => {
  it('keeps their defaults and their management rules', () => {
    expect(sorted(effectivePermissions({ role: 'admin' }))).toEqual(sorted([...ROLE_DEFAULTS.admin, 'cash.reopen']))
    expect(sorted(effectivePermissions({ role: 'observer' }))).toEqual(sorted(ROLE_DEFAULTS.observer))
    expect(manageableRoles('observer', key => key === 'users.manage')).toEqual(['terminal'])
    expect(manageableRoles('provider', () => true)).toEqual(['provider', 'admin', 'group_lead', 'observer', 'terminal'])
  })

  it('a change of the Gruppenleitung column leaves the Mitarbeiter alone', () => {
    const db = createTestDb()
    const anna = addUser(db, 'anna', 'observer', addEmployee(db, 'Anna'))
    saveRoleRights(db, 'group_lead', [{ id: 'cashBook', enabled: true }])
    expect(refreshPermissions(db, anna).permissions.has('cash.book')).toBe(false)
    expect(getRights(db).roles.find(role => role.role === 'observer')!.isDefault).toBe(true)
  })
})
