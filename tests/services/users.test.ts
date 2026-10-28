import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { balanceAdjustments, employeeHours, employees, leaveEntitlements, users } from '../../server/db/schema'
import { rolePermissions } from '../../server/services/permissions'
import type { Db } from '../../server/db/client'
import { getActiveUser, login } from '../../server/services/auth'
import {
  addAdjustment, addHours, deleteAdjustment, deleteHours, listEmployees, moveEmployeeToFacility, setAdjustmentPaidOut,
  setEntitlement, setStampingOptions, updateEmployee,
} from '../../server/services/employees'
import { assertPinManageable, createUser, listUsers, resetPassword, updateUser } from '../../server/services/users'
import { saveUserRights } from '../../server/services/rights'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addGroup, addUser, createTestDb, errorCode } from '../helpers/fixtures'

describe('users service', () => {
  let db: Db
  let anna: number
  let provider: SessionUser
  beforeEach(() => {
    db = createTestDb()
    anna = addEmployee(db, 'Anna')
    provider = addUser(db, 'traeger', 'provider')
  })

  it('creates an observer linked to an employee who must change the password', () => {
    const user = createUser(db, provider, { username: 'anna', password: 'start-1234', role: 'observer', employeeId: anna })
    expect(user).toMatchObject({ username: 'anna', role: 'observer', employeeId: anna, employeeName: 'Anna', mustChangePassword: true, active: true })
    expect(listUsers(db, provider)).toHaveLength(2) // with the Träger
  })
  it('stores usernames in lower case so login ignores capitalisation', () => {
    const user = createUser(db, provider, { username: '  Anna ', password: 'start-1234', role: 'observer', employeeId: anna })
    expect(user.username).toBe('anna')
    expect(login(db, 'ANNA', 'start-1234')).toMatchObject({ ok: true, user: { username: 'anna' } })
    expect(errorCode(() => createUser(db, provider, { username: 'ANNA', password: 'start-1234', role: 'admin', employeeId: null }))).toBe('username_taken')
  })
  it('validates new users', () => {
    createUser(db, provider, { username: 'anna', password: 'start-1234', role: 'observer', employeeId: anna })
    expect(errorCode(() => createUser(db, provider, { username: 'anna', password: 'start-1234', role: 'admin', employeeId: null }))).toBe('username_taken')
    expect(errorCode(() => createUser(db, provider, { username: 'x', password: 'start-1234', role: 'observer', employeeId: null }))).toBe('employee_required')
    expect(errorCode(() => createUser(db, provider, { username: 'y', password: 'start-1234', role: 'observer', employeeId: anna }))).toBe('employee_taken')
    expect(errorCode(() => createUser(db, provider, { username: 'z', password: 'kurz', role: 'admin', employeeId: null }))).toBe('password_too_short')
    expect(errorCode(() => createUser(db, provider, { username: '  ', password: 'start-1234', role: 'admin', employeeId: null }))).toBe('username_required')
  })
  it('never removes the last active Träger', () => {
    expect(errorCode(() => updateUser(db, provider, provider.id, { role: 'admin', employeeId: null, active: true }))).toBe('last_provider')
    expect(errorCode(() => updateUser(db, provider, provider.id, { role: 'provider', employeeId: null, active: false }))).toBe('last_provider')
    const second = createUser(db, provider, { username: 'traeger2', password: 'start-1234', role: 'provider', employeeId: null })
    expect(updateUser(db, provider, second.id, { role: 'admin', employeeId: null, active: true }).role).toBe('admin')
  })
  it('lets only a Träger appoint, change or reset Träger accounts', () => {
    const leitung = addUser(db, 'leitung', 'admin')
    const anna2 = createUser(db, leitung, { username: 'anna', password: 'start-1234', role: 'observer', employeeId: anna })
    expect(errorCode(() => createUser(db, leitung, { username: 'neu', password: 'start-1234', role: 'provider', employeeId: null }))).toBe('provider_only')
    // Not even the own account: only the Träger changes that.
    expect(errorCode(() => updateUser(db, leitung, leitung.id, { role: 'provider', employeeId: null, active: true }))).toBe('own_account')
    expect(errorCode(() => updateUser(db, leitung, provider.id, { role: 'provider', employeeId: null, active: false }))).toBe('provider_only')
    expect(errorCode(() => resetPassword(db, leitung, provider.id, 'reset-1234'))).toBe('provider_only')
    // The Leitung keeps managing everyone else.
    expect(updateUser(db, leitung, anna2.id, { role: 'observer', employeeId: anna, active: false }).active).toBe(false)
    resetPassword(db, leitung, anna2.id, 'reset-1234')
    // A Träger may appoint another Träger.
    expect(updateUser(db, provider, leitung.id, { role: 'provider', employeeId: null, active: true }).role).toBe('provider')
  })
  it('resets a password and forces a change', () => {
    const user = addUser(db, 'leitung', 'admin')
    resetPassword(db, provider, user.id, 'reset-1234')
    expect(login(db, 'leitung', 'reset-1234')).toMatchObject({ ok: true, user: { mustChangePassword: true } })
    expect(errorCode(() => resetPassword(db, provider, 999, 'reset-1234'))).toBe('user_not_found')
  })
})

