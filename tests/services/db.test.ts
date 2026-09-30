import { describe, expect, it } from 'vitest'
import { absenceCodes, coverageRules, shiftTemplates, users } from '../../server/db/schema'
import { ensureInitialAdmin, seedDefaults } from '../../server/db/seed'
import { verifyPassword } from '../../server/lib/password'
import { createTestDb } from '../helpers/fixtures'

describe('database setup', () => {
  it('seeds templates, codes and coverage rules once', () => {
    const db = createTestDb()
    seedDefaults(db)
    expect(db.select().from(shiftTemplates).all().map(t => t.shortLabel)).toEqual(['F1', 'F2', 'M', 'S', 'HK'])
    expect(db.select().from(absenceCodes).all()).toHaveLength(9)
    expect(db.select().from(coverageRules).all()).toHaveLength(3)
  })
  it('creates the initial admin only when no user exists', () => {
    const db = createTestDb()
    expect(ensureInitialAdmin(db, undefined, undefined)).toBe(false)
    expect(ensureInitialAdmin(db, 'leitung', 'start-password')).toBe(true)
    expect(ensureInitialAdmin(db, 'other', 'start-password')).toBe(false)
    const [admin] = db.select().from(users).all()
    expect(admin).toMatchObject({ username: 'leitung', role: 'admin', mustChangePassword: true })
    expect(verifyPassword('start-password', admin!.passwordHash)).toBe(true)
  })
})
