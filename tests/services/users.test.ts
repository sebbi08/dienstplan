import { beforeEach, describe, expect, it } from 'vitest'
import { rolePermissions } from '../../server/services/permissions'
import type { Db } from '../../server/db/client'
import { getActiveUser, login } from '../../server/services/auth'
import { listEmployees, moveEmployeeToFacility } from '../../server/services/employees'
import { createUser, listUsers, resetPassword, updateUser } from '../../server/services/users'
import { saveUserRights } from '../../server/services/rights'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addUser, createTestDb, errorCode } from '../helpers/fixtures'

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
    expect(errorCode(() => updateUser(db, leitung, leitung.id, { role: 'provider', employeeId: null, active: true }))).toBe('provider_only')
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
  const listed = (id: number) => listUsers(db, leitung).find(candidate => candidate.id === id)!

  it('no longer takes the old switch: 400 use_rights_api, nothing changes', () => {
    const user = createUser(db, leitung, { username: 'anna', password: 'start-1234', role: 'observer', employeeId: anna })
    for (const value of [true, false]) {
      expect(errorCode(() => updateUser(db, leitung, user.id, { role: 'admin', employeeId: null, active: true, canEditChildren: value })))
        .toBe('use_rights_api')
    }
    expect(listed(user.id)).toMatchObject({ role: 'observer', canEditChildren: false })
  })

  it('shows what the rights give a Mitarbeiter: the exception set through the rights API', () => {
    const user = createUser(db, leitung, { username: 'anna', password: 'start-1234', role: 'observer', employeeId: anna })
    expect(user.canEditChildren).toBe(false)
    allow(user.id)
    expect(listed(user.id).canEditChildren).toBe(true)
    expect(getActiveUser(db, user.id)!.permissions.has('children.edit')).toBe(true)
    // Saving the account leaves the right alone.
    expect(set(user.id, 'observer', anna).canEditChildren).toBe(true)
    saveUserRights(db, leitung, user.id, [])
    expect(listed(user.id).canEditChildren).toBe(false)
  })

  it('says false for every other role', () => {
    const tablet = createUser(db, leitung, { username: 'tablet', password: 'tablet-password', role: 'terminal', employeeId: null })
    expect(set(tablet.id, 'terminal', null).canEditChildren).toBe(false)
    const second = createUser(db, leitung, { username: 'leitung2', password: 'start-1234', role: 'admin', employeeId: null })
    expect(set(second.id, 'admin', null).canEditChildren).toBe(false)
  })

  it('clears the exceptions when the account changes its role', () => {
    const user = createUser(db, leitung, { username: 'anna', password: 'start-1234', role: 'observer', employeeId: anna })
    allow(user.id)
    expect(set(user.id, 'admin', null).canEditChildren).toBe(false)
    expect(set(user.id, 'observer', anna).canEditChildren).toBe(false)
    expect(getActiveUser(db, user.id)!.permissions.has('children.edit')).toBe(false)
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
    expect(errorCode(downgrade(leitungB))).toBe('last_admin')
    expect(errorCode(() => updateUser(db, leitungB, leitungB.id, { role: 'admin', employeeId: null, active: false }))).toBe('last_admin')
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