describe('permission to maintain child records', () => {
  let db: Db
  let leitung: SessionUser
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    leitung = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
  })
  const set = (id: number, role: SessionUser['role'], employeeId: number | null) =>
    updateUser(db, leitung, id, { role, employeeId, active: true })
  const allow = (id: number) => saveUserRights(db, leitung, id, [{ bundle: 'childrenEdit', effect: 'grant' }])
  const canEdit = (id: number) => getActiveUser(db, id)!.permissions.has('children.edit')

  it('no longer takes the old switch: 400 use_rights_api, nothing changes', () => {
    const user = createUser(db, leitung, { username: 'anna', password: 'start-1234', role: 'observer', employeeId: anna })
    for (const value of [true, false]) {
      expect(errorCode(() => updateUser(db, leitung, user.id, { role: 'admin', employeeId: null, active: true, canEditChildren: value })))
        .toBe('use_rights_api')
    }
    expect(listUsers(db, leitung).find(candidate => candidate.id === user.id)).toMatchObject({ role: 'observer' })
    expect(canEdit(user.id)).toBe(false)
  })

  it('takes the exception set through the rights API, and saving the account leaves it alone', () => {
    const user = createUser(db, leitung, { username: 'anna', password: 'start-1234', role: 'observer', employeeId: anna })
    expect(user).not.toHaveProperty('canEditChildren')
    allow(user.id)
    expect(canEdit(user.id)).toBe(true)
    set(user.id, 'observer', anna)
    expect(canEdit(user.id)).toBe(true)
    saveUserRights(db, leitung, user.id, [])
    expect(canEdit(user.id)).toBe(false)
  })

  it('keeps the exceptions when the account changes its role (they are the person\'s)', () => {
    const user = createUser(db, leitung, { username: 'anna', password: 'start-1234', role: 'observer', employeeId: anna })
    allow(user.id)
    set(user.id, 'admin', null)
    set(user.id, 'observer', anna)
    expect(canEdit(user.id)).toBe(true)
  })
})

