import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { describe, expect, it } from 'vitest'
import { createDb, migrateDb } from '../../server/db/client'
import { absenceCodes, coverageRules, shiftTemplates, users } from '../../server/db/schema'
import { ensureInitialAdmin, resetAdminFromEnv, seedDefaults } from '../../server/db/seed'
import { verifyPassword } from '../../server/lib/password'
import { addUser, createTestDb } from '../helpers/fixtures'

describe('database setup', () => {
  it('seeds templates, codes and coverage rules once', () => {
    const db = createTestDb()
    seedDefaults(db)
    expect(db.select().from(shiftTemplates).all().map(t => t.shortLabel)).toEqual(['F1', 'F2', 'M', 'S', 'HK'])
    expect(db.select().from(absenceCodes).all()).toHaveLength(10)
    expect(db.select().from(coverageRules).all()).toHaveLength(3)
  })
  it('enforces foreign keys again after migrating', () => {
    const db = createTestDb()
    expect(db.get(sql`PRAGMA foreign_keys`)).toEqual({ foreign_keys: 1 })
  })
  it('creates the initial admin only when no user exists', () => {
    const db = createTestDb()
    expect(ensureInitialAdmin(db, undefined, undefined)).toBe(false)
    expect(ensureInitialAdmin(db, '   ', 'start-password')).toBe(false)
    expect(ensureInitialAdmin(db, 'leitung', 'start-password')).toBe(true)
    expect(ensureInitialAdmin(db, 'other', 'start-password')).toBe(false)
    const [admin] = db.select().from(users).all()
    expect(admin).toMatchObject({ username: 'leitung', role: 'provider', mustChangePassword: true })
    expect(verifyPassword('start-password', admin!.passwordHash)).toBe(true)
  })
  it('stores the initial admin name in lower case', () => {
    const db = createTestDb()
    expect(ensureInitialAdmin(db, ' Leitung ', 'start-password')).toBe(true)
    expect(db.select().from(users).all()[0]!.username).toBe('leitung')
  })
})

describe('resetAdminFromEnv', () => {
  function lockedAdmin() {
    const db = createTestDb()
    const admin = addUser(db, 'leitung', 'admin')
    db.update(users)
      .set({ failedLogins: 3, lockedUntil: '2099-01-01T00:00:00.000Z', active: false, role: 'observer' })
      .where(eq(users.id, admin.id)).run()
    return { db, id: admin.id }
  }

  it('sets a new password, forces a change and unlocks the account', () => {
    const { db, id } = lockedAdmin()
    expect(resetAdminFromEnv(db, ' Leitung ', 'reset-password')).toBe(true)
    const row = db.select().from(users).where(eq(users.id, id)).get()!
    expect(row).toMatchObject({
      role: 'provider', active: true, mustChangePassword: true, failedLogins: 0, lockedUntil: null,
    })
    expect(verifyPassword('reset-password', row.passwordHash)).toBe(true)
  })
  it('does nothing for unknown users, missing values or too short passwords', () => {
    const { db, id } = lockedAdmin()
    const before = db.select().from(users).where(eq(users.id, id)).get()!
    expect(resetAdminFromEnv(db, 'nobody', 'reset-password')).toBe(false)
    expect(resetAdminFromEnv(db, undefined, 'reset-password')).toBe(false)
    expect(resetAdminFromEnv(db, 'leitung', undefined)).toBe(false)
    expect(resetAdminFromEnv(db, 'leitung', '')).toBe(false)
    expect(resetAdminFromEnv(db, 'leitung', 'kurz')).toBe(false)
    expect(db.select().from(users).where(eq(users.id, id)).get()).toEqual(before)
  })
})

describe('migration to the Träger role', () => {
  it('makes the first active administrator the Träger, once', () => {
    const db = createTestDb()
    const inactive = addUser(db, 'alt', 'admin')
    db.update(users).set({ active: false }).where(eq(users.id, inactive.id)).run()
    const leitung = addUser(db, 'leitung', 'admin')
    const second = addUser(db, 'stellvertretung', 'admin')
    const statement = readFileSync('server/db/migrations/0012_provider_role_and_contract.sql', 'utf8')
      .split('--> statement-breakpoint').map(part => part.trim()).find(part => part.startsWith('UPDATE `users`'))!
    db.run(sql.raw(statement))
    db.run(sql.raw(statement)) // a second run changes nothing
    const roles = Object.fromEntries(db.select().from(users).all().map(user => [user.id, user.role]))
    expect(roles).toEqual({ [inactive.id]: 'admin', [leitung.id]: 'provider', [second.id]: 'admin' })
  })
})

