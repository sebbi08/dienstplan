import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { employees } from '../../server/db/schema'
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
    const provider = addUser(db, 'traeger', 'provider')
    const anna = addEmployee(db, 'Anna')
    const observer = addUser(db, 'anna', 'observer', anna)
    updateUser(db, provider, observer.id, { role: 'observer', employeeId: anna, active: false })
    expect(login(db, 'anna', TEST_PASSWORD)).toEqual({ ok: false, reason: 'invalid' })
    expect(getActiveUser(db, observer.id)).toBeNull()
  })
  describe('after the employee has left', () => {
    const setLeftOn = (id: number, leftOn: string | null) =>
      db.update(employees).set({ leftOn }).where(eq(employees.id, id)).run()
    const onDay = (iso: string) => new Date(`${iso}T10:00:00Z`)

    it('refuses the login of a Leitung or Mitarbeiter from the day after leaving', () => {
      const anna = addEmployee(db, 'Anna', { leftOn: '2026-10-26' })
      const ben = addEmployee(db, 'Ben', { leftOn: '2026-10-26' })
      addUser(db, 'anna', 'admin', anna)
      addUser(db, 'ben', 'observer', ben)
      expect(login(db, 'anna', TEST_PASSWORD, onDay('2026-10-26')).ok).toBe(true)
      expect(login(db, 'ben', TEST_PASSWORD, onDay('2026-10-26')).ok).toBe(true)
      expect(login(db, 'anna', TEST_PASSWORD, onDay('2026-10-27'))).toEqual({ ok: false, reason: 'left' })
      expect(login(db, 'ben', TEST_PASSWORD, onDay('2026-10-27'))).toEqual({ ok: false, reason: 'left' })
      // A wrong password still answers "invalid", so the refusal tells nothing to someone without the password.
      expect(login(db, 'anna', 'nope', onDay('2026-10-27'))).toEqual({ ok: false, reason: 'invalid' })
    })
    it('uses the day in Berlin', () => {
      const anna = addEmployee(db, 'Anna', { leftOn: '2026-10-26' })
      addUser(db, 'anna', 'admin', anna)
      // 23:30 UTC on the 26th is already the 27th in Berlin.
      expect(login(db, 'anna', TEST_PASSWORD, new Date('2026-10-26T23:30:00Z'))).toEqual({ ok: false, reason: 'left' })
    })
    it('ends a running session once the employee has left', () => {
      const anna = addEmployee(db, 'Anna')
      const account = addUser(db, 'anna', 'admin', anna)
      expect(getActiveUser(db, account.id, '2026-10-27')).not.toBeNull()
      setLeftOn(anna, '2026-10-26')
      expect(getActiveUser(db, account.id, '2026-10-26')).not.toBeNull()
      expect(getActiveUser(db, account.id, '2026-10-27')).toBeNull()
    })
    it('never blocks the Träger', () => {
      const tina = addEmployee(db, 'Tina', { leftOn: '2026-01-31' })
      const traeger = addUser(db, 'traeger', 'provider', tina)
      expect(login(db, 'traeger', TEST_PASSWORD, onDay('2026-10-27')).ok).toBe(true)
      expect(getActiveUser(db, traeger.id, '2026-10-27')).not.toBeNull()
    })
    it('works again once the leaving is taken back or moved to a later day', () => {
      const anna = addEmployee(db, 'Anna', { leftOn: '2026-10-26' })
      const account = addUser(db, 'anna', 'observer', anna)
      expect(getActiveUser(db, account.id, '2026-10-27')).toBeNull()
      setLeftOn(anna, null)
      expect(login(db, 'anna', TEST_PASSWORD, onDay('2026-10-27')).ok).toBe(true)
      expect(getActiveUser(db, account.id, '2026-10-27')).not.toBeNull()
      setLeftOn(anna, '2026-11-30')
      expect(login(db, 'anna', TEST_PASSWORD, onDay('2026-10-27')).ok).toBe(true)
      expect(getActiveUser(db, account.id, '2026-10-27')).not.toBeNull()
    })
  })
  it('changes the password and clears the must-change flag', () => {
    const user = addUser(db, 'leitung', 'admin')
    expect(errorCode(() => changePassword(db, user.id, 'nope', 'new-password'))).toBe('wrong_password')
    expect(errorCode(() => changePassword(db, user.id, TEST_PASSWORD, 'short'))).toBe('password_too_short')
    changePassword(db, user.id, TEST_PASSWORD, 'new-password')
    expect(login(db, 'leitung', 'new-password')).toMatchObject({ ok: true, user: { mustChangePassword: false } })
  })
})
