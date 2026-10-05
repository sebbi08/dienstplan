import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { login } from '../../server/services/auth'
import { createUser, listUsers, resetPassword, updateUser } from '../../server/services/users'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, createTestDb, errorCode } from '../helpers/fixtures'

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
    expect(listUsers(db)).toHaveLength(2) // with the Träger
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
    expect(listUsers(db).find(candidate => candidate.id === user.id)!.mustChangePassword).toBe(false)
    const admin = createUser(db, provider, { username: 'chef', password: 'secret-password', role: 'admin', employeeId: null })
    resetPassword(db, provider, admin.id, 'another-password')
    expect(listUsers(db).find(candidate => candidate.id === admin.id)!.mustChangePassword).toBe(true)
  })
  it('clears the forced password change when a user becomes a terminal', () => {
    const user = createUser(db, provider, { username: 'staff', password: 'staff-password', role: 'observer', employeeId: addEmployee(db, 'Anna') })
    expect(user.mustChangePassword).toBe(true)
    const updated = updateUser(db, provider, user.id, { role: 'terminal', employeeId: null, active: true })
    expect(updated.mustChangePassword).toBe(false)
  })
})