describe('who manages which accounts (no escalation through „Zugänge verwalten“)', () => {
  let db: Db
  let provider: SessionUser
  let leitung: SessionUser
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    provider = addUser(db, 'traeger', 'provider')
    leitung = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
  })

  it('lets a Mitarbeiter with „Zugänge verwalten“ manage the tablet accounts only, never the own one', () => {
    const own = createUser(db, leitung, { username: 'anna', password: 'start-1234', role: 'observer', employeeId: anna })
    saveUserRights(db, provider, own.id, [{ bundle: 'usersManage', effect: 'grant' }])
    const manager = getActiveUser(db, own.id)!
    expect(manager.permissions.has('users.manage')).toBe(true)
    const tablet = createUser(db, manager, { username: 'tablet', password: 'tablet-password', role: 'terminal', employeeId: null })
    expect(updateUser(db, manager, tablet.id, { role: 'terminal', employeeId: null, active: false }).active).toBe(false)
    resetPassword(db, manager, tablet.id, 'tablet-password-2')
    // No Mitarbeiter account: it could reset a colleague's password and sign in with the colleague's rights.
    const benEmployee = addEmployee(db, 'Ben')
    const ben = createUser(db, leitung, { username: 'ben', password: 'start-1234', role: 'observer', employeeId: benEmployee })
    expect(errorCode(() => resetPassword(db, manager, ben.id, 'takeover-1234'))).toBe('role_not_manageable')
    expect(login(db, 'ben', 'takeover-1234').ok).toBe(false)
    expect(errorCode(() => updateUser(db, manager, ben.id, { role: 'observer', employeeId: benEmployee, active: false })))
      .toBe('role_not_manageable')
    expect(errorCode(() => createUser(db, manager, { username: 'carla', password: 'start-1234', role: 'observer', employeeId: addEmployee(db, 'Carla') })))
      .toBe('role_not_manageable')
    expect(errorCode(() => updateUser(db, manager, tablet.id, { role: 'observer', employeeId: benEmployee, active: true })))
      .toBe('role_not_manageable')
    // Never above the own role: no Leitung, no Träger, no promotion, no change of a Leitung account.
    expect(errorCode(() => createUser(db, manager, { username: 'neu', password: 'start-1234', role: 'admin', employeeId: null })))
      .toBe('role_not_manageable')
    expect(errorCode(() => updateUser(db, manager, ben.id, { role: 'admin', employeeId: null, active: true }))).toBe('role_not_manageable')
    expect(errorCode(() => updateUser(db, manager, leitung.id, { role: 'admin', employeeId: null, active: false })))
      .toBe('role_not_manageable')
    expect(errorCode(() => resetPassword(db, manager, leitung.id, 'reset-1234'))).toBe('role_not_manageable')
    expect(errorCode(() => createUser(db, manager, { username: 'boss', password: 'start-1234', role: 'provider', employeeId: null })))
      .toBe('provider_only')
    // And not the own account: no self-promotion.
    expect(errorCode(() => updateUser(db, manager, own.id, { role: 'admin', employeeId: null, active: true }))).toBe('own_account')
    expect(getActiveUser(db, own.id)!.role).toBe('observer')
  })

  it('sets, clears and unlocks PINs only as the Leitung or the Träger, for accounts they manage', () => {
    const benEmployee = addEmployee(db, 'Ben')
    createUser(db, leitung, { username: 'ben', password: 'start-1234', role: 'observer', employeeId: benEmployee })
    const leitungEmployee = addEmployee(db, 'Lea')
    createUser(db, leitung, { username: 'lea', password: 'start-1234', role: 'admin', employeeId: leitungEmployee })
    const traegerEmployee = addEmployee(db, 'Tom')
    updateUser(db, provider, provider.id, { role: 'provider', employeeId: traegerEmployee, active: true })
    const unlinked = addEmployee(db, 'Uwe')
    // A Mitarbeiter the Träger gave „pflegen“: no PIN at all, not even for an employee without account or its own.
    const own = createUser(db, leitung, { username: 'anna', password: 'start-1234', role: 'observer', employeeId: anna })
    saveUserRights(db, provider, own.id, [{ bundle: 'employeesEdit', effect: 'grant' }])
    const editor = getActiveUser(db, own.id)!
    expect(editor.permissions.has('employees.edit')).toBe(true)
    for (const employeeId of [benEmployee, leitungEmployee, traegerEmployee, unlinked, anna]) {
      expect(errorCode(() => assertPinManageable(db, editor, 1, employeeId)), String(employeeId)).toBe('pin_managers_only')
    }
    // The Leitung keeps today's reach (Mitarbeiter, Leitung and unlinked of its facility), but not a Träger's employee.
    expect([benEmployee, leitungEmployee, unlinked].map(id => errorCode(() => assertPinManageable(db, leitung, 1, id)))).toEqual([null, null, null])
    expect(errorCode(() => assertPinManageable(db, leitung, 1, traegerEmployee))).toBe('pin_not_manageable')
    // The Träger every one.
    expect([benEmployee, leitungEmployee, traegerEmployee, unlinked].map(id => errorCode(() => assertPinManageable(db, provider, 1, id))))
      .toEqual([null, null, null, null])
  })

  it('checks the facility first: an employee of another facility is 404 for everyone, nothing is probed', () => {
    const krippe = addFacility(db, 'Krippe')
    const kim = addEmployee(db, 'Kim', { facilityId: krippe })
    const kimLeitung = addUser(db, 'kimleitung', 'admin', null, krippe)
    db.update(users).set({ employeeId: kim }).where(eq(users.id, kimLeitung.id)).run()
    const zoe = addEmployee(db, 'Zoe', { facilityId: krippe })
    const own = createUser(db, leitung, { username: 'anna', password: 'start-1234', role: 'observer', employeeId: anna })
    saveUserRights(db, provider, own.id, [{ bundle: 'employeesEdit', effect: 'grant' }])
    const editor = getActiveUser(db, own.id)!
    for (const actor of [editor, leitung, provider]) {
      for (const employeeId of [kim, zoe]) {
        expect(errorCode(() => assertPinManageable(db, actor, 1, employeeId)), `${actor.username} ${employeeId}`).toBe('employee_not_found')
      }
    }
    // The Träger reaches them in the facility it has selected.
    expect([kim, zoe].map(id => errorCode(() => assertPinManageable(db, provider, krippe, id)))).toEqual([null, null])
  })

  it('lets nobody but the Träger change the own stamping settings (403 own_account)', () => {
    const options = { stampVia: 'tablet', breakMode: 'auto' } as const
    const own = createUser(db, leitung, { username: 'anna', password: 'start-1234', role: 'observer', employeeId: anna })
    saveUserRights(db, provider, own.id, [{ bundle: 'employeesEdit', effect: 'grant' }])
    const editor = getActiveUser(db, own.id)!
    expect(errorCode(() => setStampingOptions(db, 1, anna, options, editor.permissions, editor.employeeId))).toBe('own_account')
    // A Leitung on its own record as well.
    const leaEmployee = addEmployee(db, 'Lea')
    const lea = createUser(db, leitung, { username: 'lea', password: 'start-1234', role: 'admin', employeeId: leaEmployee })
    const leaSession = getActiveUser(db, lea.id)!
    expect(errorCode(() => setStampingOptions(db, 1, leaEmployee, options, leaSession.permissions, leaSession.employeeId))).toBe('own_account')
    // Another employee's settings as today, and the Träger its own.
    expect(errorCode(() => setStampingOptions(db, 1, leaEmployee, options, editor.permissions, editor.employeeId))).toBeNull()
    expect(errorCode(() => setStampingOptions(db, 1, anna, options, leaSession.permissions, leaSession.employeeId))).toBeNull()
    const traegerEmployee = addEmployee(db, 'Tom')
    updateUser(db, provider, provider.id, { role: 'provider', employeeId: traegerEmployee, active: true })
    const traeger = getActiveUser(db, provider.id)!
    expect(errorCode(() => setStampingOptions(db, 1, traegerEmployee, options, traeger.permissions, traeger.employeeId))).toBeNull()
    expect(db.select().from(employees).where(eq(employees.id, anna)).get()).toMatchObject({ stampVia: 'tablet', breakMode: 'auto' })
  })

  it('lets nobody but the Träger move the own employee record to another group (403 own_account)', () => {
    const mice = addGroup(db, 1, 'Mäuse')
    const bears = addGroup(db, 1, 'Bären')
    const record = { name: 'Anna', shortName: 'An', leftOn: null }
    updateEmployee(db, 1, anna, { ...record, groupId: mice })
    const own = createUser(db, leitung, { username: 'anna', password: 'start-1234', role: 'observer', employeeId: anna })
    saveUserRights(db, provider, own.id, [{ bundle: 'employeesEdit', effect: 'grant' }])
    const editor = getActiveUser(db, own.id)!
    const save = (actor: SessionUser, groupId: number) =>
      () => updateEmployee(db, 1, anna, { ...record, groupId }, actor.permissions, undefined, actor.employeeId)
    expect(errorCode(save(editor, bears))).toBe('own_account')
    // The rest of the own record as today, the unchanged group included.
    expect(errorCode(save(editor, mice))).toBeNull()
    // Another employee's group, and the Träger's change of any group, as today.
    const ben = addEmployee(db, 'Ben')
    updateEmployee(db, 1, ben, { name: 'Ben', shortName: 'Be', leftOn: null, groupId: bears }, editor.permissions, undefined, editor.employeeId)
    const traegerEmployee = addEmployee(db, 'Tom')
    updateUser(db, provider, provider.id, { role: 'provider', employeeId: traegerEmployee, active: true })
    const traeger = getActiveUser(db, provider.id)!
    updateEmployee(db, 1, traegerEmployee, { name: 'Tom', shortName: 'To', leftOn: null, groupId: bears }, traeger.permissions, undefined, traeger.employeeId)
    expect(errorCode(save(editor, bears))).toBe('own_account')
  })

  it('keeps a Mitarbeiter with employee and time rights off the own balance figures (403 own_account), not the Leitung', () => {
    const own = createUser(db, leitung, { username: 'anna', password: 'start-1234', role: 'observer', employeeId: anna })
    saveUserRights(db, provider, own.id, [{ bundle: 'employeesEdit', effect: 'grant' }, { bundle: 'timeManage', effect: 'grant' }])
    const editor = getActiveUser(db, own.id)!
    const ben = addEmployee(db, 'Ben')
    const hours = { weeklyMinutes: 1200, validFrom: '2026-01-01' }
    const booking = { date: '2026-10-01', minutes: 60, reason: 'Ausgleich' }
    const entitlement = { days: 30, carriedOverDays: 0 }
    const bookingOf = (employeeId: number) => db.select().from(balanceAdjustments).all().find(row => row.employeeId === employeeId)!.id
    const hoursOf = (employeeId: number) => db.select().from(employeeHours).all().find(row => row.employeeId === employeeId)!.id
    // The Leitung books on Anna's record (as today); Anna does not on her own.
    addHours(db, 1, anna, { weeklyMinutes: 1000, validFrom: '2025-01-01' }, leitung)
    addHours(db, 1, anna, hours, leitung)
    addAdjustment(db, 1, anna, booking, leitung)
    expect(errorCode(() => addHours(db, 1, anna, hours, editor))).toBe('own_account')
    expect(errorCode(() => deleteHours(db, 1, hoursOf(anna), editor))).toBe('own_account')
    expect(errorCode(() => addAdjustment(db, 1, anna, booking, editor))).toBe('own_account')
    expect(errorCode(() => setAdjustmentPaidOut(db, editor, 1, anna, bookingOf(anna), true))).toBe('own_account')
    expect(errorCode(() => deleteAdjustment(db, 1, bookingOf(anna), editor))).toBe('own_account')
    expect(errorCode(() => setEntitlement(db, 1, anna, 2026, entitlement, editor))).toBe('own_account')
    expect(db.select().from(balanceAdjustments).all()).toHaveLength(1)
    expect(db.select().from(leaveEntitlements).all().filter(row => row.employeeId === anna)).toHaveLength(0)
    // A colleague's figures as today.
    addHours(db, 1, ben, hours, editor)
    addAdjustment(db, 1, ben, booking, editor)
    setAdjustmentPaidOut(db, editor, 1, ben, bookingOf(ben), true)
    deleteAdjustment(db, 1, bookingOf(ben), editor)
    setEntitlement(db, 1, ben, 2026, entitlement, editor)
    // The Leitung keeps today's behaviour on its own record.
    const leaEmployee = addEmployee(db, 'Lea')
    const lea = getActiveUser(db, createUser(db, leitung, { username: 'lea', password: 'start-1234', role: 'admin', employeeId: leaEmployee }).id)!
    addHours(db, 1, leaEmployee, hours, lea)
    addAdjustment(db, 1, leaEmployee, booking, lea)
    setAdjustmentPaidOut(db, lea, 1, leaEmployee, bookingOf(leaEmployee), true)
    deleteAdjustment(db, 1, bookingOf(leaEmployee), lea)
    setEntitlement(db, 1, leaEmployee, 2026, entitlement, lea)
    expect(db.select().from(leaveEntitlements).all().filter(row => row.employeeId === leaEmployee)).toHaveLength(1)
  })

  it('keeps the Leitung managing Leitung, Mitarbeiter and tablet accounts of its facility, but not its own', () => {
    const second = createUser(db, leitung, { username: 'leitung2', password: 'start-1234', role: 'admin', employeeId: null })
    expect(updateUser(db, leitung, second.id, { role: 'admin', employeeId: null, active: false }).active).toBe(false)
    expect(errorCode(() => updateUser(db, leitung, leitung.id, { role: 'admin', employeeId: anna, active: true }))).toBe('own_account')
    // The Träger changes its own account as before.
    expect(updateUser(db, provider, provider.id, { role: 'provider', employeeId: null, active: true }).role).toBe('provider')
  })
})

