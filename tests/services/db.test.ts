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

  /** A temporary copy of the migrations folder holding only the migrations up to and including `last` (e.g. '0023'). */
  function migrationsThrough(last: string): string {
    const folder = mkdtempSync(join(tmpdir(), 'dienstplan-migrations-'))
    mkdirSync(join(folder, 'meta'))
    const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }
    journal.entries = journal.entries.filter(entry => entry.tag.slice(0, 4) <= last)
    writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify(journal))
    for (const entry of journal.entries) copyFileSync(join(MIGRATIONS, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))
    return folder
  }

  /** A database migrated with drizzle's migrator up to and including `last` (e.g. '0018'), as an older app version left it. */
  function databaseAt(last: string) {
    const folder = migrationsThrough(last)
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
    // group_id comes with the later migration 0022.
    expect(after.map(({ help_facility_id: _, group_id: __, ...rest }) => rest)).toEqual(before)
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

  it('adds groups without touching the existing rows', () => {
    const { db, sqlite } = databaseAt('0021')
    sqlite.exec(`
      INSERT INTO facilities (id, name) VALUES (2, 'Krippe');
      INSERT INTO employees (id, name, facility_id) VALUES (1, 'Anna', 1), (2, 'Ben', 2);
      INSERT INTO shift_templates (id, short_label, label, start, end, facility_id) VALUES (1, 'F1', 'Frühdienst', 420, 795, 1);
      INSERT INTO entries (id, employee_id, date, kind, shift_template_id, start, end, updated_at) VALUES
        (1, 1, '2026-10-05', 'shift', 1, 420, 795, 'now'), (2, 2, '2026-10-06', 'shift', 1, 420, 795, 'now');
      INSERT INTO coverage_rules (id, facility_id, label, start, end, min_count) VALUES (1, 1, 'Früh', 420, 480, 2);
      INSERT INTO week_templates (id, facility_id, name, updated_at) VALUES (1, 1, 'Normalwoche', 'now'), (2, 2, 'Krippenwoche', 'now');
      INSERT INTO week_template_entries (week_template_id, employee_id, weekday, kind) VALUES (1, 1, 0, 'shift');
      INSERT INTO week_template_marks (facility_id, week_start, week_template_id) VALUES
        (1, '2026-10-05', 1), (1, '2026-10-12', 1), (2, '2026-10-05', 2);
    `)
    const tables = ['employees', 'entries', 'coverage_rules', 'week_templates', 'week_template_entries', 'week_template_marks']
    const before = Object.fromEntries(tables.map(table => [table, sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))

    migrateDb(db, MIGRATIONS)

    for (const table of ['employees', 'entries', 'coverage_rules', 'week_templates']) {
      const after = sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as Record<string, unknown>[]
      expect(after.map(({ group_id: _, ...rest }) => rest), table).toEqual(before[table])
      expect(after.every(row => row.group_id === null), table).toBe(true)
    }
    expect(sqlite.prepare('SELECT * FROM week_template_entries').all()).toEqual(before.week_template_entries)
    expect(sqlite.prepare(
      'SELECT facility_id, week_start, week_template_id, group_id FROM week_template_marks ORDER BY facility_id, week_start',
    ).all()).toEqual([
      { facility_id: 1, week_start: '2026-10-05', week_template_id: 1, group_id: 0 },
      { facility_id: 1, week_start: '2026-10-12', week_template_id: 1, group_id: 0 },
      { facility_id: 2, week_start: '2026-10-05', week_template_id: 2, group_id: 0 },
    ])
    expect(count(sqlite, 'groups')).toBe(0)
    // A group's own mark sits next to the facility's mark of the same week.
    sqlite.exec('INSERT INTO groups (id, facility_id, name) VALUES (1, 1, \'Bären\')')
    sqlite.exec('INSERT INTO week_template_marks (facility_id, week_start, week_template_id, group_id) VALUES (1, \'2026-10-05\', 1, 1)')
    expect(() => sqlite.exec('INSERT INTO week_template_marks (facility_id, week_start, week_template_id) VALUES (1, \'2026-10-05\', 1)'))
      .toThrow(/UNIQUE|PRIMARY KEY/)
    expect(() => sqlite.exec('UPDATE employees SET group_id = 99 WHERE id = 1')).toThrow(/FOREIGN KEY/)
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('adds mandatory appointments with the built-in kinds for every existing facility, without touching existing rows', () => {
    const { db, sqlite } = databaseAt('0022')
    expect(sqlite.prepare('SELECT name FROM sqlite_master WHERE name = \'requirement_types\'').all()).toEqual([])
    sqlite.exec(`
      INSERT INTO facilities (id, name, sort_order) VALUES (2, 'Krippe', 1);
      INSERT INTO groups (id, facility_id, name) VALUES (1, 1, 'Bären');
      INSERT INTO employees (id, name, facility_id, group_id, left_on) VALUES (1, 'Anna', 1, 1, NULL), (2, 'Ben', 2, NULL, '2026-06-30');
      INSERT INTO employee_hours (employee_id, weekly_minutes, valid_from) VALUES (1, 2340, '2026-01-01'), (2, 1200, '2026-01-01');
      INSERT INTO users (id, username, password_hash, role, employee_id, facility_id) VALUES
        (1, 'traeger', 'x', 'provider', NULL, 2), (2, 'anna', 'x', 'observer', 1, NULL);
      INSERT INTO shift_templates (id, short_label, label, start, end, facility_id) VALUES (1, 'F1', 'Frühdienst', 420, 795, 1);
      INSERT INTO entries (id, employee_id, date, kind, shift_template_id, start, end, group_id, updated_at) VALUES
        (1, 1, '2026-10-05', 'shift', 1, 420, 795, 1, 'now'), (2, 2, '2026-10-06', 'shift', 1, 420, 795, NULL, 'now');
      INSERT INTO help_outs (employee_id, facility_id, year, month) VALUES (1, 2, 2026, 10);
      INSERT INTO coverage_rules (id, facility_id, label, start, end, min_count, group_id) VALUES (1, 1, 'Früh', 420, 480, 2, 1);
    `)
    const tables = ['facilities', 'groups', 'employees', 'employee_hours', 'users', 'shift_templates', 'entries', 'help_outs', 'coverage_rules']
    const dump = () => Object.fromEntries(tables.map(table => [table, sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
    const NEW_TABLES = ['requirement_types', 'employee_requirements', 'employee_trainings']
    const existingSchema = () => (sqlite.prepare('SELECT name, tbl_name, sql FROM sqlite_master ORDER BY name').all() as { tbl_name: string }[])
      .filter(object => !NEW_TABLES.includes(object.tbl_name))
    const before = dump()
    const schemaBefore = existingSchema()

    // Only through 0023, so a later migration that alters these tables does not break the test.
    const folder = migrationsThrough('0023')
    try {
      migrateDb(db, folder)
    }
    finally {
      rmSync(folder, { recursive: true, force: true })
    }

    // Nothing existing is rebuilt or changed: the same rows and the same table and index definitions.
    expect(dump()).toEqual(before)
    expect(existingSchema()).toEqual(schemaBefore)
    expect(sqlite.prepare(
      'SELECT facility_id, name, interval_months, builtin_key, sort_order FROM requirement_types ORDER BY facility_id, sort_order',
    ).all()).toEqual([1, 2].flatMap(facility_id => [
      { facility_id, name: 'Betriebsarzt', interval_months: 24, builtin_key: 'company_doctor', sort_order: 0 },
      { facility_id, name: 'Erste-Hilfe-Kurs', interval_months: 24, builtin_key: 'first_aid', sort_order: 1 },
      { facility_id, name: 'Erweitertes Führungszeugnis', interval_months: 60, builtin_key: 'criminal_record', sort_order: 2 },
      { facility_id, name: 'Masernimpfung (Nachweis)', interval_months: null, builtin_key: 'measles', sort_order: 3 },
    ]))
    expect(count(sqlite, 'employee_requirements')).toBe(0)
    expect(count(sqlite, 'employee_trainings')).toBe(0)
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)

    // The new tables check their references and follow their employee and kind.
    const kind = (facility: number, key: string) => (sqlite.prepare(
      'SELECT id FROM requirement_types WHERE facility_id = ? AND builtin_key = ?',
    ).get(facility, key) as { id: number }).id
    sqlite.exec('INSERT INTO requirement_types (id, facility_id, name, interval_months, sort_order) VALUES (100, 1, \'Hygienebelehrung\', 24, 4)')
    const record = sqlite.prepare('INSERT INTO employee_requirements (employee_id, type_id, date, note) VALUES (?, ?, ?, ?)')
    record.run(1, kind(1, 'company_doctor'), '2026-01-15', null)
    record.run(1, 100, '2026-02-01', 'Gesundheitsamt')
    record.run(2, kind(2, 'measles'), '2020-03-01', null)
    sqlite.exec(`INSERT INTO employee_trainings (employee_id, date, title, note) VALUES
      (1, '2026-03-10', 'Sprachförderung', NULL), (2, '2026-04-20', 'Kinderschutz', 'online')`)
    expect(() => record.run(99, 100, '2026-02-01', null)).toThrow(/FOREIGN KEY/)
    expect(() => record.run(1, 999, '2026-02-01', null)).toThrow(/FOREIGN KEY/)
    expect(() => sqlite.exec('INSERT INTO requirement_types (facility_id, name) VALUES (99, \'Fremd\')')).toThrow(/FOREIGN KEY/)
    expect(() => sqlite.exec('INSERT INTO requirement_types (facility_id, name, builtin_key) VALUES (1, \'Doppelt\', \'measles\')'))
      .toThrow(/UNIQUE/)
    sqlite.exec('DELETE FROM requirement_types WHERE id = 100')
    expect(sqlite.prepare('SELECT employee_id, date FROM employee_requirements ORDER BY id').all())
      .toEqual([{ employee_id: 1, date: '2026-01-15' }, { employee_id: 2, date: '2020-03-01' }])
    sqlite.exec('DELETE FROM employees WHERE id = 1')
    expect(sqlite.prepare('SELECT employee_id FROM employee_requirements').all()).toEqual([{ employee_id: 2 }])
    expect(sqlite.prepare('SELECT employee_id, title FROM employee_trainings').all()).toEqual([{ employee_id: 2, title: 'Kinderschutz' }])
    expect(count(sqlite, 'requirement_types')).toBe(8)
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('creates only the three new tables in the migration for mandatory appointments', () => {
    const statements = readFileSync(join(MIGRATIONS, '0023_requirements.sql'), 'utf8')
      .split('--> statement-breakpoint').map(part => part.trim()).filter(part => part !== '')
    const created = statements.filter(part => part.startsWith('CREATE TABLE')).map(part => /^CREATE TABLE `(\w+)`/.exec(part)![1])
    expect(created.sort()).toEqual(['employee_requirements', 'employee_trainings', 'requirement_types'])
    const inserts = statements.filter(part => part.startsWith('INSERT INTO'))
    expect(inserts).toHaveLength(4)
    for (const insert of inserts) expect(insert).toMatch(/^INSERT INTO `requirement_types` [^;]* FROM `facilities`;?$/)
    // Everything else only indexes the new tables: no table is altered, dropped or rebuilt.
    const others = statements.filter(part => !part.startsWith('CREATE TABLE') && !part.startsWith('INSERT INTO'))
    for (const other of others) {
      expect(other).toMatch(/^CREATE (UNIQUE )?INDEX `\w+` ON `(requirement_types|employee_requirements|employee_trainings)` /)
    }
    expect(statements.join('\n')).not.toMatch(/ALTER TABLE|DROP TABLE|__new_|PRAGMA/)
  })

  it('adds the markers for falling ill during duty and keeps every existing row', () => {
    const { db, sqlite } = databaseAt('0023')
    expect(sqlite.prepare('SELECT name FROM sqlite_master WHERE name = \'early_sick_leaves\'').all()).toEqual([])
    sqlite.exec(`
      INSERT INTO facilities (id, name, sort_order) VALUES (2, 'Krippe', 1);
      INSERT INTO employees (id, name, facility_id) VALUES (1, 'Anna', 1), (2, 'Ben', 2);
      INSERT INTO employee_hours (employee_id, weekly_minutes, valid_from) VALUES (1, 2340, '2026-01-01'), (2, 1200, '2026-01-01');
      INSERT INTO users (id, username, password_hash, role, employee_id, facility_id) VALUES
        (1, 'traeger', 'x', 'provider', NULL, 1), (2, 'leitung', 'x', 'admin', NULL, 1), (3, 'anna', 'x', 'observer', 1, NULL);
      INSERT INTO shift_templates (id, short_label, label, start, end, facility_id) VALUES (1, 'F1', 'Frühdienst', 420, 795, 1);
      INSERT INTO entries (id, employee_id, date, kind, shift_template_id, start, end, updated_at) VALUES
        (1, 1, '2026-10-05', 'shift', 1, 420, 795, 'now'), (2, 2, '2026-10-06', 'shift', 1, 420, 795, 'now');
      INSERT INTO time_records (employee_id, date, start, end, source, created_at) VALUES (1, '2026-10-05', 420, 680, 'terminal', 'now');
      INSERT INTO time_day_notes (employee_id, date, note) VALUES (1, '2026-10-05', 'Arzttermin');
      INSERT INTO employee_trainings (employee_id, date, title) VALUES (1, '2026-03-10', 'Sprachförderung');
    `)
    const tables = (sqlite.prepare('SELECT name FROM sqlite_master WHERE type = \'table\' AND name NOT LIKE \'sqlite_%\' AND name NOT LIKE \'__drizzle%\' ORDER BY name')
      .all() as { name: string }[]).map(row => row.name)
    const dump = () => Object.fromEntries(tables.map(table => [table, sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
    const existingSchema = () => (sqlite.prepare('SELECT name, tbl_name, sql FROM sqlite_master ORDER BY name').all() as { tbl_name: string }[])
      .filter(object => object.tbl_name !== 'early_sick_leaves')
    const before = dump()
    const schemaBefore = existingSchema()
    expect(before.entries).toHaveLength(2)

    // Only through 0024, so a later migration that alters these tables does not break the test.
    const folder = migrationsThrough('0024')
    try {
      migrateDb(db, folder)
    }
    finally {
      rmSync(folder, { recursive: true, force: true })
    }

    // Nothing existing is rebuilt or changed: the same rows and the same table and index definitions.
    expect(dump()).toEqual(before)
    expect(existingSchema()).toEqual(schemaBefore)
    expect(count(sqlite, 'early_sick_leaves')).toBe(0)
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)

    // The new table: one marker per employee and day, following its employee; the user who entered it may go.
    const marker = sqlite.prepare('INSERT INTO early_sick_leaves (employee_id, date, left_at, note, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    marker.run(1, '2026-10-05', 680, 'Migräne', 'now', 2)
    marker.run(1, '2026-10-06', null, null, 'now', 2)
    marker.run(2, '2026-10-06', null, null, 'now', null)
    expect(() => marker.run(1, '2026-10-05', 700, null, 'now', 2)).toThrow(/UNIQUE/)
    expect(() => marker.run(99, '2026-10-05', null, null, 'now', 2)).toThrow(/FOREIGN KEY/)
    expect(() => marker.run(2, '2026-10-07', null, null, 'now', 99)).toThrow(/FOREIGN KEY/)
    sqlite.exec('DELETE FROM users WHERE id = 2')
    expect(sqlite.prepare('SELECT employee_id, date, left_at, note, created_by FROM early_sick_leaves ORDER BY id').all()).toEqual([
      { employee_id: 1, date: '2026-10-05', left_at: 680, note: 'Migräne', created_by: null },
      { employee_id: 1, date: '2026-10-06', left_at: null, note: null, created_by: null },
      { employee_id: 2, date: '2026-10-06', left_at: null, note: null, created_by: null },
    ])
    sqlite.exec('DELETE FROM employees WHERE id = 1')
    expect(sqlite.prepare('SELECT employee_id FROM early_sick_leaves').all()).toEqual([{ employee_id: 2 }])
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('only creates the new table and its index in the migration for falling ill during duty', () => {
    const statements = readFileSync(join(MIGRATIONS, '0024_early_sick_leaves.sql'), 'utf8')
      .split('--> statement-breakpoint').map(part => part.trim()).filter(part => part !== '')
    expect(statements).toHaveLength(2)
    expect(statements[0]).toMatch(/^CREATE TABLE `early_sick_leaves` \(/)
    expect(statements[1]).toMatch(/^CREATE UNIQUE INDEX `early_sick_leaves_employee_date` ON `early_sick_leaves` \(`employee_id`,`date`\);?$/)
    expect(statements.join('\n')).not.toMatch(/ALTER TABLE|DROP TABLE|__new_|PRAGMA|INSERT INTO/)
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
