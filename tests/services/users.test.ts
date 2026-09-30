import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { login } from '../../server/services/auth'
import { createUser, listUsers, resetPassword, updateUser } from '../../server/services/users'
import { addEmployee, addUser, createTestDb, errorCode } from '../helpers/fixtures'

describe('users service', () => {
  let db: Db
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    anna = addEmployee(db, 'Anna')
  })

  it('creates an observer linked to an employee who must change the password', () => {
    const user = createUser(db, { username: 'anna', password: 'start-1234', role: 'observer', employeeId: anna })
    expect(user).toMatchObject({ username: 'anna', role: 'observer', employeeId: anna, employeeName: 'Anna', mustChangePassword: true, active: true })
    expect(listUsers(db)).toHaveLength(1)
  })
  it('validates new users', () => {
    createUser(db, { username: 'anna', password: 'start-1234', role: 'observer', employeeId: anna })
    expect(errorCode(() => createUser(db, { username: 'anna', password: 'start-1234', role: 'admin', employeeId: null }))).toBe('username_taken')
    expect(errorCode(() => createUser(db, { username: 'x', password: 'start-1234', role: 'observer', employeeId: null }))).toBe('employee_required')
    expect(errorCode(() => createUser(db, { username: 'y', password: 'start-1234', role: 'observer', employeeId: anna }))).toBe('employee_taken')
    expect(errorCode(() => createUser(db, { username: 'z', password: 'kurz', role: 'admin', employeeId: null }))).toBe('password_too_short')
    expect(errorCode(() => createUser(db, { username: '  ', password: 'start-1234', role: 'admin', employeeId: null }))).toBe('username_required')
  })
  it('never removes the last active admin', () => {
    const admin = addUser(db, 'leitung', 'admin')
    expect(errorCode(() => updateUser(db, admin.id, { role: 'observer', employeeId: anna, active: true }))).toBe('last_admin')
    expect(errorCode(() => updateUser(db, admin.id, { role: 'admin', employeeId: null, active: false }))).toBe('last_admin')
    addUser(db, 'stellvertretung', 'admin')
    expect(updateUser(db, admin.id, { role: 'admin', employeeId: null, active: false }).active).toBe(false)
  })
  it('resets a password and forces a change', () => {
    const user = addUser(db, 'leitung', 'admin')
    resetPassword(db, user.id, 'reset-1234')
    expect(login(db, 'leitung', 'reset-1234')).toMatchObject({ ok: true, user: { mustChangePassword: true } })
    expect(errorCode(() => resetPassword(db, 999, 'reset-1234'))).toBe('user_not_found')
  })
})
