import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { changePassword, getActiveUser, login } from '../../server/services/auth'
import { updateUser } from '../../server/services/users'
import { addEmployee, addUser, createTestDb, errorCode, TEST_PASSWORD } from '../helpers/fixtures'

describe('auth service', () => {
  let db: Db
  beforeEach(() => {
    db = createTestDb()
  })

  it('logs in with the right password', () => {
    const user = addUser(db, 'leitung', 'admin')
    expect(login(db, ' leitung ', TEST_PASSWORD)).toEqual({ ok: true, user })
  })
  it('rejects wrong passwords and unknown users', () => {
    addUser(db, 'leitung', 'admin')
    expect(login(db, 'leitung', 'nope')).toEqual({ ok: false, reason: 'invalid' })
    expect(login(db, 'nobody', TEST_PASSWORD)).toEqual({ ok: false, reason: 'invalid' })
  })
  it('locks the account for 15 minutes after 5 failed attempts', () => {
    addUser(db, 'leitung', 'admin')
    const now = new Date('2026-10-05T08:00:00Z')
    for (let attempt = 1; attempt <= 4; attempt++) expect(login(db, 'leitung', 'nope', now).ok).toBe(false)
    expect(login(db, 'leitung', 'nope', now)).toEqual({ ok: false, reason: 'locked' })
    expect(login(db, 'leitung', TEST_PASSWORD, new Date('2026-10-05T08:14:00Z'))).toEqual({ ok: false, reason: 'locked' })
    expect(login(db, 'leitung', TEST_PASSWORD, new Date('2026-10-05T08:16:00Z')).ok).toBe(true)
  })
  it('rejects inactive users', () => {
    addUser(db, 'leitung', 'admin')
    const anna = addEmployee(db, 'Anna')
    const observer = addUser(db, 'anna', 'observer', anna)
    updateUser(db, observer.id, { role: 'observer', employeeId: anna, active: false })
    expect(login(db, 'anna', TEST_PASSWORD)).toEqual({ ok: false, reason: 'invalid' })
    expect(getActiveUser(db, observer.id)).toBeNull()
  })
  it('changes the password and clears the must-change flag', () => {
    const user = addUser(db, 'leitung', 'admin')
    expect(errorCode(() => changePassword(db, user.id, 'nope', 'new-password'))).toBe('wrong_password')
    expect(errorCode(() => changePassword(db, user.id, TEST_PASSWORD, 'short'))).toBe('password_too_short')
    changePassword(db, user.id, TEST_PASSWORD, 'new-password')
    expect(login(db, 'leitung', 'new-password')).toMatchObject({ ok: true, user: { mustChangePassword: false } })
  })
})
