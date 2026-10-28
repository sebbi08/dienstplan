import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { describe, expect, it } from 'vitest'
import { createDb, migrateDb } from '../../server/db/client'
import {
  absenceCodes, childDevelopmentDocs, childParentMeetings, children, coverageRules, employees, printTemplates, shiftTemplates,
  terminalUnlocks, users,
} from '../../server/db/schema'
import { ensureInitialAdmin, resetAdminFromEnv, seedDefaults } from '../../server/db/seed'
import { verifyPassword } from '../../server/lib/password'
import { STARTERS } from '../../shared/domain/forms/starters'
import { addChild, addEmployee, addUser, createTestDb } from '../helpers/fixtures'

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
  // Columns of `children` that 0042_consents adds / drops; the older tests compare the rows before and after without them.
  const NEW_CONSENT_COLUMNS = ['consent_signal_photos', 'consent_insect_repellent']
  const withoutOldConsent = (rows: unknown[]) =>
    (rows as Record<string, unknown>[]).map(({ consent_photos_whatsapp: _, ...rest }) => rest)
  // Columns of `facilities`, `groups`, `employees` and `care_types` that 0044_reminders, 0045_doc_since, 0050_staffing and
  // 0051_pin_six_digits add; the older tests compare rows without them.
  const REMINDER_COLUMNS = ['doc_mode', 'doc_interval_months', 'doc_lead_weeks', 'birthday_lead_days', 'staff_birthday_lead_days',
    'leaving_lead_weeks', 'birthday', 'doc_since', 'group_type', 'qualification', 'staffing_share', 'days_per_week', 'pin_lock_level']
  const withoutReminders = (rows: unknown[]) => (rows as Record<string, unknown>[])
    .map(row => Object.fromEntries(Object.entries(row).filter(([column]) => !REMINDER_COLUMNS.includes(column))))
  // Columns of `facilities` that later migrations add (0046_facility_capacity: `capacity`, which `groups` has had long since;
  // 0048_time_marks: the tolerance and the early-leave switch of the time tracking; 0055_forms: the starter templates' flag;
  // 0059_christmas_eve_half_leave: 24 and 31 December as half a leave day).
  const LATER_FACILITY_COLUMNS = [...REMINDER_COLUMNS, 'capacity', 'mark_tolerance_minutes', 'mark_early_leave', 'form_starters_seeded',
    'christmas_eve_half_leave']
  const withoutLaterFacilityColumns = (rows: unknown[]) => (rows as Record<string, unknown>[])
    .map(row => Object.fromEntries(Object.entries(row).filter(([column]) => !LATER_FACILITY_COLUMNS.includes(column))))
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
      {
        id: 1, name: 'Kindergarten', sort_order: 0, time_tracking_from: '2026-03-01', leave_max_concurrent: 3,
        mark_tolerance_minutes: 5, mark_early_leave: 1,
        school_cutoff_month: 6, school_cutoff_day: 30, school_age_years: 6, auto_leave_school_children: 0,
        tablet_lock_minutes: 2, tablet_show_waitlist: 0, tablet_show_future_contracts: 0, state: 'BW', assumption_day: 1,
        record_brought_by: 0, attendance_since: null, min_at_opening: 1, min_at_closing: 1,
        doc_mode: 'off', doc_interval_months: 12, doc_lead_weeks: 2, birthday_lead_days: 7, staff_birthday_lead_days: 7,
        leaving_lead_weeks: 4, doc_since: null, capacity: null, form_starters_seeded: 0, christmas_eve_half_leave: 0,
      },
    ])
    // The meal times of 0034 became meals in 0040 (0041 drops the columns).
    expect(sqlite.prepare('SELECT v.name, v.time FROM meals m JOIN meal_versions v ON v.meal_id = m.id WHERE m.facility_id = 1 ORDER BY v.time').all())
      .toEqual([{ name: 'Snack', time: 570 }, { name: 'Mittagessen', time: 720 }])
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
      // (weekdays of the coverage rules comes with the later 0038_opening_hours, the birthday of employees with 0044.)
      expect(withoutReminders(after.map(({ group_id: _, weekdays: __, ...rest }) => rest)), table).toEqual(before[table])
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

  it('adds the seven default document types to every existing facility with the exact flags', () => {
    // From the newest migration before the child records: a database that already has 0023 and 0024 must still get them.
    const { db, sqlite } = databaseAt('0024')
    expect(sqlite.prepare('SELECT name FROM sqlite_master WHERE name IN (\'document_types\', \'children\')').all()).toEqual([])
    const applied = count(sqlite, '__drizzle_migrations')
    expect(applied).toBe(25)
    sqlite.exec(`
      INSERT INTO facilities (id, name) VALUES (2, 'Krippe'), (3, 'Hort');
      INSERT INTO employees (id, name, facility_id) VALUES (1, 'Anna', 1), (2, 'Ben', 2);
    `)

    migrateDb(db, MIGRATIONS)

    expect(count(sqlite, '__drizzle_migrations')).toBeGreaterThan(applied)

    const expected = [
      { name: 'Betreuungsvertrag', important: 1, required: 1, confidential_default: 1, sort_order: 0 },
      { name: 'Masernnachweis', important: 1, required: 1, confidential_default: 0, sort_order: 1 },
      { name: 'Belehrung Infektionsschutz', important: 1, required: 1, confidential_default: 0, sort_order: 2 },
      { name: 'Datenschutz-Einwilligung', important: 1, required: 1, confidential_default: 0, sort_order: 3 },
      { name: 'Sorgerechtsbeschluss', important: 1, required: 0, confidential_default: 1, sort_order: 4 },
      { name: 'Ärztliches Attest', important: 0, required: 0, confidential_default: 1, sort_order: 5 },
      { name: 'Sonstiges', important: 0, required: 0, confidential_default: 0, sort_order: 6 },
    ]
    const facilities = sqlite.prepare('SELECT id FROM facilities ORDER BY id').all() as { id: number }[]
    expect(facilities.map(row => row.id)).toEqual([1, 2, 3])
    for (const { id } of facilities) {
      expect(sqlite.prepare(
        'SELECT name, important, required, confidential_default, sort_order FROM document_types WHERE facility_id = ? ORDER BY sort_order',
      ).all(id), `facility ${id}`).toEqual(expected)
    }
    expect(count(sqlite, 'document_types')).toBe(21)
    expect(count(sqlite, 'children')).toBe(0)
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('keeps children when the key educator and school district columns are added', () => {
    const { db, sqlite } = databaseAt('0025')
    expect(count(sqlite, '__drizzle_migrations')).toBe(26)
    sqlite.exec(`
      INSERT INTO employees (id, name) VALUES (1, 'Anna');
      INSERT INTO children (id, facility_id, last_name, first_name, birth_date, created_at)
        VALUES (1, 1, 'Meier', 'Lena', '2022-03-15', '2026-01-01T00:00:00.000Z');
    `)

    migrateDb(db, MIGRATIONS)

    expect(count(sqlite, '__drizzle_migrations')).toBeGreaterThan(26)
    expect(sqlite.prepare('SELECT last_name, school_district, key_educator_id FROM children WHERE id = 1').get())
      .toEqual({ last_name: 'Meier', school_district: '', key_educator_id: null })
    // The new reference works: deleting the employee leaves the child with no key educator.
    sqlite.exec('UPDATE children SET key_educator_id = 1 WHERE id = 1')
    sqlite.exec('DELETE FROM employees WHERE id = 1')
    expect(sqlite.prepare('SELECT key_educator_id FROM children WHERE id = 1').get()).toEqual({ key_educator_id: null })
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('keeps children as contract children when the admission columns are added', () => {
    const { db, sqlite } = databaseAt('0026')
    expect(count(sqlite, '__drizzle_migrations')).toBe(27)
    sqlite.exec(`
      INSERT INTO children (id, facility_id, last_name, first_name, birth_date, created_at)
        VALUES (1, 1, 'Meier', 'Lena', '2022-03-15', '2026-01-01T00:00:00.000Z');
    `)

    migrateDb(db, MIGRATIONS)

    expect(count(sqlite, '__drizzle_migrations')).toBeGreaterThan(27)
    expect(sqlite.prepare('SELECT last_name, admission_status, waitlisted_on FROM children WHERE id = 1').get())
      .toEqual({ last_name: 'Meier', admission_status: 'contract', waitlisted_on: null })
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('keeps groups without capacity and gives facilities the default school cutoff', () => {
    const { db, sqlite } = databaseAt('0027')
    expect(count(sqlite, '__drizzle_migrations')).toBe(28)
    sqlite.exec(`
      INSERT INTO facilities (id, name) VALUES (2, 'Krippe');
      INSERT INTO groups (id, facility_id, name, sort_order) VALUES (1, 1, 'Bären', 0), (2, 2, 'Wichtel', 0);
    `)

    migrateDb(db, MIGRATIONS)

    expect(count(sqlite, '__drizzle_migrations')).toBeGreaterThan(28)
    expect(sqlite.prepare('SELECT id, name, capacity FROM groups ORDER BY id').all())
      .toEqual([{ id: 1, name: 'Bären', capacity: null }, { id: 2, name: 'Wichtel', capacity: null }])
    expect(sqlite.prepare('SELECT id, school_cutoff_month, school_cutoff_day, school_age_years FROM facilities ORDER BY id').all())
      .toEqual([
        { id: 1, school_cutoff_month: 6, school_cutoff_day: 30, school_age_years: 6 },
        { id: 2, school_cutoff_month: 6, school_cutoff_day: 30, school_age_years: 6 },
      ])
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('gives every existing child one applied start entry of the group history with its current group', () => {
    const { db, sqlite } = databaseAt('0028')
    expect(count(sqlite, '__drizzle_migrations')).toBe(29)
    expect(sqlite.prepare('SELECT name FROM sqlite_master WHERE name = \'child_group_changes\'').all()).toEqual([])
    sqlite.exec(`
      INSERT INTO facilities (id, name) VALUES (2, 'Krippe');
      INSERT INTO groups (id, facility_id, name, sort_order) VALUES (1, 1, 'Bären', 0), (2, 1, 'Mäuse', 1), (3, 2, 'Wichtel', 0);
      INSERT INTO children (id, facility_id, group_id, last_name, first_name, birth_date, admission_status, left_on, created_at) VALUES
        (1, 1, 1, 'Meier', 'Lena', '2022-03-15', 'contract', NULL, '2026-01-01T00:00:00.000Z'),
        (2, 1, 2, 'Kurz', 'Ben', '2021-05-01', 'contract', '2026-08-31', '2025-06-01T09:00:00.000Z'),
        (3, 1, NULL, 'Weber', 'Mia', '2024-02-02', 'waitlist', NULL, '2026-10-01T12:00:00.000Z'),
        (4, 2, 3, 'Adler', 'Ida', '2023-07-07', 'contract', NULL, '2026-09-15T07:30:00.000Z');
    `)
    const childrenBefore = withoutOldConsent(sqlite.prepare('SELECT * FROM children ORDER BY id').all())

    migrateDb(db, MIGRATIONS)

    expect(count(sqlite, '__drizzle_migrations')).toBeGreaterThan(29)
    const keepAll = {
      keep_contacts: 1, keep_health: 1, keep_consents: 1, keep_documents: 1, keep_care_type: 1, keep_key_educator: 1,
    }
    expect(sqlite.prepare(`SELECT child_id, group_id, from_date, keep_contacts, keep_health, keep_consents, keep_documents,
      keep_care_type, keep_key_educator, applied_at, created_by, created_at FROM child_group_changes ORDER BY child_id`).all()).toEqual([
      { child_id: 1, group_id: 1, from_date: null, ...keepAll, applied_at: '2026-01-01T00:00:00.000Z', created_by: null, created_at: '2026-01-01T00:00:00.000Z' },
      { child_id: 2, group_id: 2, from_date: null, ...keepAll, applied_at: '2025-06-01T09:00:00.000Z', created_by: null, created_at: '2025-06-01T09:00:00.000Z' },
      { child_id: 3, group_id: null, from_date: null, ...keepAll, applied_at: '2026-10-01T12:00:00.000Z', created_by: null, created_at: '2026-10-01T12:00:00.000Z' },
      { child_id: 4, group_id: 3, from_date: null, ...keepAll, applied_at: '2026-09-15T07:30:00.000Z', created_by: null, created_at: '2026-09-15T07:30:00.000Z' },
    ])
    // The children keep everything; the new marks start out empty (the contract mark comes with 0030_school_children,
    // the day of a move into the facility with 0031_child_facility_since).
    const reviewColumns = ['contacts_review_since', 'health_review_since', 'consents_review_since', 'documents_review_since',
      'care_type_review_since', 'key_educator_review_since', 'contract_review_since']
    const laterColumns = [...reviewColumns, 'facility_since', ...NEW_CONSENT_COLUMNS]
    const childrenAfter = sqlite.prepare('SELECT * FROM children ORDER BY id').all() as Record<string, unknown>[]
    expect(childrenAfter.map(row => Object.fromEntries(Object.entries(row).filter(([column]) => !laterColumns.includes(column)))))
      .toEqual(childrenBefore)
    for (const row of childrenAfter) expect(reviewColumns.map(column => row[column])).toEqual([null, null, null, null, null, null, null])
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)

    // One entry per child and day and one start entry; a deleted group empties the entry, a deleted child takes its entries along.
    const insert = sqlite.prepare('INSERT INTO child_group_changes (child_id, group_id, from_date, created_at) VALUES (?, ?, ?, ?)')
    insert.run(1, 2, '2027-01-01', 'now')
    expect(() => insert.run(1, 1, '2027-01-01', 'now')).toThrow(/UNIQUE/)
    expect(() => insert.run(1, 1, null, 'now')).toThrow(/UNIQUE/)
    expect(() => insert.run(99, 1, '2027-01-01', 'now')).toThrow(/FOREIGN KEY/)
    expect(() => insert.run(1, 99, '2027-02-01', 'now')).toThrow(/FOREIGN KEY/)
    sqlite.exec('UPDATE children SET group_id = NULL WHERE group_id = 3')
    sqlite.exec('DELETE FROM groups WHERE id = 3')
    expect(sqlite.prepare('SELECT group_id FROM child_group_changes WHERE child_id = 4').all()).toEqual([{ group_id: null }])
    sqlite.exec('DELETE FROM children WHERE id = 1')
    expect(sqlite.prepare('SELECT DISTINCT child_id FROM child_group_changes ORDER BY child_id').all())
      .toEqual([{ child_id: 2 }, { child_id: 3 }, { child_id: 4 }])
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('flags the type "Betreuungsvertrag" of every facility as the care contract and leaves the new switches off', () => {
    const { db, sqlite } = databaseAt('0029')
    expect(count(sqlite, '__drizzle_migrations')).toBe(30)
    sqlite.exec(`
      INSERT INTO facilities (id, name) VALUES (2, 'Krippe'), (3, 'Hort');
      INSERT INTO document_types (facility_id, name, important, required, sort_order) VALUES
        (2, 'Betreuungsvertrag', 1, 1, 0), (2, 'Sonstiges', 0, 0, 1), (3, 'Vertrag', 1, 1, 0);
      INSERT INTO groups (id, facility_id, name, sort_order, capacity) VALUES (1, 1, 'Bären', 0, 20), (2, 2, 'Wichtel', 0, NULL);
      INSERT INTO children (id, facility_id, group_id, last_name, first_name, birth_date, admission_status, health_review_since, created_at) VALUES
        (1, 1, 1, 'Meier', 'Lena', '2021-06-30', 'contract', '2026-10-01', '2026-01-01T00:00:00.000Z');
      INSERT INTO child_group_changes (child_id, group_id, from_date, applied_at, created_at) VALUES
        (1, 1, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
        (1, NULL, '2027-03-15', NULL, '2026-10-13T08:00:00.000Z');
    `)
    const before = {
      types: sqlite.prepare('SELECT id, facility_id, name, important, required, confidential_default, sort_order FROM document_types ORDER BY id').all(),
      children: withoutOldConsent(sqlite.prepare('SELECT * FROM children ORDER BY id').all()),
      changes: sqlite.prepare('SELECT * FROM child_group_changes ORDER BY id').all(),
      groups: sqlite.prepare('SELECT * FROM groups ORDER BY id').all(),
      facilities: sqlite.prepare('SELECT * FROM facilities ORDER BY id').all(),
    }

    migrateDb(db, MIGRATIONS)

    expect(count(sqlite, '__drizzle_migrations')).toBeGreaterThan(30)
    // Exactly the types named "Betreuungsvertrag" (facilities 1 and 2); facility 3 has none of that name.
    expect(sqlite.prepare('SELECT facility_id, name FROM document_types WHERE care_contract = 1 ORDER BY facility_id').all())
      .toEqual([{ facility_id: 1, name: 'Betreuungsvertrag' }, { facility_id: 2, name: 'Betreuungsvertrag' }])
    expect(count(sqlite, 'document_types')).toBe(10)
    expect(sqlite.prepare('SELECT id, facility_id, name, important, required, confidential_default, sort_order FROM document_types ORDER BY id').all())
      .toEqual(before.types)
    // Nobody is deregistered automatically and no group is for school children until the Träger says so.
    expect(sqlite.prepare('SELECT id, auto_leave_school_children FROM facilities ORDER BY id').all()).toEqual([
      { id: 1, auto_leave_school_children: 0 }, { id: 2, auto_leave_school_children: 0 }, { id: 3, auto_leave_school_children: 0 },
    ])
    expect(sqlite.prepare('SELECT id, for_school_children FROM groups ORDER BY id').all())
      .toEqual([{ id: 1, for_school_children: 0 }, { id: 2, for_school_children: 0 }])
    expect(sqlite.prepare('SELECT child_id, from_date, new_contract FROM child_group_changes ORDER BY id').all()).toEqual([
      { child_id: 1, from_date: null, new_contract: 0 }, { child_id: 1, from_date: '2027-03-15', new_contract: 0 },
    ])
    expect(sqlite.prepare('SELECT id, health_review_since, contract_review_since FROM children').all())
      .toEqual([{ id: 1, health_review_since: '2026-10-01', contract_review_since: null }])
    // Every existing row keeps its values.
    const without = (rows: unknown[], ...columns: string[]) =>
      (rows as Record<string, unknown>[]).map(row => Object.fromEntries(Object.entries(row).filter(([name]) => !columns.includes(name))))
    // (facility_since comes with the later 0031_child_facility_since.)
    expect(without(sqlite.prepare('SELECT * FROM children ORDER BY id').all(), 'contract_review_since', 'facility_since', ...NEW_CONSENT_COLUMNS)).toEqual(before.children)
    expect(without(sqlite.prepare('SELECT * FROM child_group_changes ORDER BY id').all(), 'new_contract')).toEqual(before.changes)
    // (the minimum counts come with the later 0038_opening_hours, the colour with 0039_group_colors.)
    expect(without(sqlite.prepare('SELECT * FROM groups ORDER BY id').all(), 'for_school_children', 'min_at_opening', 'min_at_closing', 'color',
      ...REMINDER_COLUMNS)).toEqual(before.groups)
    // (the tablet settings come with the later 0032_tablet_children, state and assumption_day with 0033_facility_state,
    // the attendance settings with 0034_child_attendance and 0035_attendance_since.)
    expect(without(sqlite.prepare('SELECT * FROM facilities ORDER BY id').all(), 'auto_leave_school_children',
      'tablet_lock_minutes', 'tablet_show_waitlist', 'tablet_show_future_contracts', 'state', 'assumption_day',
      'snack_time', 'lunch_time', 'record_brought_by', 'attendance_since', 'min_at_opening', 'min_at_closing', ...LATER_FACILITY_COLUMNS))
      .toEqual(before.facilities)
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('adds the day a record was moved into its facility, empty for every existing child', () => {
    const { db, sqlite } = databaseAt('0030')
    expect(count(sqlite, '__drizzle_migrations')).toBe(31)
    sqlite.exec(`
      INSERT INTO facilities (id, name) VALUES (2, 'Krippe');
      INSERT INTO children (id, facility_id, last_name, first_name, birth_date, entry_date, admission_status, left_on, created_at) VALUES
        (1, 1, 'Meier', 'Lena', '2022-03-15', '2025-09-01', 'contract', NULL, '2026-01-01T00:00:00.000Z'),
        (2, 2, 'Kurz', 'Ben', '2021-05-01', '2024-09-01', 'contract', '2026-08-31', '2025-06-01T09:00:00.000Z');
    `)
    const before = withoutOldConsent(sqlite.prepare('SELECT * FROM children ORDER BY id').all())

    migrateDb(db, MIGRATIONS)

    expect(count(sqlite, '__drizzle_migrations')).toBeGreaterThan(31)
    const after = sqlite.prepare('SELECT * FROM children ORDER BY id').all() as Record<string, unknown>[]
    // Nobody counts as moved: every child is counted from its contract start, as before.
    expect(after.map(row => row.facility_since)).toEqual([null, null])
    expect(after.map(({ facility_since: _, consent_signal_photos: _s, consent_insect_repellent: _i, ...rest }) => rest)).toEqual(before)
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('0032 adds the tablet columns with defaults to existing facilities', () => {
    const { db, sqlite } = databaseAt('0031')
    expect(count(sqlite, '__drizzle_migrations')).toBe(32)
    sqlite.exec('INSERT INTO facilities (id, name) VALUES (2, \'Krippe\')')
    const before = sqlite.prepare('SELECT * FROM facilities ORDER BY id').all()

    migrateDb(db, MIGRATIONS)

    expect(count(sqlite, '__drizzle_migrations')).toBeGreaterThan(32)
    expect(sqlite.prepare('SELECT id, tablet_lock_minutes, tablet_show_waitlist, tablet_show_future_contracts FROM facilities ORDER BY id').all())
      .toEqual([
        { id: 1, tablet_lock_minutes: 2, tablet_show_waitlist: 0, tablet_show_future_contracts: 0 },
        { id: 2, tablet_lock_minutes: 2, tablet_show_waitlist: 0, tablet_show_future_contracts: 0 },
      ])
    // (state and assumption_day come with the later 0033_facility_state, the attendance settings with 0034 and 0035.)
    const columns = [
      'tablet_lock_minutes', 'tablet_show_waitlist', 'tablet_show_future_contracts', 'state', 'assumption_day',
      'snack_time', 'lunch_time', 'record_brought_by', 'attendance_since', 'min_at_opening', 'min_at_closing', ...LATER_FACILITY_COLUMNS,
    ]
    expect((sqlite.prepare('SELECT * FROM facilities ORDER BY id').all() as Record<string, unknown>[])
      .map(row => Object.fromEntries(Object.entries(row).filter(([column]) => !columns.includes(column))))).toEqual(before)
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('0033 gives every existing facility the state BW and the Bavaria flag', () => {
    const { db, sqlite } = databaseAt('0032')
    expect(count(sqlite, '__drizzle_migrations')).toBe(33)
    sqlite.exec('INSERT INTO facilities (id, name, school_cutoff_month, school_cutoff_day) VALUES (2, \'Krippe\', 9, 30)')
    const before = sqlite.prepare('SELECT * FROM facilities ORDER BY id').all()

    migrateDb(db, MIGRATIONS)

    expect(count(sqlite, '__drizzle_migrations')).toBeGreaterThan(33)
    expect(sqlite.prepare('SELECT id, state, assumption_day FROM facilities ORDER BY id').all()).toEqual([
      { id: 1, state: 'BW', assumption_day: 1 }, { id: 2, state: 'BW', assumption_day: 1 },
    ])
    // (the attendance settings come with the later 0034_child_attendance and 0035_attendance_since.)
    const columns = ['state', 'assumption_day', 'snack_time', 'lunch_time', 'record_brought_by', 'attendance_since', 'min_at_opening', 'min_at_closing',
      ...LATER_FACILITY_COLUMNS]
    expect((sqlite.prepare('SELECT * FROM facilities ORDER BY id').all() as Record<string, unknown>[])
      .map(row => Object.fromEntries(Object.entries(row).filter(([column]) => !columns.includes(column))))).toEqual(before)
    // A facility created without naming them gets the defaults too.
    sqlite.exec('INSERT INTO facilities (id, name) VALUES (3, \'Hort\')')
    expect(sqlite.prepare('SELECT state, assumption_day FROM facilities WHERE id = 3').get()).toEqual({ state: 'BW', assumption_day: 1 })
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('0034 adds the attendance tables and the facility columns with defaults', () => {
    const { db, sqlite } = databaseAt('0033')
    expect(count(sqlite, '__drizzle_migrations')).toBe(34)
    sqlite.exec('INSERT INTO facilities (id, name, state) VALUES (2, \'Krippe\', \'BY\')')
    const before = sqlite.prepare('SELECT * FROM facilities ORDER BY id').all()

    migrateDb(db, MIGRATIONS)

    expect(count(sqlite, '__drizzle_migrations')).toBeGreaterThan(34)
    expect(sqlite.prepare('SELECT id, record_brought_by FROM facilities ORDER BY id').all())
      .toEqual([{ id: 1, record_brought_by: 0 }, { id: 2, record_brought_by: 0 }])
    // The default meal times (snack_time, lunch_time) live on as meals since 0040; 0041 drops the columns.
    expect(sqlite.prepare('SELECT m.facility_id, v.name, v.time FROM meals m JOIN meal_versions v ON v.meal_id = m.id ORDER BY m.facility_id, v.time').all())
      .toEqual([
        { facility_id: 1, name: 'Snack', time: 570 }, { facility_id: 1, name: 'Mittagessen', time: 720 },
        { facility_id: 2, name: 'Snack', time: 570 }, { facility_id: 2, name: 'Mittagessen', time: 720 },
      ])
    // (attendance_since comes with the later 0035_attendance_since.)
    const columns = ['snack_time', 'lunch_time', 'record_brought_by', 'attendance_since', 'min_at_opening', 'min_at_closing', ...LATER_FACILITY_COLUMNS]
    expect((sqlite.prepare('SELECT * FROM facilities ORDER BY id').all() as Record<string, unknown>[])
      .map(row => Object.fromEntries(Object.entries(row).filter(([column]) => !columns.includes(column))))).toEqual(before)
    const tables = (sqlite.prepare('SELECT name FROM sqlite_master WHERE type = \'table\'').all() as { name: string }[]).map(row => row.name)
    for (const table of ['child_attendance_days', 'child_attendance_stays', 'child_pickup_announcements', 'child_attendance_months', 'child_attendance_changes']) {
      expect(tables).toContain(table)
    }
    // One day row per child and date; the day's group goes when the group is deleted, the day stays.
    sqlite.exec(`
      INSERT INTO groups (id, facility_id, name) VALUES (1, 1, 'Bären');
      INSERT INTO children (id, facility_id, last_name, first_name, birth_date, entry_date, created_at)
        VALUES (1, 1, 'Meier', 'Lena', '2022-03-15', '2025-09-01', '2026-01-01T00:00:00.000Z');
      INSERT INTO child_attendance_days (id, child_id, date, group_id) VALUES (1, 1, '2026-10-14', 1);
    `)
    expect(sqlite.prepare('SELECT planned_pickup, brought_by, absence, note FROM child_attendance_days').get())
      .toEqual({ planned_pickup: null, brought_by: '', absence: null, note: '' })
    expect(() => sqlite.exec('INSERT INTO child_attendance_days (child_id, date) VALUES (1, \'2026-10-14\')')).toThrow(/UNIQUE/)
    sqlite.exec('DELETE FROM groups WHERE id = 1')
    expect(sqlite.prepare('SELECT group_id FROM child_attendance_days').get()).toEqual({ group_id: null })
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('0035 adds an empty attendance start to existing facilities', () => {
    const { db, sqlite } = databaseAt('0034')
    expect(count(sqlite, '__drizzle_migrations')).toBe(35)
    sqlite.exec('INSERT INTO facilities (id, name, snack_time) VALUES (2, \'Krippe\', 600)')
    const before = sqlite.prepare('SELECT * FROM facilities ORDER BY id').all()

    migrateDb(db, MIGRATIONS)

    expect(count(sqlite, '__drizzle_migrations')).toBeGreaterThan(35)
    // Nothing was recorded anywhere yet: no earlier day counts as unexcused.
    expect(sqlite.prepare('SELECT id, attendance_since FROM facilities ORDER BY id').all())
      .toEqual([{ id: 1, attendance_since: null }, { id: 2, attendance_since: null }])
    // (the meal times go with the later 0041_meals_cleanup; Krippe's 10:00 became its Snack in 0040.)
    expect(withoutLaterFacilityColumns((sqlite.prepare('SELECT * FROM facilities ORDER BY id').all() as Record<string, unknown>[])
      .map(({ attendance_since: _, min_at_opening: __, min_at_closing: ___, ...rest }) => rest)))
      .toEqual((before as Record<string, unknown>[]).map(({ snack_time: _, lunch_time: __, ...rest }) => rest))
    expect(sqlite.prepare('SELECT v.time FROM meals m JOIN meal_versions v ON v.meal_id = m.id WHERE m.facility_id = 2 AND v.name = \'Snack\'').get())
      .toEqual({ time: 600 })
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('0036 marks every existing stay as picked up by a registered person', () => {
    const { db, sqlite } = databaseAt('0035')
    expect(count(sqlite, '__drizzle_migrations')).toBe(36)
    sqlite.exec(`
      INSERT INTO children (id, facility_id, last_name, first_name, birth_date, entry_date, created_at)
        VALUES (1, 1, 'Meier', 'Lena', '2022-03-15', '2025-09-01', '2026-01-01T00:00:00.000Z');
      INSERT INTO child_attendance_days (id, child_id, date) VALUES (1, 1, '2026-10-14');
      INSERT INTO child_attendance_stays (id, day_id, arrived, left, picked_up_by) VALUES (1, 1, 480, 600, 'Oma Erika'), (2, 1, 660, NULL, NULL);
    `)
    const before = sqlite.prepare('SELECT * FROM child_attendance_stays ORDER BY id').all()

    migrateDb(db, MIGRATIONS)

    expect(count(sqlite, '__drizzle_migrations')).toBeGreaterThan(36)
    expect(sqlite.prepare('SELECT id, picked_up_other, picked_up_confirmed_with FROM child_attendance_stays ORDER BY id').all()).toEqual([
      { id: 1, picked_up_other: 0, picked_up_confirmed_with: '' },
      { id: 2, picked_up_other: 0, picked_up_confirmed_with: '' },
    ])
    expect((sqlite.prepare('SELECT * FROM child_attendance_stays ORDER BY id').all() as Record<string, unknown>[])
      .map(({ picked_up_other: _, picked_up_confirmed_with: __, ...rest }) => rest)).toEqual(before)
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('0037 adds the group book tables, which go with their group', () => {
    const { db, sqlite } = databaseAt('0036')
    expect(count(sqlite, '__drizzle_migrations')).toBe(37)
    sqlite.exec('INSERT INTO groups (id, facility_id, name) VALUES (1, 1, \'Bären\'), (2, 1, \'Mäuse\')')
    const before = sqlite.prepare('SELECT * FROM groups ORDER BY id').all()

    migrateDb(db, MIGRATIONS)

    expect(count(sqlite, '__drizzle_migrations')).toBeGreaterThan(37)
    // (the minimum counts come with the later 0038_opening_hours, the colour with 0039_group_colors.)
    expect(withoutReminders((sqlite.prepare('SELECT * FROM groups ORDER BY id').all() as Record<string, unknown>[])
      .map(({ min_at_opening: _, min_at_closing: __, color: ___, ...rest }) => rest))).toEqual(before)
    const tables = (sqlite.prepare('SELECT name FROM sqlite_master WHERE type = \'table\'').all() as { name: string }[]).map(row => row.name)
    for (const table of ['group_read_access', 'group_week_notes', 'group_day_notes', 'group_book_changes']) expect(tables).toContain(table)

    sqlite.exec(`
      INSERT INTO group_read_access (group_id, readable_group_id) VALUES (1, 2), (2, 1);
      INSERT INTO group_week_notes (group_id, week_start, updated_at, updated_by_name)
        VALUES (1, '2026-10-12', '2026-10-16T08:00:00.000Z', 'Anna'), (2, '2026-10-12', '2026-10-16T08:00:00.000Z', 'Anna');
      INSERT INTO group_day_notes (group_id, date, text, updated_at, updated_by_name)
        VALUES (1, '2026-10-12', 'Herbstbasteln', '2026-10-16T08:00:00.000Z', 'Anna'), (2, '2026-10-12', 'Ausflug', '2026-10-16T08:00:00.000Z', 'Anna');
      INSERT INTO group_book_changes (group_id, field, date, before, after, changed_at, changed_by_name)
        VALUES (1, 'day', '2026-10-12', '', 'Herbstbasteln', '2026-10-16T08:00:00.000Z', 'Anna'),
               (2, 'week', '2026-10-12', '', 'Herbst', '2026-10-16T08:00:00.000Z', 'Anna');
    `)
    // The week's theme starts empty; one theme per group and week, one text per group and day, one grant per pair.
    expect(sqlite.prepare('SELECT text FROM group_week_notes WHERE group_id = 1').get()).toEqual({ text: '' })
    expect(() => sqlite.exec('INSERT INTO group_week_notes (group_id, week_start, updated_at, updated_by_name) VALUES (1, \'2026-10-12\', \'x\', \'Anna\')')).toThrow(/UNIQUE/)
    expect(() => sqlite.exec('INSERT INTO group_day_notes (group_id, date, text, updated_at, updated_by_name) VALUES (1, \'2026-10-12\', \'\', \'x\', \'Anna\')')).toThrow(/UNIQUE/)
    expect(() => sqlite.exec('INSERT INTO group_read_access (group_id, readable_group_id) VALUES (1, 2)')).toThrow(/UNIQUE/)

    // Deleting a group takes its rows of every table along, also the grants that name it as readable.
    sqlite.exec('DELETE FROM groups WHERE id = 2')
    expect(sqlite.prepare('SELECT group_id, readable_group_id FROM group_read_access').all()).toEqual([])
    for (const table of ['group_week_notes', 'group_day_notes', 'group_book_changes']) {
      expect(sqlite.prepare(`SELECT group_id FROM ${table}`).all(), table).toEqual([{ group_id: 1 }])
    }
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('0038 adds opening hours: existing rules get every weekday, minimum counts 1, no hours', () => {
    const { db, sqlite } = databaseAt('0037')
    expect(count(sqlite, '__drizzle_migrations')).toBe(38)
    sqlite.exec(`
      INSERT INTO groups (id, facility_id, name) VALUES (1, 1, 'Bären');
      INSERT INTO coverage_rules (label, start, min_count, active, facility_id) VALUES ('Früh', 420, 1, 1, 1), ('Spät', 900, 2, 1, 1);
    `)
    const rulesBefore = sqlite.prepare('SELECT id, label, start, min_count FROM coverage_rules ORDER BY id').all()

    migrateDb(db, MIGRATIONS)

    expect(count(sqlite, '__drizzle_migrations')).toBeGreaterThan(38)
    expect(sqlite.prepare('SELECT id, label, start, min_count FROM coverage_rules ORDER BY id').all()).toEqual(rulesBefore)
    expect(sqlite.prepare('SELECT weekdays FROM coverage_rules').all()).toEqual([{ weekdays: 31 }, { weekdays: 31 }])
    expect(sqlite.prepare('SELECT min_at_opening, min_at_closing FROM facilities').all()).toEqual([{ min_at_opening: 1, min_at_closing: 1 }])
    expect(sqlite.prepare('SELECT min_at_opening, min_at_closing FROM groups').all()).toEqual([{ min_at_opening: 1, min_at_closing: 1 }])
    expect(count(sqlite, 'opening_hours')).toBe(0)

    // One row per facility and weekday although group_id is NULL, one per group and weekday.
    const insert = (groupId: number | null, weekday: number) => sqlite.prepare(
      'INSERT INTO opening_hours (facility_id, group_id, weekday, open, close) VALUES (1, ?, ?, 420, 990)').run(groupId, weekday)
    insert(null, 0)
    insert(1, 0)
    expect(() => insert(null, 0)).toThrow(/UNIQUE/)
    expect(() => insert(1, 0)).toThrow(/UNIQUE/)
    expect(sqlite.prepare('SELECT closed FROM opening_hours WHERE group_id IS NULL').all()).toEqual([{ closed: 0 }])

    // Hours go with their group and their facility.
    sqlite.exec('DELETE FROM groups WHERE id = 1')
    expect(sqlite.prepare('SELECT group_id FROM opening_hours').all()).toEqual([{ group_id: null }])
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('0039 adds the group colour: existing groups keep everything and get no colour', () => {
    const { db, sqlite } = databaseAt('0038')
    expect(count(sqlite, '__drizzle_migrations')).toBe(39)
    sqlite.exec(`
      INSERT INTO facilities (id, name) VALUES (2, 'Krippe');
      INSERT INTO groups (id, facility_id, name, sort_order, capacity) VALUES (1, 1, 'Bären', 0, 12), (2, 2, 'Wichtel', 0, NULL);
    `)

    migrateDb(db, MIGRATIONS)

    expect(count(sqlite, '__drizzle_migrations')).toBeGreaterThan(39)
    expect(sqlite.prepare('SELECT id, name, capacity, color FROM groups ORDER BY id').all()).toEqual([
      { id: 1, name: 'Bären', capacity: 12, color: null },
      { id: 2, name: 'Wichtel', capacity: null, color: null },
    ])
    sqlite.exec(`INSERT INTO groups (id, facility_id, name) VALUES (3, 1, 'Mäuse')`)
    expect(sqlite.prepare('SELECT color FROM groups WHERE id = 3').get()).toEqual({ color: null })
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('0040 moves the two fixed meals into meals per facility and keeps only the ticks set by hand', () => {
    const { db, sqlite } = databaseAt('0039')
    expect(count(sqlite, '__drizzle_migrations')).toBe(40)
    sqlite.exec(`
      UPDATE facilities SET snack_time = 555, lunch_time = 705 WHERE id = 1;
      INSERT INTO facilities (id, name) VALUES (2, 'Krippe');
      INSERT INTO children (id, facility_id, last_name, first_name, birth_date, created_at) VALUES
        (1, 1, 'Meier', 'Lena', '2022-03-15', '2026-01-01T00:00:00.000Z'),
        (2, 2, 'Kurz', 'Ben', '2023-05-01', '2026-01-01T00:00:00.000Z');
      INSERT INTO child_attendance_days (id, child_id, date, snack, lunch) VALUES
        (1, 1, '2026-10-12', NULL, NULL), (2, 1, '2026-10-13', 1, 0), (3, 1, '2026-10-14', 0, NULL),
        (4, 2, '2026-10-13', NULL, 1);
    `)
    const daysBefore = sqlite.prepare('SELECT * FROM child_attendance_days ORDER BY id').all()

    migrateDb(db, MIGRATIONS)

    expect(count(sqlite, '__drizzle_migrations')).toBeGreaterThan(40)
    // (snack and lunch go with the later 0041_meals_cleanup.)
    expect(sqlite.prepare('SELECT * FROM child_attendance_days ORDER BY id').all())
      .toEqual((daysBefore as Record<string, unknown>[]).map(({ snack: _, lunch: __, ...rest }) => rest))
    expect(sqlite.prepare(`
      SELECT m.facility_id, v.valid_from, v.name, v.time, v.removed FROM meals m JOIN meal_versions v ON v.meal_id = m.id
      ORDER BY m.facility_id, v.time`).all()).toEqual([
      { facility_id: 1, valid_from: null, name: 'Snack', time: 555, removed: 0 },
      { facility_id: 1, valid_from: null, name: 'Mittagessen', time: 705, removed: 0 },
      { facility_id: 2, valid_from: null, name: 'Snack', time: 570, removed: 0 },
      { facility_id: 2, valid_from: null, name: 'Mittagessen', time: 720, removed: 0 },
    ])
    expect(sqlite.prepare(`
      SELECT a.day_id, m.facility_id, v.name, a.value FROM child_attendance_meals a
        JOIN meals m ON m.id = a.meal_id JOIN meal_versions v ON v.meal_id = m.id
      ORDER BY a.day_id, v.time`).all()).toEqual([
      { day_id: 2, facility_id: 1, name: 'Snack', value: 1 },
      { day_id: 2, facility_id: 1, name: 'Mittagessen', value: 0 },
      { day_id: 3, facility_id: 1, name: 'Snack', value: 0 },
      { day_id: 4, facility_id: 2, name: 'Mittagessen', value: 1 },
    ])

    // One tick per day and meal; ticks go with their day, versions and ticks with their meal, meals with their facility.
    const lunch = (sqlite.prepare('SELECT meal_id AS id FROM meal_versions v JOIN meals m ON m.id = v.meal_id WHERE m.facility_id = 1 AND v.name = \'Mittagessen\'').get() as { id: number }).id
    expect(() => sqlite.prepare('INSERT INTO child_attendance_meals (day_id, meal_id, value) VALUES (2, ?, 1)').run(lunch)).toThrow(/UNIQUE/)
    expect(() => sqlite.prepare('INSERT INTO meal_versions (meal_id, valid_from, name, time) VALUES (?, \'2026-11-02\', \'Mittag\', 720)').run(lunch)).not.toThrow()
    expect(() => sqlite.prepare('INSERT INTO meal_versions (meal_id, valid_from, name, time) VALUES (?, \'2026-11-02\', \'Mittag\', 730)').run(lunch)).toThrow(/UNIQUE/)
    sqlite.exec('DELETE FROM child_attendance_days WHERE id = 3')
    expect(count(sqlite, 'child_attendance_meals')).toBe(3)
    sqlite.prepare('DELETE FROM meals WHERE id = ?').run(lunch)
    expect(sqlite.prepare('SELECT day_id FROM child_attendance_meals ORDER BY day_id').all()).toEqual([{ day_id: 2 }, { day_id: 4 }])
    expect(sqlite.prepare('SELECT count(*) AS n FROM meal_versions WHERE meal_id = ?').get(lunch)).toEqual({ n: 0 })
    sqlite.exec('DELETE FROM children WHERE id = 2; DELETE FROM facilities WHERE id = 2')
    expect(count(sqlite, 'meals')).toBe(1)
    expect(count(sqlite, 'meal_versions')).toBe(1)
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('0041 drops the old meal columns and keeps every day, stay, tick and facility with its references', () => {
    const { db, sqlite } = databaseAt('0040')
    expect(count(sqlite, '__drizzle_migrations')).toBe(41)
    const mealOf = (name: string) => (sqlite.prepare('SELECT meal_id AS id FROM meal_versions v JOIN meals m ON m.id = v.meal_id WHERE m.facility_id = 1 AND v.name = ?').get(name) as { id: number }).id
    sqlite.exec(`
      UPDATE facilities SET record_brought_by = 1, attendance_since = '2026-10-01' WHERE id = 1;
      INSERT INTO facilities (id, name, snack_time, lunch_time) VALUES (2, 'Krippe', 600, 735);
      INSERT INTO meals (id, facility_id) VALUES (100, 2);
      INSERT INTO meal_versions (meal_id, valid_from, name, time) VALUES (100, NULL, 'Snack', 600);
      INSERT INTO groups (id, facility_id, name) VALUES (1, 1, 'Bären');
      INSERT INTO children (id, facility_id, last_name, first_name, birth_date, created_at) VALUES
        (1, 1, 'Meier', 'Lena', '2022-03-15', '2026-01-01T00:00:00.000Z');
      INSERT INTO child_attendance_days (id, child_id, date, group_id, planned_pickup, brought_by, absence, note, snack, lunch) VALUES
        (1, 1, '2026-10-13', 1, 900, 'Mama', NULL, 'müde', 1, NULL), (2, 1, '2026-10-14', NULL, NULL, '', 'sick', '', NULL, 0);
      INSERT INTO child_attendance_stays (id, day_id, arrived, left, picked_up_by) VALUES (1, 1, 480, 900, 'Anna Meier');
      INSERT INTO child_pickup_announcements (id, day_id, name, announced_by) VALUES (1, 1, 'Oma Erika', 'Mama');
    `)
    sqlite.prepare('INSERT INTO child_attendance_meals (id, day_id, meal_id, value) VALUES (1, 1, ?, 1), (2, 2, ?, 0)').run(mealOf('Snack'), mealOf('Mittagessen'))
    const all = (table: string) => sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all() as Record<string, unknown>[]
    const without = (rows: Record<string, unknown>[], ...columns: string[]) =>
      rows.map(row => Object.fromEntries(Object.entries(row).filter(([name]) => !columns.includes(name))))
    const before = {
      facilities: without(all('facilities'), 'snack_time', 'lunch_time'),
      days: without(all('child_attendance_days'), 'snack', 'lunch'),
      stays: all('child_attendance_stays'), announcements: all('child_pickup_announcements'), ticks: all('child_attendance_meals'),
      meals: all('meals'), versions: all('meal_versions'),
    }

    migrateDb(db, MIGRATIONS)

    expect(count(sqlite, '__drizzle_migrations')).toBeGreaterThan(41)
    const columns = (table: string) => (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(row => row.name)
    expect(columns('facilities')).not.toContain('snack_time')
    expect(columns('facilities')).not.toContain('lunch_time')
    expect(columns('child_attendance_days')).not.toContain('snack')
    expect(columns('child_attendance_days')).not.toContain('lunch')
    // (the reminder settings come with the later 0044_reminders.)
    expect(withoutLaterFacilityColumns(all('facilities'))).toEqual(before.facilities)
    expect(all('child_attendance_days')).toEqual(before.days)
    expect(all('child_attendance_stays')).toEqual(before.stays)
    expect(all('child_pickup_announcements')).toEqual(before.announcements)
    expect(all('child_attendance_meals')).toEqual(before.ticks)
    expect(all('meals')).toEqual(before.meals)
    expect(all('meal_versions')).toEqual(before.versions)
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)

    // The days keep their unique index and their references: one row per child and date, the group goes, the day stays;
    // a deleted day takes its stays, announcements and ticks along; a deleted child its days.
    expect(() => sqlite.exec('INSERT INTO child_attendance_days (child_id, date) VALUES (1, \'2026-10-13\')')).toThrow(/UNIQUE/)
    expect(() => sqlite.exec('INSERT INTO child_attendance_days (child_id, date) VALUES (99, \'2026-10-15\')')).toThrow(/FOREIGN KEY/)
    sqlite.exec('DELETE FROM groups WHERE id = 1')
    expect(sqlite.prepare('SELECT group_id FROM child_attendance_days WHERE id = 1').get()).toEqual({ group_id: null })
    sqlite.exec('DELETE FROM child_attendance_days WHERE id = 1')
    expect([count(sqlite, 'child_attendance_stays'), count(sqlite, 'child_pickup_announcements'), count(sqlite, 'child_attendance_meals')])
      .toEqual([0, 0, 1])
    sqlite.exec('DELETE FROM children WHERE id = 1')
    expect([count(sqlite, 'child_attendance_days'), count(sqlite, 'child_attendance_meals')]).toEqual([0, 0])
    // Facilities keep their references too: a group of an unknown facility is refused, a facility's meals go with it.
    expect(() => sqlite.exec('INSERT INTO groups (facility_id, name) VALUES (99, \'Igel\')')).toThrow(/FOREIGN KEY/)
    sqlite.exec('DELETE FROM facilities WHERE id = 2')
    expect(sqlite.prepare('SELECT DISTINCT facility_id FROM meals').all()).toEqual([{ facility_id: 1 }])
    expect(sqlite.prepare('SELECT count(*) AS n FROM meal_versions WHERE meal_id = 100').get()).toEqual({ n: 0 })
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('0042 merges the two WhatsApp photo consents (the stricter answer wins) and adds the Signal and insect repellent consents', () => {
    const { db, sqlite } = databaseAt('0041')
    expect(count(sqlite, '__drizzle_migrations')).toBe(42)
    // (whatsapp_photos, photos_whatsapp) -> merged whatsapp_photos
    const cases: [number | null, number | null, number | null][] = [
      [null, 1, 1], [1, null, 1], [1, 0, 0], [0, 1, 0], [null, null, null], [1, 1, 1], [0, null, 0], [null, 0, 0], [0, 0, 0],
    ]
    const insert = sqlite.prepare(`INSERT INTO children (id, facility_id, last_name, first_name, birth_date, created_at,
      consent_whatsapp_photos, consent_photos_whatsapp, consent_photos_display) VALUES (?, 1, 'Kind', ?, '2022-03-15', '2026-01-01T00:00:00.000Z', ?, ?, 1)`)
    cases.forEach(([whatsapp, photos], index) => insert.run(index + 1, `K${index + 1}`, whatsapp, photos))

    migrateDb(db, MIGRATIONS)

    expect(count(sqlite, '__drizzle_migrations')).toBeGreaterThan(42)
    const columns = (sqlite.prepare('PRAGMA table_info(children)').all() as { name: string }[]).map(row => row.name)
    expect(columns).not.toContain('consent_photos_whatsapp')
    expect(columns).toEqual(expect.arrayContaining(['consent_signal_photos', 'consent_insect_repellent', 'consent_whatsapp_photos']))
    const rows = sqlite.prepare('SELECT id, consent_whatsapp_photos AS merged, consent_signal_photos AS signal, consent_insect_repellent AS insect, consent_photos_display AS display FROM children ORDER BY id').all()
    expect(rows).toEqual(cases.map(([, , merged], index) => ({ id: index + 1, merged, signal: null, insect: null, display: 1 })))
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('0043 turns the blue group colour into light brown and leaves every other colour as it is', () => {
    const { db, sqlite } = databaseAt('0042')
    expect(count(sqlite, '__drizzle_migrations')).toBe(43)
    sqlite.exec(`
      INSERT INTO facilities (id, name) VALUES (2, 'Krippe');
      INSERT INTO groups (id, facility_id, name, sort_order, color) VALUES
        (1, 1, 'Bären', 0, 'blue'), (2, 1, 'Mäuse', 1, 'teal'), (3, 1, 'Eulen', 2, NULL), (4, 2, 'Wichtel', 0, 'blue');
    `)

    migrateDb(db, MIGRATIONS)

    expect(count(sqlite, '__drizzle_migrations')).toBeGreaterThan(43)
    expect(sqlite.prepare('SELECT id, name, color FROM groups ORDER BY id').all()).toEqual([
      { id: 1, name: 'Bären', color: 'brown' },
      { id: 2, name: 'Mäuse', color: 'teal' },
      { id: 3, name: 'Eulen', color: null },
      { id: 4, name: 'Wichtel', color: 'brown' },
    ])
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('0044 adds the reminder settings with their defaults, the staff birthday and the documentation log', () => {
    const { db, sqlite } = databaseAt('0043')
    expect(count(sqlite, '__drizzle_migrations')).toBe(44)
    sqlite.exec(`
      INSERT INTO facilities (id, name) VALUES (2, 'Krippe');
      INSERT INTO groups (id, facility_id, name, sort_order, color) VALUES (1, 1, 'Bären', 0, 'teal'), (2, 2, 'Wichtel', 0, NULL);
      INSERT INTO employees (id, facility_id, name) VALUES (1, 1, 'Anna');
    `)

    migrateDb(db, MIGRATIONS)

    expect(count(sqlite, '__drizzle_migrations')).toBeGreaterThan(44)
    expect(sqlite.prepare('SELECT id, name, color, doc_mode, doc_interval_months, doc_lead_weeks FROM groups ORDER BY id').all()).toEqual([
      { id: 1, name: 'Bären', color: 'teal', doc_mode: 'off', doc_interval_months: 12, doc_lead_weeks: 2 },
      { id: 2, name: 'Wichtel', color: null, doc_mode: 'off', doc_interval_months: 12, doc_lead_weeks: 2 },
    ])
    expect(sqlite.prepare(`SELECT id, doc_mode, doc_interval_months, doc_lead_weeks, birthday_lead_days,
      staff_birthday_lead_days, leaving_lead_weeks FROM facilities ORDER BY id`).all()).toEqual([1, 2].map(id => ({
      id, doc_mode: 'off', doc_interval_months: 12, doc_lead_weeks: 2, birthday_lead_days: 7, staff_birthday_lead_days: 7,
      leaving_lead_weeks: 4,
    })))
    expect(sqlite.prepare('SELECT id, name, birthday FROM employees').all()).toEqual([{ id: 1, name: 'Anna', birthday: null }])
    expect(count(sqlite, 'child_development_docs')).toBe(0)
    expect(sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'child_development_docs'`).all())
      .toEqual([{ name: 'child_development_docs_child' }])
    expect(sqlite.prepare('PRAGMA foreign_key_list(child_development_docs)').all()
      .map(fk => { const { table, from, on_delete } = fk as Record<string, string>; return { table, from, on_delete } })
      .sort((a, b) => a.from.localeCompare(b.from))).toEqual([
      { table: 'children', from: 'child_id', on_delete: 'CASCADE' },
      { table: 'employees', from: 'done_by_employee_id', on_delete: 'SET NULL' },
      { table: 'users', from: 'done_by_user_id', on_delete: 'SET NULL' },
    ])
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('0045 gives every documentation setting that is on „gilt seit“ the migration day, and none to those off', () => {
    const { db, sqlite } = databaseAt('0044')
    sqlite.exec(`
      INSERT INTO facilities (id, name, doc_mode) VALUES (2, 'Krippe', 'birthday');
      INSERT INTO groups (id, facility_id, name, sort_order, doc_mode) VALUES
        (1, 1, 'Bären', 0, 'interval'), (2, 1, 'Mäuse', 1, 'off'), (3, 2, 'Wichtel', 0, 'birthday');
    `)

    migrateDb(db, MIGRATIONS)

    const today = (sqlite.prepare(`SELECT date('now', 'localtime') AS d`).get() as { d: string }).d
    expect(sqlite.prepare('SELECT id, doc_since FROM facilities ORDER BY id').all())
      .toEqual([{ id: 1, doc_since: null }, { id: 2, doc_since: today }])
    expect(sqlite.prepare('SELECT id, doc_mode, doc_since FROM groups ORDER BY id').all()).toEqual([
      { id: 1, doc_mode: 'interval', doc_since: today },
      { id: 2, doc_mode: 'off', doc_since: null },
      { id: 3, doc_mode: 'birthday', doc_since: today },
    ])
  })

  it('0046 adds the facility maximum, empty for every existing facility, and keeps the group places', () => {
    const { db, sqlite } = databaseAt('0045')
    sqlite.exec(`
      INSERT INTO facilities (id, name) VALUES (2, 'Krippe');
      INSERT INTO groups (id, facility_id, name, sort_order, capacity) VALUES (1, 1, 'Bären', 0, 20), (2, 2, 'Wichtel', 0, NULL);
    `)
    const before = sqlite.prepare('SELECT * FROM facilities ORDER BY id').all()

    migrateDb(db, MIGRATIONS)

    expect(sqlite.prepare('SELECT id, capacity FROM facilities ORDER BY id').all())
      .toEqual([{ id: 1, capacity: null }, { id: 2, capacity: null }])
    expect((sqlite.prepare('SELECT * FROM facilities ORDER BY id').all() as Record<string, unknown>[])
      .map(({ capacity: _, mark_tolerance_minutes: _tolerance, mark_early_leave: _early, form_starters_seeded: _seeded, christmas_eve_half_leave: _half, ...rest }) => rest))
      .toEqual(before)
    expect(sqlite.prepare('SELECT id, capacity FROM groups ORDER BY id').all())
      .toEqual([{ id: 1, capacity: 20 }, { id: 2, capacity: null }])
    sqlite.exec(`INSERT INTO facilities (id, name) VALUES (3, 'Hort')`)
    expect(sqlite.prepare('SELECT capacity FROM facilities WHERE id = 3').get()).toEqual({ capacity: null })
  })

  it('0047 adds the empty parent meetings with their index and references, and keeps the children', () => {
    const { db, sqlite } = databaseAt('0046')
    sqlite.exec(`INSERT INTO children (id, facility_id, last_name, first_name, birth_date, created_at)
      VALUES (1, 1, 'Muster', 'Lena', '2022-03-15', '2026-01-01T00:00:00.000Z')`)
    const before = sqlite.prepare('SELECT * FROM children').all()

    migrateDb(db, MIGRATIONS)

    expect(sqlite.prepare('SELECT * FROM children').all()).toEqual(before)
    expect(count(sqlite, 'child_parent_meetings')).toBe(0)
    expect(sqlite.prepare('PRAGMA table_info(child_parent_meetings)').all()
      .map(column => { const { name, notnull, dflt_value } = column as Record<string, unknown>; return [name, notnull, dflt_value] }))
      .toEqual([
        ['id', 1, null], ['child_id', 1, null], ['date', 1, null], ['start', 1, null], ['end', 0, null], ['kind', 1, null],
        ['participants', 1, '\'\''], ['note', 1, '\'\''], ['created_at', 1, null], ['created_by_user_id', 0, null],
        ['created_by_employee_id', 0, null], ['created_by_name', 1, '\'\''], ['updated_at', 0, null], ['updated_by_name', 0, null],
      ])
    expect(sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'child_parent_meetings'`).all())
      .toEqual([{ name: 'child_parent_meetings_child' }])
    expect(sqlite.prepare('PRAGMA foreign_key_list(child_parent_meetings)').all()
      .map(fk => { const { table, from, on_delete } = fk as Record<string, string>; return { table, from, on_delete } })
      .sort((a, b) => a.from.localeCompare(b.from))).toEqual([
      { table: 'children', from: 'child_id', on_delete: 'CASCADE' },
      { table: 'employees', from: 'created_by_employee_id', on_delete: 'SET NULL' },
      { table: 'users', from: 'created_by_user_id', on_delete: 'SET NULL' },
    ])
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('0048 gives every existing facility the default tolerance of 5 minutes with early leaving marked', () => {
    const { db, sqlite } = databaseAt('0047')
    sqlite.exec(`INSERT INTO facilities (id, name, time_tracking_from) VALUES (2, 'Krippe', '2026-10-01')`)
    const before = sqlite.prepare('SELECT * FROM facilities ORDER BY id').all()

    migrateDb(db, MIGRATIONS)

    expect(sqlite.prepare('SELECT id, mark_tolerance_minutes, mark_early_leave FROM facilities ORDER BY id').all()).toEqual([
      { id: 1, mark_tolerance_minutes: 5, mark_early_leave: 1 }, { id: 2, mark_tolerance_minutes: 5, mark_early_leave: 1 },
    ])
    expect((sqlite.prepare('SELECT * FROM facilities ORDER BY id').all() as Record<string, unknown>[])
      .map(({ mark_tolerance_minutes: _tolerance, mark_early_leave: _early, form_starters_seeded: _seeded, christmas_eve_half_leave: _half, ...rest }) => rest))
      .toEqual(before)
  })

  it('0049 adds the empty print templates with their index and references, and keeps the facilities', () => {
    const { db, sqlite } = databaseAt('0048')
    sqlite.exec(`INSERT INTO facilities (id, name) VALUES (2, 'Krippe')`)
    const before = sqlite.prepare('SELECT * FROM facilities ORDER BY id').all()

    migrateDb(db, MIGRATIONS)

    expect((sqlite.prepare('SELECT * FROM facilities ORDER BY id').all() as Record<string, unknown>[])
      .map(({ form_starters_seeded: _seeded, christmas_eve_half_leave: _half, ...rest }) => rest)).toEqual(before)
    expect(count(sqlite, 'print_templates')).toBe(0)
    expect(sqlite.prepare('PRAGMA table_info(print_templates)').all()
      .map(column => { const { name, notnull } = column as Record<string, unknown>; return [name, notnull] }))
      .toEqual([
        ['id', 1], ['facility_id', 0], ['title', 1], ['category', 1], ['mime_type', 1], ['size', 1], ['data', 1],
        ['uploaded_by', 0], ['uploaded_at', 1], ['updated_at', 1],
      ])
    expect(sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'print_templates'`).all())
      .toEqual([{ name: 'print_templates_facility' }])
    expect(sqlite.prepare('PRAGMA foreign_key_list(print_templates)').all()
      .map(fk => { const { table, from, on_delete } = fk as Record<string, string>; return { table, from, on_delete } })
      .sort((a, b) => a.from.localeCompare(b.from))).toEqual([
      { table: 'facilities', from: 'facility_id', on_delete: 'CASCADE' },
      { table: 'users', from: 'uploaded_by', on_delete: 'SET NULL' },
    ])
  })

  it('0050 adds the staffing fields with their defaults and the empty overrides, and keeps every row', () => {
    const { db, sqlite } = databaseAt('0049')
    sqlite.exec(`
      INSERT INTO facilities (id, name) VALUES (2, 'Krippe');
      INSERT INTO groups (id, facility_id, name) VALUES (1, 1, 'Bären'), (2, 2, 'Wichtel');
      INSERT INTO employees (id, facility_id, name) VALUES (1, 1, 'Anna'), (2, 2, 'Berta');
      INSERT INTO care_types (id, facility_id, name, start, "end") VALUES (1, 1, 'Ganztags', 420, 990);
    `)
    const rows = (table: string) => sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1`).all() as Record<string, unknown>[]
    const before = { facilities: rows('facilities'), groups: rows('groups'), employees: rows('employees'), careTypes: rows('care_types') }

    migrateDb(db, MIGRATIONS)

    expect(rows('facilities').map(({ form_starters_seeded: _seeded, christmas_eve_half_leave: _half, ...rest }) => rest)).toEqual(before.facilities)
    expect(rows('groups').map(({ group_type: _type, ...rest }) => rest)).toEqual(before.groups)
    expect(rows('employees').map(({ qualification: _q, staffing_share: _s, pin_lock_level: _l, ...rest }) => rest)).toEqual(before.employees)
    expect(rows('care_types').map(({ days_per_week: _d, ...rest }) => rest)).toEqual(before.careTypes)
    expect(sqlite.prepare('SELECT id, group_type FROM groups ORDER BY id').all()).toEqual([
      { id: 1, group_type: null }, { id: 2, group_type: null },
    ])
    expect(sqlite.prepare('SELECT id, qualification, staffing_share FROM employees ORDER BY id').all()).toEqual([
      { id: 1, qualification: null, staffing_share: null }, { id: 2, qualification: null, staffing_share: null },
    ])
    expect(sqlite.prepare('SELECT days_per_week FROM care_types').all()).toEqual([{ days_per_week: 5 }])
    sqlite.exec(`INSERT INTO care_types (facility_id, name, start, "end") VALUES (2, 'Vormittags', 450, 750)`)
    expect(sqlite.prepare('SELECT days_per_week FROM care_types WHERE facility_id = 2').get()).toEqual({ days_per_week: 5 })
    expect(count(sqlite, 'staffing_overrides')).toBe(0)
    expect(sqlite.prepare('PRAGMA foreign_key_list(staffing_overrides)').all()
      .map(fk => { const { table, from, on_delete } = fk as Record<string, string>; return { table, from, on_delete } })
      .sort((a, b) => a.from.localeCompare(b.from))).toEqual([
      { table: 'facilities', from: 'facility_id', on_delete: 'CASCADE' },
      { table: 'users', from: 'updated_by', on_delete: 'SET NULL' },
    ])
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('0051 clears every stamp PIN with its attempts and lock, and adds the lock level', () => {
    const { db, sqlite } = databaseAt('0050')
    sqlite.exec(`
      INSERT INTO facilities (id, name) VALUES (2, 'Krippe');
      INSERT INTO employees (id, facility_id, name, pin_hash, pin_failed, pin_locked_until) VALUES
        (1, 1, 'Anna', 'scrypt:old-hash-1', 0, NULL),
        (2, 1, 'Berta', 'scrypt:old-hash-2', 3, NULL),
        (3, 2, 'Kim', 'scrypt:old-hash-3', 0, '2026-10-23T06:15:00.000Z'),
        (4, 2, 'Zoe', NULL, 0, NULL);
    `)
    const rows = () => sqlite.prepare('SELECT * FROM employees ORDER BY id').all() as Record<string, unknown>[]
    const pinColumns = ['pin_hash', 'pin_failed', 'pin_locked_until', 'pin_lock_level']
    const withoutPin = (list: Record<string, unknown>[]) =>
      list.map(row => Object.fromEntries(Object.entries(row).filter(([column]) => !pinColumns.includes(column))))
    const before = rows()

    migrateDb(db, MIGRATIONS)

    expect(sqlite.prepare('SELECT id, pin_hash, pin_failed, pin_locked_until, pin_lock_level FROM employees ORDER BY id').all())
      .toEqual([1, 2, 3, 4].map(id => ({ id, pin_hash: null, pin_failed: 0, pin_locked_until: null, pin_lock_level: 0 })))
    expect(withoutPin(rows())).toEqual(withoutPin(before))
    sqlite.exec(`INSERT INTO employees (facility_id, name) VALUES (1, 'Neu')`)
    expect(sqlite.prepare(`SELECT pin_lock_level FROM employees WHERE name = 'Neu'`).get()).toEqual({ pin_lock_level: 0 })
  })

  it('0052 only creates the empty table of acknowledged warnings, unique per facility and key', () => {
    const { db, sqlite } = databaseAt('0051')
    const tables = () => (sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as { name: string }[])
      .map(row => row.name)
    const before = tables()

    migrateDb(db, MIGRATIONS)

    // Later migrations add further tables: only check that this one is new.
    expect(tables().filter(name => !before.includes(name))).toContain('warning_acks')
    expect(count(sqlite, 'warning_acks')).toBe(0)
    expect(sqlite.prepare('PRAGMA foreign_key_list(warning_acks)').all()
      .map(fk => { const { table, from, on_delete } = fk as Record<string, string>; return { table, from, on_delete } })
      .sort((a, b) => a.from.localeCompare(b.from))).toEqual([
      { table: 'users', from: 'acknowledged_by', on_delete: 'SET NULL' },
      { table: 'facilities', from: 'facility_id', on_delete: 'CASCADE' },
    ])
    const insert = `INSERT INTO warning_acks (facility_id, key, date, signature, acknowledged_at)
      VALUES (1, 'missing_entry|2026-10-05|1', '2026-10-05', '', '2026-10-23T08:00:00.000Z')`
    sqlite.exec(insert)
    expect(() => sqlite.exec(insert)).toThrow(/UNIQUE/)
    expect(sqlite.prepare(`SELECT acknowledged_by, acknowledged_by_name FROM warning_acks`).get())
      .toEqual({ acknowledged_by: null, acknowledged_by_name: '' })
  })

  it('0053 only creates the empty table of hidden checklist items, unique per facility and key', () => {
    const { db, sqlite } = databaseAt('0052')
    const tables = () => (sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as { name: string }[])
      .map(row => row.name)
    const before = tables()

    migrateDb(db, MIGRATIONS)

    expect(tables().filter(name => !before.includes(name))).toContain('setup_hidden')
    expect(count(sqlite, 'setup_hidden')).toBe(0)
    expect(sqlite.prepare('PRAGMA foreign_key_list(setup_hidden)').all()
      .map(fk => { const { table, from, on_delete } = fk as Record<string, string>; return { table, from, on_delete } })
      .sort((a, b) => a.from.localeCompare(b.from))).toEqual([
      { table: 'facilities', from: 'facility_id', on_delete: 'CASCADE' },
      { table: 'users', from: 'hidden_by', on_delete: 'SET NULL' },
    ])
    const insert = `INSERT INTO setup_hidden (facility_id, key, hidden_at) VALUES (1, 'employee_birthday', '2026-10-25T08:00:00.000Z')`
    sqlite.exec(insert)
    expect(() => sqlite.exec(insert)).toThrow(/UNIQUE/)
  })

  it('0055 adds the empty form tables; the startup step then gives every existing facility the starters once', () => {
    const { db, sqlite } = databaseAt('0054')
    sqlite.exec(`INSERT INTO facilities (id, name) VALUES (2, 'Krippe')`)

    migrateDb(db, MIGRATIONS)

    for (const table of ['form_templates', 'forms', 'staff_talks', 'staff_talk_forms']) expect(count(sqlite, table)).toBe(0)
    expect(sqlite.prepare('SELECT id, form_starters_seeded FROM facilities ORDER BY id').all())
      .toEqual([{ id: 1, form_starters_seeded: 0 }, { id: 2, form_starters_seeded: 0 }])
    const starters = () => sqlite.prepare('SELECT facility_id, starter_key, name FROM form_templates ORDER BY id').all()
    seedDefaults(db)
    // Later starters (0056: the Entwicklungsgespräch, 0057: the Teamsitzung) come along in the same step.
    const seeded = [1, 2].flatMap(id => STARTERS.map(starter => ({ facility_id: id, starter_key: starter.key, name: starter.name })))
    expect(seeded.slice(0, 3).map(row => row.name))
      .toEqual(['Selbstbeurteilung', 'Beurteilungsbogen pädagogische Fachkräfte', 'Entwicklungsgespräch'])
    expect(starters()).toEqual(seeded)
    seedDefaults(db)
    expect(starters()).toEqual(seeded)
  })

  it('0056 adds the child form columns and tables and keeps the staff starters of seeded facilities as seeded', () => {
    const { db, sqlite } = databaseAt('0055')
    sqlite.exec(`INSERT INTO facilities (id, name) VALUES (2, 'Krippe')`)
    sqlite.exec(`UPDATE facilities SET form_starters_seeded = 1 WHERE id = 1`)
    sqlite.exec(`INSERT INTO forms (facility_id, kind, title, content, created_at, updated_at)
      VALUES (1, 'staff', 'Alt', '{"sections":[]}', '2026-10-01T08:00:00.000Z', '2026-10-01T08:00:00.000Z')`)
    const tables = () => (sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as { name: string }[])
      .map(row => row.name)
    const before = tables()

    migrateDb(db, MIGRATIONS)

    expect(tables().filter(name => !before.includes(name))).toEqual(expect.arrayContaining(['form_editors', 'form_starter_seeds']))
    expect(count(sqlite, 'form_editors')).toBe(0)
    expect(sqlite.prepare('SELECT facility_id, starter_key FROM form_starter_seeds ORDER BY facility_id, starter_key').all())
      .toEqual([{ facility_id: 1, starter_key: 'staff_assessment' }, { facility_id: 1, starter_key: 'staff_self_assessment' }])
    // The existing form keeps everything and gets empty child fields.
    expect(sqlite.prepare(`SELECT title, child_id, parent_meeting_id, form_date, form_start, form_participants FROM forms`).all())
      .toEqual([{ title: 'Alt', child_id: null, parent_meeting_id: null, form_date: null, form_start: null, form_participants: '' }])
    const fks = (table: string) => sqlite.prepare(`PRAGMA foreign_key_list(${table})`).all()
      .map(fk => { const { table, from, on_delete } = fk as Record<string, string>; return { table, from, on_delete } })
      .sort((a, b) => a.from.localeCompare(b.from))
    expect(fks('forms')).toEqual(expect.arrayContaining([
      { table: 'children', from: 'child_id', on_delete: 'CASCADE' },
      { table: 'child_parent_meetings', from: 'parent_meeting_id', on_delete: 'SET NULL' },
    ]))
    expect(fks('form_editors')).toEqual([
      { table: 'employees', from: 'employee_id', on_delete: 'CASCADE' },
      { table: 'forms', from: 'form_id', on_delete: 'CASCADE' },
    ])

    // The startup step adds only the newer starters to facility 1, and all of them to the facility never seeded.
    seedDefaults(db)
    const keys = STARTERS.map(starter => starter.key)
    const recorded: string[] = ['staff_self_assessment', 'staff_assessment']
    expect(sqlite.prepare('SELECT facility_id, starter_key FROM form_templates ORDER BY facility_id, id').all()).toEqual([
      ...keys.filter(key => !recorded.includes(key)).map(key => ({ facility_id: 1, starter_key: key })),
      ...keys.map(key => ({ facility_id: 2, starter_key: key })),
    ])
    expect(keys).toContain('child_development')
  })

  it('0057 only adds the empty team meetings table; the startup step then gives seeded facilities the Teamsitzung', () => {
    const { db, sqlite } = databaseAt('0056')
    sqlite.exec(`INSERT INTO form_starter_seeds (facility_id, starter_key, seeded_at) VALUES
      (1, 'staff_self_assessment', 'x'), (1, 'staff_assessment', 'x'), (1, 'child_development', 'x')`)
    const tables = () => (sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as { name: string }[])
      .map(row => row.name)
    const before = tables()

    migrateDb(db, MIGRATIONS)

    // Later migrations add further tables: only check that this one is new.
    expect(tables().filter(name => !before.includes(name))).toContain('team_meetings')
    expect(count(sqlite, 'team_meetings')).toBe(0)
    expect(sqlite.prepare('PRAGMA foreign_key_list(team_meetings)').all()
      .map(fk => { const { table, from, on_delete } = fk as Record<string, string>; return { table, from, on_delete } })
      .sort((a, b) => a.from.localeCompare(b.from))).toEqual([
      { table: 'facilities', from: 'facility_id', on_delete: 'CASCADE' },
      { table: 'forms', from: 'form_id', on_delete: 'CASCADE' },
      { table: 'groups', from: 'group_id', on_delete: 'SET NULL' },
    ])
    // One meeting per form.
    sqlite.exec(`INSERT INTO forms (id, facility_id, kind, title, content, created_at, updated_at)
      VALUES (1, 1, 'team', 'Teamsitzung', '{"sections":[]}', 'x', 'x')`)
    const insert = `INSERT INTO team_meetings (facility_id, form_id, date, created_at) VALUES (1, 1, '2026-10-26', 'x')`
    sqlite.exec(insert)
    expect(() => sqlite.exec(insert)).toThrow(/UNIQUE/)
    expect(sqlite.prepare('SELECT state, participants, recorder, created_by FROM team_meetings').all())
      .toEqual([{ state: 'draft', participants: '', recorder: '', created_by: '' }])

    seedDefaults(db)
    expect(sqlite.prepare(`SELECT facility_id, name FROM form_templates WHERE starter_key = 'team_meeting'`).all())
      .toEqual([{ facility_id: 1, name: 'Teamsitzung' }])
  })

  it('0058 adds the empty retention settings per facility and marks every existing adjustment as not paid out', () => {
    const { db, sqlite } = databaseAt('0057')
    sqlite.exec(`
      INSERT INTO facilities (id, name) VALUES (2, 'Krippe');
      INSERT INTO employees (id, facility_id, name) VALUES (1, 1, 'Anna'), (2, 2, 'Kim');
      INSERT INTO balance_adjustments (id, employee_id, date, minutes, reason) VALUES
        (1, 1, '2026-01-01', 120, 'Übertrag'), (2, 2, '2026-06-30', -600, 'Auszahlung');
    `)
    const adjustments = () => sqlite.prepare('SELECT * FROM balance_adjustments ORDER BY id').all() as Record<string, unknown>[]
    const before = adjustments()
    const tables = () => (sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as { name: string }[])
      .map(row => row.name)
    const tablesBefore = tables()

    migrateDb(db, MIGRATIONS)

    expect(tables().filter(name => !tablesBefore.includes(name))).toContain('retention_settings')
    expect(count(sqlite, 'retention_settings')).toBe(0)
    expect(adjustments()).toEqual(before.map(row => ({ ...row, paid_out: 0 })))
    expect(sqlite.prepare('PRAGMA foreign_key_list(retention_settings)').all()
      .map(fk => { const { table, from, on_delete } = fk as Record<string, string>; return { table, from, on_delete } }))
      .toEqual([{ table: 'facilities', from: 'facility_id', on_delete: 'CASCADE' }])
    // A row gets the defaults; one per facility.
    const insert = 'INSERT INTO retention_settings (facility_id) VALUES (2)'
    sqlite.exec(insert)
    expect(() => sqlite.exec(insert)).toThrow(/UNIQUE|PRIMARY/)
    expect(sqlite.prepare('SELECT * FROM retention_settings').all()).toEqual([{
      facility_id: 2, time_years: 2, assessment_years: 3, paid_overtime_years: 10, pension_years: 30, cash_years: 10,
      employee_delete: 'managers',
    }])
    sqlite.exec(`INSERT INTO balance_adjustments (employee_id, date, minutes, reason) VALUES (1, '2026-10-01', 60, 'Neu')`)
    expect(sqlite.prepare(`SELECT paid_out FROM balance_adjustments WHERE reason = 'Neu'`).get()).toEqual({ paid_out: 0 })
    // The settings go with their facility.
    sqlite.exec('DELETE FROM balance_adjustments WHERE employee_id = 2; DELETE FROM employees WHERE id = 2; DELETE FROM facilities WHERE id = 2')
    expect(count(sqlite, 'retention_settings')).toBe(0)
  })

  it('0059 lets 24 and 31 December count as a whole leave day in every existing facility', () => {
    const { db, sqlite } = databaseAt('0058')
    sqlite.exec(`INSERT INTO facilities (id, name, leave_max_concurrent) VALUES (2, 'Krippe', 3)`)
    const facilities = () => sqlite.prepare('SELECT * FROM facilities ORDER BY id').all() as Record<string, unknown>[]
    const before = facilities()

    migrateDb(db, MIGRATIONS)

    expect(facilities()).toEqual(before.map(row => ({ ...row, christmas_eve_half_leave: 0 })))
    sqlite.exec(`INSERT INTO facilities (id, name) VALUES (3, 'Hort')`)
    expect(sqlite.prepare('SELECT christmas_eve_half_leave FROM facilities WHERE id = 3').get()).toEqual({ christmas_eve_half_leave: 0 })
  })

  it('0060 only creates the empty table of emergency contacts, which go with their employee', () => {
    const { db, sqlite } = databaseAt('0059')
    sqlite.exec(`INSERT INTO employees (id, facility_id, name) VALUES (1, 1, 'Anna'), (2, 1, 'Ben')`)
    const employeesBefore = sqlite.prepare('SELECT * FROM employees ORDER BY id').all()

    migrateDb(db, MIGRATIONS)

    expect(sqlite.prepare('SELECT * FROM employees ORDER BY id').all()).toEqual(employeesBefore)
    expect(count(sqlite, 'employee_emergency_contacts')).toBe(0)
    expect(sqlite.prepare('PRAGMA foreign_key_list(employee_emergency_contacts)').all()
      .map(fk => { const { table, from, on_delete } = fk as Record<string, string>; return { table, from, on_delete } }))
      .toEqual([{ table: 'employees', from: 'employee_id', on_delete: 'CASCADE' }])
    sqlite.exec(`INSERT INTO employee_emergency_contacts (employee_id, name, phone) VALUES (1, 'Max', '0171 1'), (2, 'Eva', '0171 2')`)
    expect(sqlite.prepare(`SELECT sort_order, relation, phone2, note FROM employee_emergency_contacts WHERE name = 'Max'`).get())
      .toEqual({ sort_order: 0, relation: '', phone2: '', note: '' })
    expect(() => sqlite.exec(`INSERT INTO employee_emergency_contacts (employee_id, name, phone) VALUES (3, 'Nobody', '1')`))
      .toThrow(/FOREIGN KEY/)
    sqlite.exec('DELETE FROM employees WHERE id = 1')
    expect(sqlite.prepare('SELECT name FROM employee_emergency_contacts').all()).toEqual([{ name: 'Eva' }])
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('print_templates keep their file when the uploader is deleted', () => {
    const db = createTestDb()
    const user = addUser(db, 'leitung', 'admin')
    db.insert(printTemplates).values({
      facilityId: 1, title: 'Elternbrief', category: 'Eltern', mimeType: 'application/pdf', size: 5, data: Buffer.from('%PDF-'),
      uploadedBy: user.id, uploadedAt: '2026-10-21T08:00:00.000Z', updatedAt: '2026-10-21T08:00:00.000Z',
    }).run()
    db.delete(users).where(eq(users.id, user.id)).run()
    expect(db.select({ title: printTemplates.title, uploadedBy: printTemplates.uploadedBy }).from(printTemplates).all())
      .toEqual([{ title: 'Elternbrief', uploadedBy: null }])
  })

  it('child_parent_meetings rows go with their child and keep the name when the person is deleted', () => {
    const db = createTestDb()
    const anna = addEmployee(db, 'Anna')
    const user = addUser(db, 'anna', 'observer', anna)
    const lena = addChild(db, 1, { firstName: 'Lena' })
    const max = addChild(db, 1, { firstName: 'Max' })
    const row = (childId: number) => ({
      childId, date: '2026-10-20', start: 840, kind: 'development' as const, createdAt: '2026-10-20T08:00:00.000Z',
      createdByUserId: user.id, createdByEmployeeId: anna, createdByName: 'Anna',
    })
    db.insert(childParentMeetings).values([row(lena), row(max)]).run()
    db.delete(users).where(eq(users.id, user.id)).run()
    db.delete(employees).where(eq(employees.id, anna)).run()
    expect(db.select({ userId: childParentMeetings.createdByUserId, employeeId: childParentMeetings.createdByEmployeeId,
      name: childParentMeetings.createdByName }).from(childParentMeetings).all())
      .toEqual([1, 2].map(() => ({ userId: null, employeeId: null, name: 'Anna' })))
    db.delete(children).where(eq(children.id, lena)).run()
    expect(db.select({ childId: childParentMeetings.childId }).from(childParentMeetings).all()).toEqual([{ childId: max }])
  })

  it('child_development_docs rows go with their child and keep the name when the person is deleted', () => {
    const db = createTestDb()
    const anna = addEmployee(db, 'Anna')
    const user = addUser(db, 'leitung', 'admin')
    const lena = addChild(db, 1, { firstName: 'Lena' })
    db.insert(childDevelopmentDocs).values({
      childId: lena, doneOn: '2026-10-20', doneByUserId: user.id, doneByEmployeeId: anna, doneByName: 'Anna',
      createdAt: '2026-10-20T08:00:00.000Z',
    }).run()
    db.delete(users).where(eq(users.id, user.id)).run()
    db.delete(employees).where(eq(employees.id, anna)).run()
    expect(db.select({ userId: childDevelopmentDocs.doneByUserId, employeeId: childDevelopmentDocs.doneByEmployeeId,
      name: childDevelopmentDocs.doneByName }).from(childDevelopmentDocs).all())
      .toEqual([{ userId: null, employeeId: null, name: 'Anna' }])
    db.delete(children).where(eq(children.id, lena)).run()
    expect(db.select().from(childDevelopmentDocs).all()).toEqual([])
  })

  it('terminal_unlocks rows go with their tablet account', () => {
    const db = createTestDb()
    const employeeId = addEmployee(db, 'Anna Beispiel')
    const terminal = addUser(db, 'tablet', 'terminal')
    const other = addUser(db, 'tablet2', 'terminal')
    const row = (id: string, terminalUserId: number) => ({
      id, terminalUserId, facilityId: 1, employeeId, createdAt: '2026-10-15T08:00:00.000Z', lastActiveAt: '2026-10-15T08:00:00.000Z',
    })
    db.insert(terminalUnlocks).values([row('a', terminal.id), row('b', other.id)]).run()
    // At most one unlock per tablet account.
    expect(() => db.insert(terminalUnlocks).values(row('c', terminal.id)).run()).toThrow(/UNIQUE/)

    db.delete(users).where(eq(users.id, terminal.id)).run()

    expect(db.select({ id: terminalUnlocks.id }).from(terminalUnlocks).all()).toEqual([{ id: 'b' }])
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