describe('terminal users', () => {
  let db: Db
  let provider: SessionUser
  beforeEach(() => {
    db = createTestDb()
    provider = addUser(db, 'traeger', 'provider')
  })
  it('creates a terminal user without employee and without forced password change', () => {
    const user = createUser(db, provider, { username: 'Tablet', password: 'tablet-password', role: 'terminal', employeeId: null })
    expect(user).toMatchObject({ username: 'tablet', role: 'terminal', employeeId: null, mustChangePassword: false })
  })
  it('rejects a terminal user linked to an employee', () => {
    const anna = addEmployee(db, 'Anna')
    expect(errorCode(() => createUser(db, provider, { username: 'tablet', password: 'tablet-password', role: 'terminal', employeeId: anna })))
      .toBe('terminal_no_employee')
    const user = createUser(db, provider, { username: 'tablet', password: 'tablet-password', role: 'terminal', employeeId: null })
    expect(errorCode(() => updateUser(db, provider, user.id, { role: 'terminal', employeeId: anna, active: true }))).toBe('terminal_no_employee')
  })
  it('never forces a terminal user to change the password after a reset', () => {
    const user = createUser(db, provider, { username: 'tablet', password: 'tablet-password', role: 'terminal', employeeId: null })
    resetPassword(db, provider, user.id, 'another-password')
    expect(listUsers(db, provider).find(candidate => candidate.id === user.id)!.mustChangePassword).toBe(false)
    const admin = createUser(db, provider, { username: 'chef', password: 'secret-password', role: 'admin', employeeId: null })
    resetPassword(db, provider, admin.id, 'another-password')
    expect(listUsers(db, provider).find(candidate => candidate.id === admin.id)!.mustChangePassword).toBe(true)
  })
  it('clears the forced password change when a user becomes a terminal', () => {
    const user = createUser(db, provider, { username: 'staff', password: 'staff-password', role: 'observer', employeeId: addEmployee(db, 'Anna') })
    expect(user.mustChangePassword).toBe(true)
    const updated = updateUser(db, provider, user.id, { role: 'terminal', employeeId: null, active: true })
    expect(updated.mustChangePassword).toBe(false)
  })
})