describe('upgrading a filled database through migrateDb', () => {
  const MIGRATIONS = 'server/db/migrations'

  /** A database migrated with drizzle's migrator up to and including `last` (e.g. '0018'), as an older app version left it. */
  function databaseAt(last: string) {
    const folder = mkdtempSync(join(tmpdir(), 'dienstplan-migrations-'))
    mkdirSync(join(folder, 'meta'))
    const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }
    journal.entries = journal.entries.filter(entry => entry.tag.slice(0, 4) <= last)
    writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify(journal))
    for (const entry of journal.entries) copyFileSync(join(MIGRATIONS, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))
    const { db, sqlite } = createDb(':memory:')
    migrate(db as Parameters<typeof migrate>[0], { migrationsFolder: folder })
    rmSync(folder, { recursive: true, force: true })
    return { db, sqlite }
  }
  const count = (sqlite: Database.Database, table: string) => (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n

  it('keeps every row and moves settings, users and data into facility 1 "Kindergarten"', () => {
    const { db, sqlite } = databaseAt('0018')
    expect(sqlite.prepare('SELECT name FROM sqlite_master WHERE name = \'facilities\'').all()).toEqual([])
    sqlite.exec(`
      INSERT INTO app_settings (key, value) VALUES ('time_tracking_from', '2026-03-01'), ('leave_max_concurrent', '3'),
        ('contract_visible_to_admins', 'true');
      INSERT INTO employees (id, name) VALUES (1, 'Anna');
      INSERT INTO employee_hours (employee_id, weekly_minutes, valid_from) VALUES (1, 2340, '2026-01-01');
      INSERT INTO leave_entitlements (employee_id, year, days) VALUES (1, 2026, 30);
      INSERT INTO balance_adjustments (employee_id, date, minutes, reason) VALUES (1, '2026-01-01', 120, 'Übertrag');
      INSERT INTO users (id, username, password_hash, role, employee_id) VALUES
        (1, 'traeger', 'x', 'provider', NULL), (2, 'leitung', 'x', 'admin', NULL),
        (3, 'tablet', 'x', 'terminal', NULL), (4, 'anna', 'x', 'observer', 1);
      INSERT INTO shift_templates (id, short_label, label, start, end) VALUES (1, 'F1', 'Frühdienst', 420, 795);
      INSERT INTO entries (employee_id, date, kind, shift_template_id, updated_at) VALUES
        (1, '2026-10-05', 'shift', 1, 'now'), (1, '2026-10-06', 'shift', 1, 'now');
      INSERT INTO day_notes (date, info1) VALUES ('2026-10-05', 'Ausflug');
      INSERT INTO month_plans (year, month, released_at, released_by) VALUES (2026, 10, 'now', 2);
      INSERT INTO release_snapshots (year, month, released_at, data) VALUES (2026, 10, 'now', '{}');
      INSERT INTO change_log (date, employee_id, field, before, after, changed_at) VALUES ('2026-10-05', 1, 'entry', '', 'F1', 'now');
      INSERT INTO week_templates (id, name, updated_at) VALUES (1, 'Normalwoche', 'now');
      INSERT INTO week_template_entries (week_template_id, employee_id, weekday, kind) VALUES (1, 1, 0, 'shift');
      INSERT INTO week_template_marks (week_start, week_template_id) VALUES ('2026-10-05', 1);
      INSERT INTO early_closures (date, closed_from, reason) VALUES ('2026-10-05', 840, 'Team');
    `)
    const tables = ['employees', 'employee_hours', 'leave_entitlements', 'balance_adjustments', 'users', 'shift_templates',
      'entries', 'day_notes', 'month_plans', 'release_snapshots', 'change_log', 'week_templates', 'week_template_entries',
      'week_template_marks', 'early_closures']
    const before = Object.fromEntries(tables.map(table => [table, count(sqlite, table)]))

    migrateDb(db, MIGRATIONS) // the real start-up path

    expect(Object.fromEntries(tables.map(table => [table, count(sqlite, table)]))).toEqual(before)
    expect(sqlite.prepare('SELECT * FROM facilities').all()).toEqual([
      { id: 1, name: 'Kindergarten', sort_order: 0, time_tracking_from: '2026-03-01', leave_max_concurrent: 3 },
    ])
    expect(sqlite.prepare('SELECT key FROM app_settings').all()).toEqual([{ key: 'contract_visible_to_admins' }])
    expect(sqlite.prepare('SELECT role, facility_id FROM users ORDER BY id').all()).toEqual([
      { role: 'provider', facility_id: 1 }, { role: 'admin', facility_id: 1 }, { role: 'terminal', facility_id: 1 },
      { role: 'observer', facility_id: null },
    ])
    for (const table of ['employees', 'shift_templates', 'day_notes', 'month_plans', 'release_snapshots', 'change_log',
      'week_templates', 'week_template_marks', 'early_closures']) {
      expect(sqlite.prepare(`SELECT DISTINCT facility_id FROM ${table}`).all(), table).toEqual([{ facility_id: 1 }])
    }
    expect(sqlite.prepare('SELECT facility_since FROM employees').all()).toEqual([{ facility_since: null }])
    expect(sqlite.prepare('SELECT info1 FROM day_notes').get()).toEqual({ info1: 'Ausflug' })
    expect(sqlite.prepare('SELECT released_by FROM month_plans').get()).toEqual({ released_by: 2 })
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('adds help-outs without touching the existing entries', () => {
    const { db, sqlite } = databaseAt('0020')
    sqlite.exec(`
      INSERT INTO employees (id, name, facility_id) VALUES (1, 'Anna', 1);
      INSERT INTO shift_templates (id, short_label, label, start, end, facility_id) VALUES (1, 'F1', 'Frühdienst', 420, 795, 1);
      INSERT INTO entries (id, employee_id, date, kind, shift_template_id, start, end, updated_at) VALUES
        (1, 1, '2026-10-05', 'shift', 1, 420, 795, 'now'), (2, 1, '2026-10-06', 'shift', 1, 420, 795, 'now');
    `)
    const before = sqlite.prepare('SELECT * FROM entries ORDER BY id').all()

    migrateDb(db, MIGRATIONS)

    const after = sqlite.prepare('SELECT * FROM entries ORDER BY id').all() as Record<string, unknown>[]
    expect(after.map(({ help_facility_id: _, ...rest }) => rest)).toEqual(before)
    expect(after.map(row => row.help_facility_id)).toEqual([null, null])
    expect(count(sqlite, 'help_outs')).toBe(0)
    sqlite.exec('INSERT INTO facilities (id, name) VALUES (2, \'Krippe\')')
    sqlite.exec('INSERT INTO help_outs (employee_id, facility_id, year, month) VALUES (1, 2, 2026, 11)')
    expect(() => sqlite.exec('INSERT INTO help_outs (employee_id, facility_id, year, month) VALUES (1, 2, 2026, 11)')).toThrow(/UNIQUE/)
    expect(() => sqlite.exec('UPDATE entries SET help_facility_id = 99 WHERE id = 1')).toThrow(/FOREIGN KEY/)
    sqlite.exec('DELETE FROM employees WHERE id = 1')
    expect(count(sqlite, 'help_outs')).toBe(0)
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('checks foreign keys only when migrations ran, and names the broken tables in German', () => {
    // Nothing pending: a broken reference does not stop the start (it was there before and is not new).
    const { db: current, sqlite: currentSqlite } = createDb(':memory:')
    migrateDb(current, MIGRATIONS)
    currentSqlite.pragma('foreign_keys = OFF')
    currentSqlite.exec('INSERT INTO employee_hours (employee_id, weekly_minutes, valid_from) VALUES (999, 2340, \'2026-01-01\')')
    currentSqlite.pragma('foreign_keys = ON')
    expect(() => migrateDb(current, MIGRATIONS)).not.toThrow()

    // Pending migrations on a database with a broken reference: refuse to start with a readable message.
    const { db, sqlite } = databaseAt('0018')
    sqlite.pragma('foreign_keys = OFF')
    sqlite.exec('INSERT INTO employee_hours (employee_id, weekly_minutes, valid_from) VALUES (999, 2340, \'2026-01-01\')')
    sqlite.pragma('foreign_keys = ON')
    expect(() => migrateDb(db, MIGRATIONS))
      .toThrow('Datenbank-Prüfung fehlgeschlagen: fehlerhafte Verweise in Tabelle employee_hours')
  })
})