describe('users per facility', () => {
  let db: Db
  let facility2: number
  let anna: number
  let kim: number
  let provider: SessionUser
  let leitungA: SessionUser
  let leitungB: SessionUser
  beforeEach(() => {
    db = createTestDb()
    facility2 = addFacility(db, 'Krippe')
    anna = addEmployee(db, 'Anna')
    kim = addEmployee(db, 'Kim', { facilityId: facility2 })
    leitungA = addUser(db, 'leitung-a', 'admin')
    leitungB = addUser(db, 'leitung-b', 'admin', null, facility2)
  })
  const names = (viewer: SessionUser) => listUsers(db, viewer).map(user => user.username)

  it('a Leitung only sees and manages its own facility\'s users', () => {
    provider = addUser(db, 'traeger', 'provider')
    addUser(db, 'tablet-a', 'terminal')
    addUser(db, 'tablet-b', 'terminal', null, facility2)
    addUser(db, 'anna', 'observer', anna)
    const kimUser = addUser(db, 'kim', 'observer', kim)
    expect(names(leitungA)).toEqual(['anna', 'leitung-a', 'tablet-a', 'traeger'])
    expect(names(leitungB)).toEqual(['kim', 'leitung-b', 'tablet-b', 'traeger'])
    expect(errorCode(() => updateUser(db, leitungA, kimUser.id, { role: 'observer', employeeId: kim, active: false }))).toBe('user_not_found')
    expect(errorCode(() => resetPassword(db, leitungA, kimUser.id, 'reset-1234'))).toBe('user_not_found')
    expect(errorCode(() => updateUser(db, leitungA, leitungB.id, { role: 'admin', employeeId: null, active: false }))).toBe('user_not_found')
    // The Träger sees the active facility's users plus all Träger accounts.
    expect(names(provider)).toEqual(['anna', 'leitung-a', 'tablet-a', 'traeger'])
    expect(names({ ...provider, facilityId: facility2 })).toEqual(['kim', 'leitung-b', 'tablet-b', 'traeger'])
  })
  it('creates Leitung and tablet accounts in the creating user\'s facility', () => {
    const tablet = createUser(db, leitungB, { username: 'tablet', password: 'tablet-password', role: 'terminal', employeeId: null })
    const leitung = createUser(db, leitungB, { username: 'neu', password: 'start-1234', role: 'admin', employeeId: null })
    expect(names(leitungB)).toEqual(expect.arrayContaining(['tablet', 'neu']))
    expect(names(leitungA)).not.toContain('tablet')
    expect(getActiveUser(db, tablet.id)!.facilityId).toBe(facility2)
    expect(getActiveUser(db, leitung.id)!.facilityId).toBe(facility2)
  })
  it('links Mitarbeiter accounts only to the facility\'s employees', () => {
    expect(errorCode(() => createUser(db, leitungA, { username: 'kim', password: 'start-1234', role: 'observer', employeeId: kim }))).toBe('employee_not_found')
    const user = createUser(db, leitungB, { username: 'kim', password: 'start-1234', role: 'observer', employeeId: kim })
    expect(getActiveUser(db, user.id)!.facilityId).toBe(facility2)
    const other = createUser(db, leitungA, { username: 'anna', password: 'start-1234', role: 'observer', employeeId: anna })
    expect(errorCode(() => updateUser(db, leitungA, other.id, { role: 'observer', employeeId: kim, active: true }))).toBe('employee_not_found')
  })
  it('counts the last Leitung per facility', () => {
    const downgrade = (actor: SessionUser) =>
      () => updateUser(db, actor, leitungB.id, { role: 'observer', employeeId: kim, active: true })
    // The Leitung never changes its own account (it could only lock itself out or raise its rights).
    expect(errorCode(downgrade(leitungB))).toBe('own_account')
    expect(errorCode(() => updateUser(db, leitungB, leitungB.id, { role: 'admin', employeeId: null, active: false }))).toBe('own_account')
    // Nor may anyone else take the last active Leitung away (here a deactivated second one of the facility).
    const second = addUser(db, 'leitungB2', 'admin', null, facility2)
    db.update(users).set({ active: false }).where(eq(users.id, second.id)).run()
    expect(errorCode(downgrade(second))).toBe('last_admin')
    provider = addUser(db, 'traeger', 'provider', null, facility2)
    expect(errorCode(downgrade(provider))).toBeNull()
    expect(getActiveUser(db, leitungB.id)!.facilityId).toBe(facility2) // now a Mitarbeiter following Kim
  })
  it('the Träger moves an employee to another facility', () => {
    const kimUser = addUser(db, 'kim', 'observer', kim)
    expect(getActiveUser(db, kimUser.id)!.facilityId).toBe(facility2)
    provider = addUser(db, 'traeger', 'provider')
    moveEmployeeToFacility(db, provider, kim, 1)
    expect(listEmployees(db, 1, '2026-10-05', rolePermissions(db, 'admin')).map(employee => employee.name)).toEqual(['Anna', 'Kim'])
    expect(listEmployees(db, facility2, '2026-10-05', rolePermissions(db, 'admin'))).toEqual([])
    expect(getActiveUser(db, kimUser.id)!.facilityId).toBe(1)
    expect(errorCode(() => moveEmployeeToFacility(db, provider, 999, 1))).toBe('employee_not_found')
    expect(errorCode(() => moveEmployeeToFacility(db, provider, kim, 999))).toBe('facility_not_found')
  })
})
