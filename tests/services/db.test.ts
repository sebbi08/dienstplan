import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { eq, inArray, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { describe, expect, it } from 'vitest'
import { createDb, migrateDb } from '../../server/db/client'
import {
  absenceCodes, childDevelopmentDocs, childNotes, childParentMeetings, children, coverageRules, employees, printTemplates, shiftTemplates,
  templateCategories, terminalUnlocks, users,
} from '../../server/db/schema'
import { DEFAULT_TEMPLATE_CATEGORIES, ensureInitialAdmin, resetAdminFromEnv, seedDefaults } from '../../server/db/seed'
import { verifyPassword } from '../../server/lib/password'
import { DEFAULT_CONTACT_CATEGORIES } from '../../shared/domain/contacts'
import { STARTERS } from '../../shared/domain/forms/starters'
import { addChild, addEmployee, addUser, createTestDb } from '../helpers/fixtures'
import { CONSENT_COLUMN_OF, insertOverviewSample } from '../helpers/overviewSample'

describe('database setup', () => {
  it('seeds templates, codes and coverage rules once', () => {
    const db = createTestDb()
    seedDefaults(db)
    expect(db.select().from(shiftTemplates).all().map(t => t.shortLabel)).toEqual(['F1', 'F2', 'M', 'S', 'HK'])
    expect(db.select().from(absenceCodes).all()).toHaveLength(15)
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

  /** Runs migrateDb with the migrations up to and including `last` only, so a later migration does not change the result. */
  function migrateThrough(db: Parameters<typeof migrateDb>[0], last: string) {
    const folder = migrationsThrough(last)
    try {
      migrateDb(db, folder)
    }
    finally {
      rmSync(folder, { recursive: true, force: true })
    }
  }
  // Columns of `children` that 0042_consents adds / drops; the older tests compare the rows before and after without them.
  const NEW_CONSENT_COLUMNS = ['consent_signal_photos', 'consent_insect_repellent']
  // Columns of `children` that later migrations add (0109_contacts: the future school); the older tests leave them out.
  const LATER_CHILD_COLUMNS = ['future_school_contact_id']
  const withoutLaterChildColumns = (rows: unknown[]) => (rows as Record<string, unknown>[])
    .map(row => Object.fromEntries(Object.entries(row).filter(([column]) => !LATER_CHILD_COLUMNS.includes(column))))
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
  // 0059_christmas_eve_half_leave: 24 and 31 December as half a leave day; 0076_facility_contact: address, website, Träger, Leitung; 0077_child_sort;
  // 0083_leave_forfeit_notice: the forfeiture date and text of the notice on remaining leave; 0084_child_ifsg_cases: the attest setting; 0088_ifsg_local_rules: the health office; 0092_bem_processes: the BEM invitation text).
  const LATER_FACILITY_COLUMNS = [...REMINDER_COLUMNS, 'capacity', 'mark_tolerance_minutes', 'mark_early_leave', 'form_starters_seeded',
    'christmas_eve_half_leave', 'street', 'postal_code', 'city', 'website', 'operator_name', 'manager_name', 'child_sort',
    'leave_forfeit_day', 'leave_forfeit_month', 'leave_forfeit_text', 'ifsg_require_attest', 'health_office_name', 'health_office_phone',
    'bem_invitation_text', 'christmas_eve_paid_free', 'tvoed_sue']
  const CONTACT_DEFAULTS = { street: '', postal_code: '', city: '', website: '', operator_name: '', manager_name: '' }
  const SORT_DEFAULT = { child_sort: 'age_desc' }
  const FORFEIT_DEFAULTS = { leave_forfeit_day: 31, leave_forfeit_month: 3, leave_forfeit_text: null }
  const IFSG_DEFAULT = { ifsg_require_attest: 0 }
  const HEALTH_OFFICE_DEFAULT = { health_office_name: '', health_office_phone: '' }
  const BEM_TEXT_DEFAULT = { bem_invitation_text: null }
  // 0098_tvoed_sue_paid_eves: „Wir arbeiten nach TVöD SuE“ (on) and the own choice „bezahlt frei“ for 24/31.12. (off);
  // (0101_facility_eve_rules keeps the rules per year in a table of its own.)
  const TVOED_DEFAULTS = { christmas_eve_paid_free: 0, tvoed_sue: 1 }
  const withoutLaterFacilityColumns = (rows: unknown[]) => (rows as Record<string, unknown>[])
    .map(row => Object.fromEntries(Object.entries(row).filter(([column]) => !LATER_FACILITY_COLUMNS.includes(column))))
  // Columns of `employees` that 0062_personnel_file adds; the older tests compare employee rows without them (and
  // without `balance_from` of 0072_employee_balance_from, the training columns of 0074_employee_training_until and
  // `single_parent` of 0086_employee_children).
  const PERSONNEL_COLUMNS = ['birth_year', 'street', 'postal_code', 'city', 'phone', 'email', 'nationality', 'disability',
    'disability_degree', 'disability_equal', 'disability_until', 'fixed_term_until']
  const LATER_EMPLOYEE_COLUMNS = [...PERSONNEL_COLUMNS, 'balance_from', 'training_until', 'recognition_year_counts', 'single_parent', 'probation_until']
  const withoutPersonnel = (rows: unknown[]) => (rows as Record<string, unknown>[])
    .map(row => Object.fromEntries(Object.entries(row).filter(([column]) => !LATER_EMPLOYEE_COLUMNS.includes(column))))
  // 0104_vaccination_counselling_document gives every facility this document type; the older tests leave it out.
  const IMPFBERATUNG = 'Nachweis ärztliche Impfberatung (§ 34 Abs. 10a IfSG)'
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
        leaving_lead_weeks: 4, doc_since: null, capacity: null, form_starters_seeded: 0, christmas_eve_half_leave: 0, ...CONTACT_DEFAULTS, ...SORT_DEFAULT,
        ...FORFEIT_DEFAULTS, ...IFSG_DEFAULT, ...HEALTH_OFFICE_DEFAULT, ...BEM_TEXT_DEFAULT, ...TVOED_DEFAULTS,
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
    // (group_id comes with the later 0022_groups, home_office with 0069, employee_child_id with 0086, the Sonderurlaub reason with 0089.)
    expect(after.map(({ help_facility_id: _, group_id: __, home_office: ___, employee_child_id: ____, special_leave_reason: _reason, special_leave_text: _text, ...rest }) => rest)).toEqual(before)
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
      // (weekdays of the coverage rules comes with the later 0038_opening_hours, the birthday of employees with 0044,
      // home_office of entries with 0069, of week template entries with 0070; employee_child_id of entries with 0086, the Sonderurlaub reason with 0089.)
      expect(withoutPersonnel(withoutReminders(after.map(({ group_id: _, weekdays: __, home_office: ___, employee_child_id: ____, special_leave_reason: _reason, special_leave_text: _text, ...rest }) => rest))), table)
        .toEqual(before[table])
      expect(after.every(row => row.group_id === null), table).toBe(true)
    }
    expect((sqlite.prepare('SELECT * FROM week_template_entries').all() as Record<string, unknown>[])
      .map(({ home_office: _, ...rest }) => rest)).toEqual(before.week_template_entries)
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
        'SELECT name, important, required, confidential_default, sort_order FROM document_types WHERE facility_id = ? AND name NOT LIKE ? ORDER BY sort_order',
      ).all(id, IMPFBERATUNG), `facility ${id}`).toEqual(expected)
    }
    // And 0104's type for the Impfberatung in each of them.
    expect(count(sqlite, 'document_types')).toBe(24)
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
    const laterColumns = [...reviewColumns, 'facility_since', ...NEW_CONSENT_COLUMNS, ...LATER_CHILD_COLUMNS]
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
    expect(count(sqlite, 'document_types')).toBe(13) // with 0104's Impfberatung in each facility
    expect(sqlite.prepare('SELECT id, facility_id, name, important, required, confidential_default, sort_order FROM document_types WHERE name NOT LIKE ? ORDER BY id').all(IMPFBERATUNG))
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
    expect(without(sqlite.prepare('SELECT * FROM children ORDER BY id').all(), 'contract_review_since', 'facility_since', ...NEW_CONSENT_COLUMNS, ...LATER_CHILD_COLUMNS)).toEqual(before.children)
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
    expect(withoutLaterChildColumns(after.map(({ facility_since: _, consent_signal_photos: _s, consent_insect_repellent: _i, ...rest }) => rest))).toEqual(before)
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
    // 0095 gave the facility the examinations of the JArbSchG, 0104 a document type; they go first (no cascade).
    sqlite.exec('DELETE FROM children WHERE id = 2; DELETE FROM requirement_types WHERE facility_id = 2; DELETE FROM document_types WHERE facility_id = 2; DELETE FROM facilities WHERE id = 2')
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
    sqlite.exec('DELETE FROM requirement_types WHERE facility_id = 2; DELETE FROM document_types WHERE facility_id = 2; DELETE FROM facilities WHERE id = 2') // 0095's kinds, 0104's type first
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
      .map(({ capacity: _, mark_tolerance_minutes: _tolerance, mark_early_leave: _early, form_starters_seeded: _seeded, christmas_eve_half_leave: _half, street: _street, postal_code: _plz, city: _city, website: _web, operator_name: _operator, manager_name: _manager, child_sort: _sort, leave_forfeit_day: _forfeitDay, leave_forfeit_month: _forfeitMonth, leave_forfeit_text: _forfeitText, ifsg_require_attest: _ifsg, health_office_name: _officeName, health_office_phone: _officePhone, bem_invitation_text: _bemText, christmas_eve_paid_free: _paidEves, tvoed_sue: _tvoed, ...rest }) => rest))
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

    expect(withoutLaterChildColumns(sqlite.prepare('SELECT * FROM children').all())).toEqual(before)
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
      .map(({ mark_tolerance_minutes: _tolerance, mark_early_leave: _early, form_starters_seeded: _seeded, christmas_eve_half_leave: _half, street: _street, postal_code: _plz, city: _city, website: _web, operator_name: _operator, manager_name: _manager, child_sort: _sort, leave_forfeit_day: _forfeitDay, leave_forfeit_month: _forfeitMonth, leave_forfeit_text: _forfeitText, ifsg_require_attest: _ifsg, health_office_name: _officeName, health_office_phone: _officePhone, bem_invitation_text: _bemText, christmas_eve_paid_free: _paidEves, tvoed_sue: _tvoed, ...rest }) => rest))
      .toEqual(before)
  })

  it('0049 adds the empty print templates with their index and references, and keeps the facilities', () => {
    const { db, sqlite } = databaseAt('0048')
    sqlite.exec(`INSERT INTO facilities (id, name) VALUES (2, 'Krippe')`)
    const before = sqlite.prepare('SELECT * FROM facilities ORDER BY id').all()

    migrateDb(db, MIGRATIONS)

    expect((sqlite.prepare('SELECT * FROM facilities ORDER BY id').all() as Record<string, unknown>[])
      .map(({ form_starters_seeded: _seeded, christmas_eve_half_leave: _half, street: _street, postal_code: _plz, city: _city, website: _web, operator_name: _operator, manager_name: _manager, child_sort: _sort, leave_forfeit_day: _forfeitDay, leave_forfeit_month: _forfeitMonth, leave_forfeit_text: _forfeitText, ifsg_require_attest: _ifsg, health_office_name: _officeName, health_office_phone: _officePhone, bem_invitation_text: _bemText, christmas_eve_paid_free: _paidEves, tvoed_sue: _tvoed, ...rest }) => rest)).toEqual(before)
    expect(count(sqlite, 'print_templates')).toBe(0)
    expect(sqlite.prepare('PRAGMA table_info(print_templates)').all()
      .map(column => { const { name, notnull } = column as Record<string, unknown>; return [name, notnull] }))
      // 0063_template_categories adds the category reference (and its index, see there); 0108 makes it optional (none
      // for the templates of all facilities) and adds their category name and visibility; 0112 whether it is a form.
      .toEqual([
        ['id', 1], ['facility_id', 0], ['title', 1], ['category', 1], ['category_id', 0], ['category_name', 0], ['visibility', 1],
        ['mime_type', 1], ['size', 1], ['data', 1], ['uploaded_by', 0], ['uploaded_at', 1], ['updated_at', 1], ['fillable', 0],
      ])
    expect(sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'print_templates' AND name = 'print_templates_facility'`).all())
      .toEqual([{ name: 'print_templates_facility' }])
    expect(sqlite.prepare('PRAGMA foreign_key_list(print_templates)').all()
      .map(fk => { const { table, from, on_delete } = fk as Record<string, string>; return { table, from, on_delete } })
      .filter(fk => fk.from !== 'category_id')
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

    expect(rows('facilities').map(({ form_starters_seeded: _seeded, christmas_eve_half_leave: _half, street: _street, postal_code: _plz, city: _city, website: _web, operator_name: _operator, manager_name: _manager, child_sort: _sort, leave_forfeit_day: _forfeitDay, leave_forfeit_month: _forfeitMonth, leave_forfeit_text: _forfeitText, ifsg_require_attest: _ifsg, health_office_name: _officeName, health_office_phone: _officePhone, bem_invitation_text: _bemText, christmas_eve_paid_free: _paidEves, tvoed_sue: _tvoed, ...rest }) => rest)).toEqual(before.facilities)
    expect(rows('groups').map(({ group_type: _type, ...rest }) => rest)).toEqual(before.groups)
    expect(withoutPersonnel(rows('employees').map(({ qualification: _q, staffing_share: _s, pin_lock_level: _l, ...rest }) => rest)))
      .toEqual(before.employees)
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
    expect(withoutPersonnel(withoutPin(rows()))).toEqual(withoutPin(before))
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
      facility_id: 2, time_years: 2, assessment_years: 3, paid_overtime_years: 8, pension_years: 30, cash_years: 10,
      employee_delete: 'managers', bem_years: 3, maternity_years: 2, payroll_office: 1,
    }])
    sqlite.exec(`INSERT INTO balance_adjustments (employee_id, date, minutes, reason) VALUES (1, '2026-10-01', 60, 'Neu')`)
    expect(sqlite.prepare(`SELECT paid_out FROM balance_adjustments WHERE reason = 'Neu'`).get()).toEqual({ paid_out: 0 })
    // The settings go with their facility.
    sqlite.exec('DELETE FROM balance_adjustments WHERE employee_id = 2; DELETE FROM employees WHERE id = 2; DELETE FROM requirement_types WHERE facility_id = 2; DELETE FROM document_types WHERE facility_id = 2; DELETE FROM facilities WHERE id = 2')
    expect(count(sqlite, 'retention_settings')).toBe(0)
  })

  it('0059 lets 24 and 31 December count as a whole leave day in every existing facility', () => {
    const { db, sqlite } = databaseAt('0058')
    sqlite.exec(`INSERT INTO facilities (id, name, leave_max_concurrent) VALUES (2, 'Krippe', 3)`)
    const facilities = () => sqlite.prepare('SELECT * FROM facilities ORDER BY id').all() as Record<string, unknown>[]
    const before = facilities()

    migrateDb(db, MIGRATIONS)

    expect(facilities()).toEqual(before.map(row => ({ ...row, christmas_eve_half_leave: 0, ...CONTACT_DEFAULTS, ...SORT_DEFAULT, ...FORFEIT_DEFAULTS, ...IFSG_DEFAULT, ...HEALTH_OFFICE_DEFAULT, ...BEM_TEXT_DEFAULT, ...TVOED_DEFAULTS })))
    sqlite.exec(`INSERT INTO facilities (id, name) VALUES (3, 'Hort')`)
    expect(sqlite.prepare('SELECT christmas_eve_half_leave FROM facilities WHERE id = 3').get()).toEqual({ christmas_eve_half_leave: 0 })
  })

  it('0060 only creates the empty table of emergency contacts, which go with their employee', () => {
    const { db, sqlite } = databaseAt('0059')
    sqlite.exec(`INSERT INTO employees (id, facility_id, name) VALUES (1, 1, 'Anna'), (2, 1, 'Ben')`)
    const employeesBefore = sqlite.prepare('SELECT * FROM employees ORDER BY id').all()

    migrateDb(db, MIGRATIONS)

    expect(withoutPersonnel(sqlite.prepare('SELECT * FROM employees ORDER BY id').all())).toEqual(employeesBefore)
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
    const categoryId = db.insert(templateCategories).values({ facilityId: 1, name: 'Briefe' }).returning().get().id
    db.insert(printTemplates).values({
      facilityId: 1, title: 'Elternbrief', categoryId, mimeType: 'application/pdf', size: 5, data: Buffer.from('%PDF-'),
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

  it('child_notes rows go with their child and keep the names when the people are deleted', () => {
    const db = createTestDb()
    const anna = addEmployee(db, 'Anna')
    const berta = addEmployee(db, 'Berta')
    const user = addUser(db, 'anna', 'observer', anna)
    const lena = addChild(db, 1, { firstName: 'Lena' })
    const max = addChild(db, 1, { firstName: 'Max' })
    const row = (childId: number) => ({
      childId, date: '2026-10-20', text: 'Notiz', educatorEmployeeId: berta, educatorName: 'Berta', createdAt: '2026-10-20T08:00:00.000Z',
      createdByUserId: user.id, createdByEmployeeId: anna, createdByName: 'Anna',
    })
    db.insert(childNotes).values([row(lena), row(max)]).run()
    db.delete(users).where(eq(users.id, user.id)).run()
    db.delete(employees).where(inArray(employees.id, [anna, berta])).run()
    expect(db.select({
      userId: childNotes.createdByUserId, employeeId: childNotes.createdByEmployeeId, name: childNotes.createdByName,
      educatorId: childNotes.educatorEmployeeId, educatorName: childNotes.educatorName,
    }).from(childNotes).all())
      .toEqual([1, 2].map(() => ({ userId: null, employeeId: null, name: 'Anna', educatorId: null, educatorName: 'Berta' })))
    db.delete(children).where(eq(children.id, lena)).run()
    expect(db.select({ childId: childNotes.childId }).from(childNotes).all()).toEqual([{ childId: max }])
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

  it('0061 adds the code Überstundenfrei after Urlaub and makes every existing request a leave request', () => {
    const { db, sqlite } = databaseAt('0060')
    sqlite.exec(`
      INSERT INTO absence_codes (key, label, color, credit_mode, requires_times, sort_order) VALUES
        ('vacation', 'Urlaub', 'gray', 'daily_target', 0, 1), ('special_leave', 'Sonderurlaub', 'gray', 'daily_target', 0, 2),
        ('sick', 'Krank', 'red', 'daily_target', 0, 3), ('other', 'sonstiges', 'neutral', 'none', 0, 4);
      INSERT INTO employees (id, name, facility_id) VALUES (1, 'Anna', 1);
      INSERT INTO leave_requests (employee_id, start_date, end_date, created_at) VALUES (1, '2026-11-02', '2026-11-06', 'now');
    `)
    migrateDb(db, MIGRATIONS)
    expect(sqlite.prepare('SELECT key, label, color, credit_mode, requires_times, sort_order FROM absence_codes ORDER BY sort_order').all())
      .toEqual([
        { key: 'vacation', label: 'Urlaub', color: 'gray', credit_mode: 'daily_target', requires_times: 0, sort_order: 1 },
        { key: 'overtime_off', label: 'ÜF', color: 'violet', credit_mode: 'none', requires_times: 0, sort_order: 2 },
        { key: 'special_leave', label: 'Sonderurlaub', color: 'gray', credit_mode: 'daily_target', requires_times: 0, sort_order: 3 },
        { key: 'sick', label: 'Krank', color: 'red', credit_mode: 'daily_target', requires_times: 0, sort_order: 4 },
        // 0086 puts „Kind krank“ after Krank and moves the later codes down by one.
        { key: 'child_sick', label: 'Kind krank', color: 'gray', credit_mode: 'daily_target', requires_times: 0, sort_order: 5 },
        // 0093 puts Mutterschutz and Beschäftigungsverbot after it and moves the later codes down by two.
        { key: 'maternity', label: 'Mutterschutz', color: 'gray', credit_mode: 'daily_target', requires_times: 0, sort_order: 6 },
        { key: 'employment_ban', label: 'Beschäftigungsverbot', color: 'gray', credit_mode: 'daily_target', requires_times: 0, sort_order: 7 },
        { key: 'other', label: 'sonstiges', color: 'neutral', credit_mode: 'none', requires_times: 0, sort_order: 8 },
        { key: 'doctor', label: 'Arzt', color: 'red', credit_mode: 'timed', requires_times: 1, sort_order: 10 },
      ])
    expect(sqlite.prepare('SELECT kind FROM leave_requests').all()).toEqual([{ kind: 'vacation' }])

    // A new database gets no codes from the migration (seedDefaults adds them all, Überstundenfrei included).
    const fresh = databaseAt('0060')
    migrateDb(fresh.db, MIGRATIONS)
    expect(count(fresh.sqlite, 'absence_codes')).toBe(0)
    seedDefaults(fresh.db)
    expect(fresh.db.select().from(absenceCodes).all().filter(code => code.key === 'overtime_off'))
      .toMatchObject([{ label: 'ÜF', color: 'violet', creditMode: 'none', requiresTimes: false, sortOrder: 2 }])
  })

  it('0086 adds the employees\' children and „Kind krank“; removing a child keeps the entry without the link', () => {
    const { db, sqlite } = databaseAt('0085')
    sqlite.exec(`
      INSERT INTO absence_codes (key, label, color, credit_mode, requires_times, sort_order) VALUES
        ('sick', 'Krank', 'gray', 'daily_target', 0, 4), ('office', 'Büro', 'yellow', 'timed', 1, 5);
      INSERT INTO employees (id, name, facility_id) VALUES (1, 'Anna', 1);
    `)
    migrateDb(db, MIGRATIONS)
    expect(sqlite.prepare('SELECT key, sort_order FROM absence_codes ORDER BY sort_order').all())
      .toEqual([
        { key: 'sick', sort_order: 4 }, { key: 'child_sick', sort_order: 5 },
        // 0093: Mutterschutz and Beschäftigungsverbot after „Kind krank“.
        { key: 'maternity', sort_order: 6 }, { key: 'employment_ban', sort_order: 7 }, { key: 'office', sort_order: 8 },
      ])
    expect(sqlite.prepare('SELECT single_parent FROM employees').all()).toEqual([{ single_parent: 0 }])
    sqlite.exec(`
      INSERT INTO employee_children (id, employee_id, birth_date) VALUES (1, 1, '2020-01-01');
      INSERT INTO entries (employee_id, date, kind, absence_code_id, employee_child_id, updated_at)
        SELECT 1, '2026-11-17', 'code', id, 1, 'now' FROM absence_codes WHERE key = 'child_sick';
      DELETE FROM employee_children WHERE id = 1;
    `)
    expect(sqlite.prepare('SELECT date, employee_child_id FROM entries').all()).toEqual([{ date: '2026-11-17', employee_child_id: null }])

    // A new database gets no code from the migration (seedDefaults adds it).
    const fresh = databaseAt('0085')
    migrateDb(fresh.db, MIGRATIONS)
    expect(count(fresh.sqlite, 'absence_codes')).toBe(0)
  })

  it('0062 adds the empty personnel file fields and tables, which go with their employee', () => {
    const { db, sqlite } = databaseAt('0061')
    sqlite.exec(`
      INSERT INTO employees (id, facility_id, name, birthday) VALUES (1, 1, 'Anna', '04-12'), (2, 1, 'Ben', NULL);
      INSERT INTO users (id, username, password_hash, role) VALUES (1, 'traeger', 'x', 'provider');
    `)
    const employeesBefore = sqlite.prepare('SELECT * FROM employees ORDER BY id').all()

    migrateDb(db, MIGRATIONS)

    const employeesAfter = sqlite.prepare('SELECT * FROM employees ORDER BY id').all() as Record<string, unknown>[]
    expect(withoutPersonnel(employeesAfter)).toEqual(employeesBefore)
    for (const row of employeesAfter) {
      expect(Object.fromEntries(PERSONNEL_COLUMNS.map(column => [column, row[column]]))).toEqual({
        birth_year: null, street: null, postal_code: null, city: null, phone: null, email: null, nationality: null,
        disability: 0, disability_degree: null, disability_equal: 0, disability_until: null, fixed_term_until: null,
      })
    }
    expect(count(sqlite, 'employee_payroll')).toBe(0)
    expect(count(sqlite, 'employee_documents')).toBe(0)
    const fks = (table: string) => sqlite.prepare(`PRAGMA foreign_key_list(${table})`).all()
      .map(fk => { const { table: parent, from, on_delete } = fk as Record<string, string>; return { parent, from, on_delete } })
      .sort((a, b) => a.from.localeCompare(b.from))
    expect(fks('employee_payroll')).toEqual([{ parent: 'employees', from: 'employee_id', on_delete: 'CASCADE' }])
    expect(fks('employee_documents')).toEqual([
      { parent: 'employees', from: 'employee_id', on_delete: 'CASCADE' },
      { parent: 'users', from: 'uploaded_by', on_delete: 'SET NULL' },
    ])
    expect(sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'employee_documents' AND name NOT LIKE 'sqlite_%'`).all())
      .toEqual([{ name: 'employee_documents_employee' }])

    sqlite.exec(`
      INSERT INTO employee_payroll (employee_id, tax_id, tax_class) VALUES (1, '86095742719', 1), (2, NULL, NULL);
      INSERT INTO employee_documents (employee_id, folder, mime_type, size, data, uploaded_by, uploaded_at) VALUES
        (1, 'contract', 'application/pdf', 3, x'255044', 1, 'now'), (2, 'salary', 'image/png', 1, x'00', 1, 'now');
    `)
    expect(() => sqlite.exec(`INSERT INTO employee_payroll (employee_id) VALUES (1)`)).toThrow(/UNIQUE|PRIMARY KEY/)
    expect(() => sqlite.exec(`INSERT INTO employee_payroll (employee_id) VALUES (3)`)).toThrow(/FOREIGN KEY/)
    expect(sqlite.prepare(`SELECT title, note, document_date FROM employee_documents WHERE employee_id = 1`).get())
      .toEqual({ title: '', note: '', document_date: null })
    sqlite.exec('DELETE FROM users WHERE id = 1')
    expect(sqlite.prepare('SELECT uploaded_by FROM employee_documents').all()).toEqual([{ uploaded_by: null }, { uploaded_by: null }])
    sqlite.exec('DELETE FROM employees WHERE id = 1')
    expect(sqlite.prepare('SELECT employee_id FROM employee_payroll').all()).toEqual([{ employee_id: 2 }])
    expect(sqlite.prepare('SELECT employee_id, folder FROM employee_documents').all()).toEqual([{ employee_id: 2, folder: 'salary' }])
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('0063 makes a category of each free-text category (visible to all, by name) and files every template in it', () => {
    const { db, sqlite } = databaseAt('0062')
    sqlite.exec(`
      INSERT INTO facilities (id, name) VALUES (2, 'Krippe');
      INSERT INTO users (id, username, password_hash, role) VALUES (1, 'traeger', 'x', 'provider');
      INSERT INTO print_templates (id, facility_id, title, category, mime_type, size, data, uploaded_by, uploaded_at, updated_at) VALUES
        (1, 1, 'Zahnarzt', 'Gesundheit', 'application/pdf', 3, x'255044', 1, 'a', 'b'),
        (2, 2, 'Ausflug', 'Eltern', 'application/pdf', 3, x'255044', NULL, 'a', 'b'),
        (3, NULL, 'Urlaubsantrag', 'Personal', 'application/pdf', 3, x'255044', 1, 'a', 'b'),
        (4, 1, 'Allergien', 'gesundheit', 'application/pdf', 3, x'255044', 1, 'a', 'b'),
        (5, 2, 'Brief', 'Eltern', 'application/pdf', 3, x'255044', 1, 'a', 'b');
    `)
    const before = sqlite.prepare('SELECT * FROM print_templates ORDER BY id').all() as Record<string, unknown>[]

    // Only through 0063: 0108 makes the categories per facility (tested there).
    migrateThrough(db, '0063')

    // „Gesundheit“ and „gesundheit“ are one category (names are unique regardless of case).
    expect(sqlite.prepare('SELECT name, sort_order, visibility FROM template_categories ORDER BY sort_order').all()).toEqual([
      { name: 'Eltern', sort_order: 0, visibility: 'all' },
      { name: 'Gesundheit', sort_order: 1, visibility: 'all' },
      { name: 'Personal', sort_order: 2, visibility: 'all' },
    ])
    const after = sqlite.prepare(`
      SELECT p.*, c.name AS category_name FROM print_templates p JOIN template_categories c ON c.id = p.category_id ORDER BY p.id
    `).all() as Record<string, unknown>[]
    expect(after.map(({ category_id: _id, category_name: _name, ...rest }) => rest)).toEqual(before)
    expect(after.map(row => [row.id, row.category_name])).toEqual([
      [1, 'Gesundheit'], [2, 'Eltern'], [3, 'Personal'], [4, 'Gesundheit'], [5, 'Eltern'],
    ])
    expect(sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'print_templates' ORDER BY name`).all())
      .toEqual([{ name: 'print_templates_category' }, { name: 'print_templates_facility' }])
    expect(sqlite.prepare('PRAGMA foreign_key_list(print_templates)').all()
      .map(fk => { const { table, from, on_delete } = fk as Record<string, string>; return { table, from, on_delete } })
      .sort((a, b) => a.from.localeCompare(b.from))).toEqual([
      { table: 'template_categories', from: 'category_id', on_delete: 'NO ACTION' },
      { table: 'facilities', from: 'facility_id', on_delete: 'CASCADE' },
      { table: 'users', from: 'uploaded_by', on_delete: 'SET NULL' },
    ])
    expect(() => sqlite.exec(`INSERT INTO template_categories (name) VALUES ('ELTERN')`)).toThrow(/UNIQUE/)
    expect(() => sqlite.exec('DELETE FROM template_categories WHERE id = 1')).toThrow(/FOREIGN KEY/)
    expect(() => sqlite.exec(`
      INSERT INTO print_templates (title, category_id, mime_type, size, data, uploaded_at, updated_at) VALUES ('X', 99, 'a', 1, x'00', 'a', 'b')
    `)).toThrow(/FOREIGN KEY/)
    sqlite.exec(`INSERT INTO template_categories (name) VALUES ('Küche')`)
    expect(sqlite.prepare(`SELECT sort_order, visibility FROM template_categories WHERE name = 'Küche'`).get())
      .toEqual({ sort_order: 0, visibility: 'all' })
    sqlite.exec(`INSERT INTO print_templates (title, category_id, mime_type, size, data, uploaded_at, updated_at) VALUES ('Neu', 1, 'a', 1, x'00', 'a', 'b')`)
    expect(sqlite.prepare(`SELECT category FROM print_templates WHERE title = 'Neu'`).get()).toEqual({ category: '' })
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('0063 folds German case variants into one category, sorts umlauts as their base letter and files empty ones under „Sonstiges“', () => {
    const { db, sqlite } = databaseAt('0062')
    sqlite.exec(`
      INSERT INTO print_templates (id, facility_id, title, category, mime_type, size, data, uploaded_at, updated_at) VALUES
        (1, 1, 'A', 'übungen', 'application/pdf', 3, x'255044', 'a', 'b'),
        (2, 1, 'B', 'Übungen', 'application/pdf', 3, x'255044', 'a', 'b'),
        (3, 1, 'C', 'Zahnarzt', 'application/pdf', 3, x'255044', 'a', 'b'),
        (4, 1, 'D', 'Ärztliches', 'application/pdf', 3, x'255044', 'a', 'b'),
        (5, 1, 'E', 'ÄRZTLICHES', 'application/pdf', 3, x'255044', 'a', 'b'),
        (6, 1, 'F', 'Straße', 'application/pdf', 3, x'255044', 'a', 'b'),
        (7, 1, 'G', 'STRASSE', 'application/pdf', 3, x'255044', 'a', 'b'),
        (8, 1, 'H', '', 'application/pdf', 3, x'255044', 'a', 'b'),
        (9, 1, 'I', '   ', 'application/pdf', 3, x'255044', 'a', 'b'),
        (10, 1, 'J', 'Eltern', 'application/pdf', 3, x'255044', 'a', 'b');
    `)

    migrateThrough(db, '0063')

    // No default categories beside those from the templates.
    expect(sqlite.prepare('SELECT name, sort_order FROM template_categories ORDER BY sort_order').all()).toEqual([
      { name: 'ÄRZTLICHES', sort_order: 0 }, { name: 'Eltern', sort_order: 1 }, { name: 'Sonstiges', sort_order: 2 },
      { name: 'STRASSE', sort_order: 3 }, { name: 'Übungen', sort_order: 4 }, { name: 'Zahnarzt', sort_order: 5 },
    ])
    expect(sqlite.prepare(`
      SELECT p.id, c.name FROM print_templates p JOIN template_categories c ON c.id = p.category_id ORDER BY p.id
    `).all().map(row => Object.values(row as Record<string, unknown>))).toEqual([
      [1, 'Übungen'], [2, 'Übungen'], [3, 'Zahnarzt'], [4, 'ÄRZTLICHES'], [5, 'ÄRZTLICHES'], [6, 'STRASSE'], [7, 'STRASSE'],
      [8, 'Sonstiges'], [9, 'Sonstiges'], [10, 'Eltern'],
    ])
    // The old text stays as it was.
    expect(sqlite.prepare('SELECT category FROM print_templates WHERE id IN (8, 9) ORDER BY id').all())
      .toEqual([{ category: '' }, { category: '   ' }])
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('0063 gives a database without templates (and a new one) the default categories, visible to all', () => {
    const { db, sqlite } = databaseAt('0062')
    migrateThrough(db, '0063')
    const defaults = ['Eltern', 'Gesundheit', 'Personal'].map((name, index) => ({ name, sort_order: index, visibility: 'all' }))
    expect(sqlite.prepare('SELECT name, sort_order, visibility FROM template_categories ORDER BY sort_order').all()).toEqual(defaults)
    const { db: fresh, sqlite: freshSqlite } = createDb(':memory:')
    migrateThrough(fresh, '0063')
    expect(freshSqlite.prepare('SELECT name, sort_order, visibility FROM template_categories ORDER BY sort_order').all()).toEqual(defaults)
  })

  it('0067 makes every day note a general note with its date in front and drops the kind and the date', () => {
    const { db, sqlite } = databaseAt('0066')
    sqlite.exec(`
      INSERT INTO groups (id, facility_id, name) VALUES (1, 1, 'Bären');
      INSERT INTO facility_notes (id, facility_id, group_id, kind, date, valid_until, text, created_at, created_by, updated_at, updated_by) VALUES
        (1, 1, NULL, 'board', NULL, '2026-12-31', 'Elternabend am Freitag', '2026-11-01T08:00:00.000Z', 'Lea', NULL, NULL),
        (2, 1, 1, 'day', '2026-11-12', NULL, 'Ausflug in den Wald, Abfahrt 9 Uhr.', '2026-11-02T08:00:00.000Z', 'Gina',
          '2026-11-03T08:00:00.000Z', 'Lea'),
        (3, 1, NULL, 'board', '2026-11-20', NULL, 'Pinnwand ohne Ablauf', '2026-11-04T08:00:00.000Z', 'Lea', NULL, NULL),
        (4, 1, NULL, 'day', '2026-01-05', NULL, 'Zeile 1
Zeile 2', '2026-01-01T08:00:00.000Z', 'Lea', NULL, NULL);
    `)
    migrateDb(db, MIGRATIONS)
    // Without `visibility`, which 0068_note_visibility adds (its own test below).
    const rows = (sqlite.prepare('SELECT * FROM facility_notes ORDER BY id').all() as Record<string, unknown>[])
      .map(({ visibility: _, ...rest }) => rest)
    expect(rows).toEqual([
      { id: 1, facility_id: 1, group_id: null, valid_until: '2026-12-31', text: 'Elternabend am Freitag',
        created_at: '2026-11-01T08:00:00.000Z', created_by: 'Lea', updated_at: null, updated_by: null },
      { id: 2, facility_id: 1, group_id: 1, valid_until: null, text: '12.11.2026: Ausflug in den Wald, Abfahrt 9 Uhr.',
        created_at: '2026-11-02T08:00:00.000Z', created_by: 'Gina', updated_at: '2026-11-03T08:00:00.000Z', updated_by: 'Lea' },
      { id: 3, facility_id: 1, group_id: null, valid_until: null, text: 'Pinnwand ohne Ablauf',
        created_at: '2026-11-04T08:00:00.000Z', created_by: 'Lea', updated_at: null, updated_by: null },
      { id: 4, facility_id: 1, group_id: null, valid_until: null, text: '05.01.2026: Zeile 1\nZeile 2',
        created_at: '2026-01-01T08:00:00.000Z', created_by: 'Lea', updated_at: null, updated_by: null },
    ])
    // A deleted group still makes its notes the facility's; new notes get the next id.
    sqlite.exec('DELETE FROM groups WHERE id = 1')
    expect(sqlite.prepare('SELECT group_id FROM facility_notes WHERE id = 2').get()).toEqual({ group_id: null })
    sqlite.exec('INSERT INTO facility_notes (facility_id, text, created_at, created_by) VALUES (1, \'neu\', \'now\', \'Lea\')')
    expect(sqlite.prepare('SELECT max(id) AS id FROM facility_notes').get()).toEqual({ id: 5 })
    expect(sqlite.prepare('SELECT name FROM sqlite_master WHERE type = \'index\' AND tbl_name = \'facility_notes\' AND sql IS NOT NULL').all())
      .toEqual([{ name: 'facility_notes_facility' }])
  })

  it('0068 makes every existing note visible to all and gives new ones \'all\' by default', () => {
    const { db, sqlite } = databaseAt('0067')
    sqlite.exec(`
      INSERT INTO groups (id, facility_id, name) VALUES (1, 1, 'Bären');
      INSERT INTO facility_notes (id, facility_id, group_id, valid_until, text, created_at, created_by, updated_at, updated_by) VALUES
        (1, 1, NULL, '2026-12-31', 'Elternabend am Freitag', '2026-11-01T08:00:00.000Z', 'Lea', NULL, NULL),
        (2, 1, 1, NULL, 'Ausflug', '2026-11-02T08:00:00.000Z', 'Gina', '2026-11-03T08:00:00.000Z', 'Lea');
    `)
    migrateDb(db, MIGRATIONS)
    expect(sqlite.prepare('SELECT * FROM facility_notes ORDER BY id').all()).toEqual([
      { id: 1, facility_id: 1, group_id: null, valid_until: '2026-12-31', text: 'Elternabend am Freitag',
        created_at: '2026-11-01T08:00:00.000Z', created_by: 'Lea', updated_at: null, updated_by: null, visibility: 'all' },
      { id: 2, facility_id: 1, group_id: 1, valid_until: null, text: 'Ausflug',
        created_at: '2026-11-02T08:00:00.000Z', created_by: 'Gina', updated_at: '2026-11-03T08:00:00.000Z', updated_by: 'Lea',
        visibility: 'all' },
    ])
    sqlite.exec('INSERT INTO facility_notes (facility_id, text, created_at, created_by) VALUES (1, \'neu\', \'now\', \'Lea\')')
    expect(sqlite.prepare('SELECT id, visibility FROM facility_notes WHERE text = \'neu\'').get()).toEqual({ id: 3, visibility: 'all' })
    expect(() => sqlite.exec('UPDATE facility_notes SET visibility = NULL WHERE id = 1')).toThrow(/NOT NULL/)
    expect(sqlite.prepare('SELECT name FROM sqlite_master WHERE type = \'index\' AND tbl_name = \'facility_notes\' AND sql IS NOT NULL').all())
      .toEqual([{ name: 'facility_notes_facility' }])
  })

  it('0069 marks every existing entry as not home office and new ones too by default', () => {
    const { db, sqlite } = databaseAt('0068')
    sqlite.exec(`
      INSERT INTO employees (id, facility_id, name, short_name) VALUES (1, 1, 'Anna', 'AN');
      INSERT INTO entries (id, employee_id, date, kind, start, end, updated_at) VALUES
        (1, 1, '2026-10-06', 'special', 1200, 1230, '2026-10-01T08:00:00.000Z');
    `)
    migrateDb(db, MIGRATIONS)
    expect(sqlite.prepare('SELECT id, home_office FROM entries').all()).toEqual([{ id: 1, home_office: 0 }])
    sqlite.exec('INSERT INTO entries (employee_id, date, kind, start, end, updated_at) VALUES (1, \'2026-10-07\', \'special\', 600, 660, \'now\')')
    expect(sqlite.prepare('SELECT home_office FROM entries WHERE id = 2').get()).toEqual({ home_office: 0 })
    expect(() => sqlite.exec('UPDATE entries SET home_office = NULL WHERE id = 1')).toThrow(/NOT NULL/)
  })

  it('0070 marks every existing week template entry as not home office and new ones too by default', () => {
    const { db, sqlite } = databaseAt('0069')
    sqlite.exec(`
      INSERT INTO employees (id, facility_id, name, short_name) VALUES (1, 1, 'Anna', 'AN');
      INSERT INTO week_templates (id, facility_id, name, updated_at) VALUES (1, 1, 'Normalwoche', 'now');
      INSERT INTO week_template_entries (id, week_template_id, employee_id, weekday, kind, start, end) VALUES (1, 1, 1, 0, 'special', 480, 720);
    `)
    migrateDb(db, MIGRATIONS)
    expect(sqlite.prepare('SELECT id, home_office FROM week_template_entries').all()).toEqual([{ id: 1, home_office: 0 }])
    sqlite.exec('INSERT INTO week_template_entries (week_template_id, employee_id, weekday, kind) VALUES (1, 1, 1, \'shift\')')
    expect(sqlite.prepare('SELECT home_office FROM week_template_entries WHERE id = 2').get()).toEqual({ home_office: 0 })
    expect(() => sqlite.exec('UPDATE week_template_entries SET home_office = NULL WHERE id = 1')).toThrow(/NOT NULL/)
  })

  it('0071 marks every existing shift button as not home office and new ones too by default', () => {
    const { db, sqlite } = databaseAt('0070')
    sqlite.exec('INSERT INTO shift_templates (id, short_label, label, start, end, facility_id) VALUES (1, \'F1\', \'Frühdienst\', 420, 795, 1)')
    migrateDb(db, MIGRATIONS)
    expect(sqlite.prepare('SELECT id, home_office FROM shift_templates').all()).toEqual([{ id: 1, home_office: 0 }])
    sqlite.exec('INSERT INTO shift_templates (short_label, label, start, end, facility_id) VALUES (\'M\', \'Mittel\', 465, 960, 1)')
    expect(sqlite.prepare('SELECT home_office FROM shift_templates WHERE id = 2').get()).toEqual({ home_office: 0 })
    expect(() => sqlite.exec('UPDATE shift_templates SET home_office = NULL WHERE id = 1')).toThrow(/NOT NULL/)
  })

  it('0072 adds an empty „Stundenkonto ab“ to every employee (the account starts with the weekly hours, as before)', () => {
    const { db, sqlite } = databaseAt('0071')
    sqlite.exec('INSERT INTO employees (id, name, facility_id) VALUES (1, \'Anna\', 1)')
    migrateDb(db, MIGRATIONS)
    expect(sqlite.prepare('SELECT id, name, balance_from FROM employees').all()).toEqual([{ id: 1, name: 'Anna', balance_from: null }])
  })

  it('0074 adds no training end and „Anerkennungsjahr zählt nicht“ to every employee (level years from the employment, as before)', () => {
    const { db, sqlite } = databaseAt('0073')
    sqlite.exec('INSERT INTO employees (id, name, facility_id, employed_since) VALUES (1, \'Anna\', 1, \'2021-09-01\')')
    migrateDb(db, MIGRATIONS)
    expect(sqlite.prepare('SELECT id, employed_since, training_until, recognition_year_counts FROM employees').all())
      .toEqual([{ id: 1, employed_since: '2021-09-01', training_until: null, recognition_year_counts: 0 }])
    sqlite.exec('INSERT INTO employees (id, name, facility_id) VALUES (2, \'Ben\', 1)')
    expect(sqlite.prepare('SELECT recognition_year_counts FROM employees WHERE id = 2').get()).toEqual({ recognition_year_counts: 0 })
    expect(() => sqlite.exec('UPDATE employees SET recognition_year_counts = NULL WHERE id = 1')).toThrow(/NOT NULL/)
  })

  it('0076 gives every existing facility an empty address, website, Träger and Leitung, and an empty contact list', () => {
    const { db, sqlite } = databaseAt('0075')
    sqlite.exec(`INSERT INTO facilities (id, name) VALUES (2, 'Krippe')`)
    migrateDb(db, MIGRATIONS)
    expect(sqlite.prepare('SELECT id, street, postal_code, city, website, operator_name, manager_name FROM facilities ORDER BY id').all())
      .toEqual([1, 2].map(id => ({ id, ...CONTACT_DEFAULTS })))
    expect(count(sqlite, 'facility_contacts')).toBe(0)
    sqlite.exec(`INSERT INTO facility_contacts (facility_id, kind, value, belongs_to) VALUES (1, 'phone', '0711 123', 'facility')`)
    expect(sqlite.prepare('SELECT label, sort_order FROM facility_contacts').get()).toEqual({ label: '', sort_order: 0 })
  })

  it('0083 gives every existing facility the forfeiture date 31.03. with the default text, and no read receipts', () => {
    const { db, sqlite } = databaseAt('0082')
    sqlite.exec(`INSERT INTO facilities (id, name) VALUES (2, 'Krippe')`)
    migrateDb(db, MIGRATIONS)
    expect(sqlite.prepare('SELECT id, leave_forfeit_day, leave_forfeit_month, leave_forfeit_text FROM facilities ORDER BY id').all())
      .toEqual([1, 2].map(id => ({ id, ...FORFEIT_DEFAULTS })))
    expect(count(sqlite, 'leave_forfeit_receipts')).toBe(0)
  })

  it('0087 keeps every read receipt and allows a further one of the same employee and year', () => {
    const { db, sqlite } = databaseAt('0085')
    sqlite.exec(`
      INSERT INTO employees (id, facility_id, name) VALUES (1, 1, 'Anna');
      INSERT INTO leave_forfeit_receipts (employee_id, year, days, text, read_at) VALUES (1, 2026, 5, 'Fünf Tage', '2026-11-19T10:00:00.000Z');
    `)
    expect(() => sqlite.exec(`INSERT INTO leave_forfeit_receipts (employee_id, year, days, text, read_at) VALUES (1, 2026, 6, 'Sechs', 'x')`))
      .toThrow('UNIQUE')
    migrateDb(db, MIGRATIONS)
    sqlite.exec(`INSERT INTO leave_forfeit_receipts (employee_id, year, days, text, read_at) VALUES (1, 2026, 6, 'Sechs Tage', '2026-11-20T10:00:00.000Z')`)
    expect(sqlite.prepare('SELECT days, text FROM leave_forfeit_receipts ORDER BY id').all())
      .toEqual([{ days: 5, text: 'Fünf Tage' }, { days: 6, text: 'Sechs Tage' }])
    expect(sqlite.prepare(`SELECT name, "unique" AS isUnique FROM pragma_index_list('leave_forfeit_receipts')`).all())
      .toEqual([{ name: 'leave_forfeit_receipts_employee_year', isUnique: 0 }])
  })

  it('0088 adds the health office to every facility and the empty local rules, documents and cluster acknowledgements', () => {
    const { db, sqlite } = databaseAt('0087')
    sqlite.exec(`INSERT INTO facilities (id, name) VALUES (2, 'Krippe')`)
    migrateDb(db, MIGRATIONS)
    expect(sqlite.prepare('SELECT id, health_office_name, health_office_phone FROM facilities ORDER BY id').all())
      .toEqual([1, 2].map(id => ({ id, ...HEALTH_OFFICE_DEFAULT })))
    for (const table of ['ifsg_local_rules', 'ifsg_documents', 'ifsg_cluster_acks']) expect(count(sqlite, table), table).toBe(0)
    sqlite.exec(`INSERT INTO ifsg_local_rules (facility_id, disease, updated_at) VALUES (2, 'masern', '2026-11-19')`)
    expect(() => sqlite.exec(`INSERT INTO ifsg_local_rules (facility_id, disease, updated_at) VALUES (2, 'masern', '2026-11-19')`)).toThrow('UNIQUE')
    expect(sqlite.prepare('SELECT custom, proof, rules FROM ifsg_local_rules').get()).toEqual({ custom: 0, proof: null, rules: null })
  })

  it('0091 keeps every § 34 IfSG case and gives it an empty rule snapshot (the key is resolved as before)', () => {
    const { db, sqlite } = databaseAt('0088')
    sqlite.exec(`INSERT INTO children (id, facility_id, last_name, first_name, birth_date, created_at) VALUES (1, 1, 'Meier', 'Lena', '2022-01-01', '2026-01-01')`)
    sqlite.exec(`INSERT INTO child_ifsg_cases (child_id, disease, kind, reported_on, onset_date, rule_variant, rule_date, created_at) VALUES (1, 'masern', 'sick', '2026-11-18', '2026-11-17', 'rash', '2026-11-16', '2026-11-18')`)
    migrateDb(db, MIGRATIONS)
    expect(sqlite.prepare('SELECT rule_variant, rule_date, rule_anchor, rule_days, rule_label, rule_condition FROM child_ifsg_cases').get())
      .toEqual({ rule_variant: 'rash', rule_date: '2026-11-16', rule_anchor: null, rule_days: null, rule_label: '', rule_condition: '' })
  })

  it('0093 adds the empty Mutterschutz cases (gone with the employee) and the codes Mutterschutz and Beschäftigungsverbot', () => {
    const { db, sqlite } = databaseAt('0092')
    sqlite.exec(`
      INSERT INTO absence_codes (key, label, color, credit_mode, requires_times, sort_order) VALUES
        ('sick', 'Krank', 'gray', 'daily_target', 0, 4), ('child_sick', 'Kind krank', 'gray', 'daily_target', 0, 5),
        ('office', 'Büro', 'yellow', 'timed', 1, 6), ('closure_day', 'Schließtag', 'blue', 'daily_target', 0, 13);
      INSERT INTO employees (id, name, facility_id) VALUES (1, 'Anna', 1);
    `)
    migrateDb(db, MIGRATIONS)
    expect(sqlite.prepare('SELECT key, label, color, credit_mode, requires_times, sort_order FROM absence_codes ORDER BY sort_order').all())
      .toEqual([
        { key: 'sick', label: 'Krank', color: 'gray', credit_mode: 'daily_target', requires_times: 0, sort_order: 4 },
        { key: 'child_sick', label: 'Kind krank', color: 'gray', credit_mode: 'daily_target', requires_times: 0, sort_order: 5 },
        { key: 'maternity', label: 'Mutterschutz', color: 'gray', credit_mode: 'daily_target', requires_times: 0, sort_order: 6 },
        { key: 'employment_ban', label: 'Beschäftigungsverbot', color: 'gray', credit_mode: 'daily_target', requires_times: 0, sort_order: 7 },
        { key: 'office', label: 'Büro', color: 'yellow', credit_mode: 'timed', requires_times: 1, sort_order: 8 },
        { key: 'closure_day', label: 'Schließtag', color: 'blue', credit_mode: 'daily_target', requires_times: 0, sort_order: 15 },
      ])
    expect(count(sqlite, 'maternity_cases')).toBe(0)
    sqlite.exec(`INSERT INTO maternity_cases (employee_id, notified_on, expected_birth, created_at, updated_at) VALUES (1, '2026-11-02', '2027-04-01', 'x', 'x')`)
    expect(sqlite.prepare('SELECT extended_after, employment_ban, ban_note, protection_booked, ban_booked, created_by FROM maternity_cases').get())
      .toEqual({ extended_after: 0, employment_ban: 'none', ban_note: '', protection_booked: 0, ban_booked: 0, created_by: '' })
    sqlite.exec('DELETE FROM employees WHERE id = 1')
    expect(count(sqlite, 'maternity_cases')).toBe(0)

    // A new database gets no codes from the migration (seedDefaults adds them).
    const fresh = databaseAt('0092')
    migrateDb(fresh.db, MIGRATIONS)
    expect(count(fresh.sqlite, 'absence_codes')).toBe(0)
  })

  it('0094 adds the plan sync and the miscarriage to the Mutterschutz cases and 2 years for their records', () => {
    const { db, sqlite } = databaseAt('0093')
    sqlite.exec(`
      INSERT INTO facilities (id, name) VALUES (2, 'Krippe');
      INSERT INTO retention_settings (facility_id, time_years) VALUES (2, 5);
      INSERT INTO employees (id, name, facility_id) VALUES (1, 'Anna', 1);
      INSERT INTO maternity_cases (employee_id, notified_on, expected_birth, protection_booked, created_at, updated_at)
        VALUES (1, '2026-11-02', '2027-04-01', 1, 'x', 'x');
    `)
    migrateDb(db, MIGRATIONS)
    expect(sqlite.prepare('SELECT facility_id, time_years, maternity_years FROM retention_settings').all())
      .toEqual([{ facility_id: 2, time_years: 5, maternity_years: 2 }])
    expect(sqlite.prepare('SELECT protection_booked, plan_sync, miscarriage_on, miscarriage_week, miscarriage_waived FROM maternity_cases').get())
      .toEqual({ protection_booked: 1, plan_sync: null, miscarriage_on: null, miscarriage_week: null, miscarriage_waived: 0 })
  })

  it('0095 adds the examinations of the JArbSchG as built-in kinds after each facility\'s kinds', () => {
    const { db, sqlite } = databaseAt('0094')
    sqlite.exec(`
      INSERT INTO facilities (id, name) VALUES (2, 'Krippe');
      INSERT INTO requirement_types (facility_id, name, interval_months, builtin_key, sort_order) VALUES (1, 'Hygienebelehrung', 24, NULL, 4);
    `)
    migrateDb(db, MIGRATIONS)
    const youth = (facilityId: number) => sqlite.prepare(`SELECT name, interval_months, builtin_key, sort_order FROM requirement_types
      WHERE facility_id = ? AND builtin_key LIKE 'youth%' ORDER BY sort_order`).all(facilityId)
    expect(youth(1)).toEqual([
      { name: 'Erstuntersuchung (§ 32 JArbSchG)', interval_months: null, builtin_key: 'youth_initial', sort_order: 5 },
      { name: 'Nachuntersuchung (§ 33 JArbSchG)', interval_months: null, builtin_key: 'youth_followup', sort_order: 6 },
    ])
    // A facility without any kinds yet starts at 0.
    expect(youth(2)).toEqual([
      { name: 'Erstuntersuchung (§ 32 JArbSchG)', interval_months: null, builtin_key: 'youth_initial', sort_order: 0 },
      { name: 'Nachuntersuchung (§ 33 JArbSchG)', interval_months: null, builtin_key: 'youth_followup', sort_order: 1 },
    ])
  })

  it('0092 adds the empty BEM tables (gone with the employee), the default invitation text and 3 years for BEM records', () => {
    const { db, sqlite } = databaseAt('0091')
    sqlite.exec(`INSERT INTO facilities (id, name) VALUES (2, 'Krippe')`)
    sqlite.exec(`INSERT INTO retention_settings (facility_id, time_years) VALUES (2, 5)`)
    sqlite.exec(`INSERT INTO employees (id, name, facility_id) VALUES (1, 'Anna', 1)`)
    migrateDb(db, MIGRATIONS)
    expect(sqlite.prepare('SELECT id, bem_invitation_text FROM facilities ORDER BY id').all())
      .toEqual([{ id: 1, bem_invitation_text: null }, { id: 2, bem_invitation_text: null }])
    expect(sqlite.prepare('SELECT facility_id, time_years, bem_years FROM retention_settings').all())
      .toEqual([{ facility_id: 2, time_years: 5, bem_years: 3 }])
    expect(count(sqlite, 'bem_processes')).toBe(0)
    expect(count(sqlite, 'bem_steps')).toBe(0)
    sqlite.exec(`INSERT INTO bem_processes (id, employee_id, created_at, updated_at) VALUES (1, 1, 'x', 'x')`)
    sqlite.exec(`INSERT INTO bem_steps (process_id, kind, date, created_at, updated_at) VALUES (1, 'note', '2026-11-19', 'x', 'x')`)
    expect(sqlite.prepare('SELECT status, invited_on, created_by FROM bem_processes').get())
      .toEqual({ status: 'invited', invited_on: null, created_by: '' })
    sqlite.exec('DELETE FROM employees WHERE id = 1')
    expect(count(sqlite, 'bem_processes')).toBe(0)
    expect(count(sqlite, 'bem_steps')).toBe(0)
  })

  it('0084 adds the empty § 34 IfSG cases, gone with their child, and the attest setting off', () => {
    const { db, sqlite } = databaseAt('0083')
    sqlite.exec(`INSERT INTO facilities (id, name) VALUES (2, 'Krippe')`)
    migrateDb(db, MIGRATIONS)
    expect(sqlite.prepare('SELECT id, ifsg_require_attest FROM facilities ORDER BY id').all())
      .toEqual([1, 2].map(id => ({ id, ...IFSG_DEFAULT })))
    expect(count(sqlite, 'child_ifsg_cases')).toBe(0)
    sqlite.exec(`INSERT INTO children (id, facility_id, last_name, first_name, birth_date, created_at) VALUES (1, 1, 'Meier', 'Lena', '2022-01-01', '2026-01-01')`)
    sqlite.exec(`INSERT INTO child_ifsg_cases (child_id, disease, kind, reported_on, onset_date, created_at) VALUES (1, 'masern', 'sick', '2026-11-18', '2026-11-17', '2026-11-18')`)
    expect(sqlite.prepare('SELECT facility_id, physician_reported, ended, readmitted_on FROM child_ifsg_cases').get())
      .toEqual({ facility_id: 1, physician_reported: 0, ended: 0, readmitted_on: null })
    sqlite.exec('DELETE FROM children WHERE id = 1')
    expect(count(sqlite, 'child_ifsg_cases')).toBe(0)
  })

  it('0085 adds the consent tables for the emergency contacts at the tablet, empty: nobody has consented', () => {
    const { db, sqlite } = databaseAt('0084')
    sqlite.exec(`INSERT INTO employees (id, name, facility_id) VALUES (1, 'Anna', 1)`)
    migrateDb(db, MIGRATIONS)
    expect(count(sqlite, 'employee_emergency_consent')).toBe(0)
    expect(count(sqlite, 'employee_emergency_consent_log')).toBe(0)
    // The consent and its log go with the employee row.
    sqlite.exec(`INSERT INTO employee_emergency_consent (employee_id, consent_at, consent_date, consent_by, source) VALUES (1, '2026-10-06T06:00:00.000Z', '2026-10-06', 'self', 'self')`)
    sqlite.exec(`INSERT INTO employee_emergency_consent_log (employee_id, granted, source, by, at, date) VALUES (1, 1, 'self', 'self', '2026-10-06T06:00:00.000Z', '2026-10-06')`)
    expect(sqlite.prepare('SELECT consent FROM employee_emergency_consent').get()).toEqual({ consent: 0 })
    sqlite.exec('DELETE FROM employees WHERE id = 1')
    expect(count(sqlite, 'employee_emergency_consent')).toBe(0)
    expect(count(sqlite, 'employee_emergency_consent_log')).toBe(0)
  })

  it('0096 adds the empty uses of week templates; a deleted template leaves its uses with their name', () => {
    const { db, sqlite } = databaseAt('0095')
    sqlite.exec(`INSERT INTO week_templates (id, facility_id, name, updated_at) VALUES (1, 1, 'Woche A', '2026-10-01T08:00:00.000Z')`)
    migrateDb(db, MIGRATIONS)
    expect(count(sqlite, 'week_template_uses')).toBe(0)
    sqlite.exec(`INSERT INTO week_template_uses (facility_id, week_start, template_id, template_name, applied_at, applied_by, week_fingerprint)
      VALUES (1, '2026-10-12', 1, 'Woche A', '2026-10-01T08:00:00.000Z', 'leitung', 'x')`)
    sqlite.exec('DELETE FROM week_templates WHERE id = 1')
    expect(sqlite.prepare('SELECT template_id, template_name FROM week_template_uses').all()).toEqual([{ template_id: null, template_name: 'Woche A' }])
    expect(() => sqlite.exec(`INSERT INTO week_template_uses (facility_id, week_start, template_name, applied_at, applied_by, week_fingerprint)
      VALUES (99, '2026-10-12', 'B', '2026-10-01', 'x', 'x')`)).toThrow(/FOREIGN KEY/)
  })

  it('0097 adds the empty Info 1 / Info 2 of week templates, one row per weekday, gone with their template', () => {
    const { db, sqlite } = databaseAt('0096')
    sqlite.exec(`INSERT INTO week_templates (id, facility_id, name, updated_at) VALUES (1, 1, 'Woche A', '2026-10-01T08:00:00.000Z')`)
    migrateDb(db, MIGRATIONS)
    expect(count(sqlite, 'week_template_infos')).toBe(0)
    sqlite.exec(`INSERT INTO week_template_infos (week_template_id, weekday, info1) VALUES (1, 0, 'Elternabend')`)
    expect(sqlite.prepare('SELECT weekday, info1, info2 FROM week_template_infos').all()).toEqual([{ weekday: 0, info1: 'Elternabend', info2: '' }])
    expect(() => sqlite.exec(`INSERT INTO week_template_infos (week_template_id, weekday) VALUES (1, 0)`)).toThrow(/UNIQUE/)
    sqlite.exec('DELETE FROM week_templates WHERE id = 1')
    expect(count(sqlite, 'week_template_infos')).toBe(0)
  })

  it('0098 switches „Wir arbeiten nach TVöD SuE“ on for every facility and keeps the leave choice for 24/31.12', () => {
    const { db, sqlite } = databaseAt('0097')
    sqlite.exec(`INSERT INTO facilities (id, name, christmas_eve_half_leave) VALUES (2, 'Krippe', 1)`)
    migrateDb(db, MIGRATIONS)
    expect(sqlite.prepare('SELECT id, tvoed_sue, christmas_eve_paid_free, christmas_eve_half_leave FROM facilities ORDER BY id').all()).toEqual([
      { id: 1, tvoed_sue: 1, christmas_eve_paid_free: 0, christmas_eve_half_leave: 0 },
      { id: 2, tvoed_sue: 1, christmas_eve_paid_free: 0, christmas_eve_half_leave: 1 },
    ])
    sqlite.exec(`INSERT INTO facilities (id, name) VALUES (3, 'Hort')`)
    expect(sqlite.prepare('SELECT tvoed_sue FROM facilities WHERE id = 3').get()).toEqual({ tvoed_sue: 1 })
  })

  it('0099 adds an empty „Probezeit bis“ to the employees', () => {
    const { db, sqlite } = databaseAt('0098')
    sqlite.exec(`INSERT INTO employees (id, name, facility_id, employed_since) VALUES (1, 'Anna', 1, '2026-03-01')`)
    migrateDb(db, MIGRATIONS)
    expect(sqlite.prepare('SELECT employed_since, probation_until FROM employees').get()).toEqual({ employed_since: '2026-03-01', probation_until: null })
  })

  it('0100 keeps today\'s „Sofort“ for Lohn und Steuer: a Lohnbüro keeps the records in every facility', () => {
    const { db, sqlite } = databaseAt('0099')
    sqlite.exec(`INSERT INTO retention_settings (facility_id, time_years) VALUES (1, 4)`)
    migrateDb(db, MIGRATIONS)
    expect(sqlite.prepare('SELECT facility_id, time_years, payroll_office FROM retention_settings').all())
      .toEqual([{ facility_id: 1, time_years: 4, payroll_office: 1 }])
  })

  it('0101 keeps each facility\'s whole/half leave day for all years and makes 24/31.12. paid free from 2026 under TVöD', () => {
    const { db, sqlite } = databaseAt('0100')
    sqlite.exec(`INSERT INTO facilities (id, name, tvoed_sue, christmas_eve_half_leave) VALUES (2, 'Krippe', 0, 1)`)
    sqlite.exec(`INSERT INTO facilities (id, name, tvoed_sue, christmas_eve_paid_free) VALUES (3, 'Hort', 0, 1)`)
    migrateDb(db, MIGRATIONS)
    expect(sqlite.prepare('SELECT facility_id, from_year, mode FROM facility_eve_rules ORDER BY facility_id, from_year').all()).toEqual([
      { facility_id: 1, from_year: 0, mode: 'whole' }, { facility_id: 1, from_year: 2026, mode: 'paid' },
      { facility_id: 2, from_year: 0, mode: 'half' },
      { facility_id: 3, from_year: 0, mode: 'whole' }, { facility_id: 3, from_year: 2026, mode: 'paid' },
    ])
    expect(() => sqlite.exec(`INSERT INTO facility_eve_rules (facility_id, from_year, mode) VALUES (1, 2026, 'whole')`)).toThrow(/UNIQUE|PRIMARY/)
    expect(() => sqlite.exec(`INSERT INTO facility_eve_rules (facility_id, from_year, mode) VALUES (99, 2026, 'paid')`)).toThrow(/FOREIGN KEY/)
  })

  it('0102 gives the Betriebsarzt the ArbMedVV intervals (second after 12, then every 36 months) where it still has 24', () => {
    const { db, sqlite } = databaseAt('0101')
    sqlite.exec(`
      INSERT INTO facilities (id, name) VALUES (2, 'Krippe');
      INSERT INTO requirement_types (facility_id, name, interval_months, builtin_key, sort_order) VALUES (2, 'Betriebsarzt', 18, 'company_doctor', 0);
      INSERT INTO requirement_types (facility_id, name, interval_months, builtin_key, sort_order) VALUES (2, 'Eigene Vorsorge', 24, NULL, 1);
    `)
    migrateDb(db, MIGRATIONS)
    expect(sqlite.prepare(`SELECT facility_id, name, interval_months, first_interval_months FROM requirement_types
      WHERE builtin_key = 'company_doctor' OR name = 'Eigene Vorsorge' ORDER BY facility_id, sort_order`).all()).toEqual([
      { facility_id: 1, name: 'Betriebsarzt', interval_months: 36, first_interval_months: 12 },
      // An interval the facility set itself, and an own kind, stay.
      { facility_id: 2, name: 'Betriebsarzt', interval_months: 18, first_interval_months: null },
      { facility_id: 2, name: 'Eigene Vorsorge', interval_months: 24, first_interval_months: null },
    ])
  })

  it('0103 adds the Belehrung of § 34 Abs. 5a IfSG as a built-in kind after each facility\'s kinds (an own one of that name becomes it)', () => {
    const { db, sqlite } = databaseAt('0102')
    sqlite.exec(`
      INSERT INTO facilities (id, name) VALUES (2, 'Krippe'), (3, 'Hort');
      INSERT INTO requirement_types (id, facility_id, name, interval_months, builtin_key, sort_order) VALUES (100, 2, 'belehrung infektionsschutz (§ 34 abs. 5a ifsg)', 12, NULL, 0);
    `)
    migrateDb(db, MIGRATIONS)
    const briefing = (facilityId: number) => sqlite.prepare(`SELECT id, name, interval_months, sort_order FROM requirement_types
      WHERE facility_id = ? AND builtin_key = 'ifsg_briefing'`).all(facilityId)
    const lastOrder = (sqlite.prepare(`SELECT max(sort_order) AS n FROM requirement_types WHERE facility_id = 1 AND builtin_key != 'ifsg_briefing'`).get() as { n: number }).n
    expect(briefing(1)).toEqual([{ id: expect.any(Number), name: 'Belehrung Infektionsschutz (§ 34 Abs. 5a IfSG)', interval_months: 24, sort_order: lastOrder + 1 }])
    expect(briefing(2)).toEqual([{ id: 100, name: 'belehrung infektionsschutz (§ 34 abs. 5a ifsg)', interval_months: 12, sort_order: 0 }])
    expect(briefing(3)).toEqual([{ id: expect.any(Number), name: 'Belehrung Infektionsschutz (§ 34 Abs. 5a IfSG)', interval_months: 24, sort_order: 0 }])
  })

  it('0104 adds the document type for the Impfberatung (§ 34 Abs. 10a IfSG): important, not required, after each facility\'s types', () => {
    const { db, sqlite } = databaseAt('0103')
    sqlite.exec(`INSERT INTO facilities (id, name) VALUES (2, 'Krippe')`)
    sqlite.exec(`INSERT INTO document_types (facility_id, name, important, required, sort_order) VALUES (2, 'Nachweis ärztliche Impfberatung (§ 34 Abs. 10a IfSG)', 0, 0, 3)`)
    migrateDb(db, MIGRATIONS)
    const types = (facilityId: number) => sqlite.prepare(`SELECT name, important, required, confidential_default, sort_order FROM document_types
      WHERE facility_id = ? AND name LIKE 'Nachweis ärztliche Impfberatung%'`).all(facilityId)
    expect(types(1)).toEqual([{ name: 'Nachweis ärztliche Impfberatung (§ 34 Abs. 10a IfSG)', important: 1, required: 0, confidential_default: 0, sort_order: 7 }])
    // A facility that has it already keeps its own.
    expect(types(2)).toEqual([{ name: 'Nachweis ärztliche Impfberatung (§ 34 Abs. 10a IfSG)', important: 0, required: 0, confidential_default: 0, sort_order: 3 }])
  })

  it('0105 keeps vouchers 8 instead of 10 years (§ 147 AO, § 257 HGB since 2025) unless the Träger set another period', () => {
    const { db, sqlite } = databaseAt('0104')
    sqlite.exec(`INSERT INTO facilities (id, name) VALUES (2, 'Krippe'), (3, 'Hort')`)
    sqlite.exec(`INSERT INTO retention_settings (facility_id, time_years, paid_overtime_years) VALUES (1, 4, 10), (2, 2, 12)`)
    migrateDb(db, MIGRATIONS)
    expect(sqlite.prepare('SELECT facility_id, time_years, paid_overtime_years FROM retention_settings ORDER BY facility_id').all())
      .toEqual([{ facility_id: 1, time_years: 4, paid_overtime_years: 8 }, { facility_id: 2, time_years: 2, paid_overtime_years: 12 }])
    sqlite.exec('INSERT INTO retention_settings (facility_id) VALUES (3)')
    expect(sqlite.prepare('SELECT paid_overtime_years FROM retention_settings WHERE facility_id = 3').get()).toEqual({ paid_overtime_years: 8 })
    // The settings still go with their facility.
    sqlite.exec('DELETE FROM requirement_types WHERE facility_id = 3; DELETE FROM document_types WHERE facility_id = 3; DELETE FROM facilities WHERE id = 3')
    expect(count(sqlite, 'retention_settings')).toBe(2)
  })

  it('0106 moves the former school cutoff presets of HH, BY, NW and TH to the day the 6th year is completed; other cutoffs stay', () => {
    const { db, sqlite } = databaseAt('0105')
    sqlite.exec(`
      INSERT INTO facilities (id, name, state, school_cutoff_month, school_cutoff_day) VALUES
        (2, 'HH', 'HH', 7, 1), (3, 'BY', 'BY', 9, 30), (4, 'NW', 'NW', 9, 30), (5, 'BE', 'BE', 9, 30), (6, 'TH', 'TH', 8, 1),
        (7, 'HH eigen', 'HH', 8, 1), (8, 'BY eigen', 'BY', 9, 15), (9, 'NW mit 7', 'NW', 9, 30), (10, 'TH eigen', 'TH', 7, 1),
        (11, 'BW mit 1.7.', 'BW', 7, 1);
      UPDATE facilities SET school_age_years = 7 WHERE id = 9;
    `)
    // Only through 0106: 0110_school_cutoff_birthday reverses it (tested there).
    migrateThrough(db, '0106')
    expect(sqlite.prepare('SELECT id, school_cutoff_month AS month, school_cutoff_day AS day FROM facilities WHERE id > 1 ORDER BY id').all()).toEqual([
      { id: 2, month: 6, day: 30 }, { id: 3, month: 9, day: 29 }, { id: 4, month: 9, day: 29 }, { id: 5, month: 9, day: 30 },
      { id: 6, month: 7, day: 31 },
      { id: 7, month: 8, day: 1 }, { id: 8, month: 9, day: 15 }, { id: 9, month: 9, day: 30 }, { id: 10, month: 7, day: 1 },
      { id: 11, month: 7, day: 1 },
    ])
  })

  it('0110 sets the school cutoffs 0106 changed back to the birthday presets (HH 01.07., BY/NW 30.09., TH 01.08.); other cutoffs stay', () => {
    // As 0106 left them (or as facilities created since got them): the reversed values, beside cutoffs set otherwise.
    const { db, sqlite } = databaseAt('0109')
    sqlite.exec(`
      INSERT INTO facilities (id, name, state, school_cutoff_month, school_cutoff_day) VALUES
        (2, 'HH', 'HH', 6, 30), (3, 'BY', 'BY', 9, 29), (4, 'NW', 'NW', 9, 29), (5, 'TH', 'TH', 7, 31),
        (6, 'HH eigen', 'HH', 6, 15), (7, 'BE mit 29.9.', 'BE', 9, 29), (8, 'NW mit 7', 'NW', 9, 29), (9, 'BW', 'BW', 6, 30),
        (10, 'TH schon 1.8.', 'TH', 8, 1), (11, 'BY eigen', 'BY', 9, 15);
      UPDATE facilities SET school_age_years = 7 WHERE id = 8;
    `)
    migrateThrough(db, '0110')
    expect(sqlite.prepare('SELECT id, school_cutoff_month AS month, school_cutoff_day AS day, school_age_years AS age FROM facilities WHERE id > 1 ORDER BY id').all()).toEqual([
      { id: 2, month: 7, day: 1, age: 6 }, { id: 3, month: 9, day: 30, age: 6 }, { id: 4, month: 9, day: 30, age: 6 },
      { id: 5, month: 8, day: 1, age: 6 },
      // Set by hand, another state, another age, Baden-Württemberg, already the preset: unchanged.
      { id: 6, month: 6, day: 15, age: 6 }, { id: 7, month: 9, day: 29, age: 6 }, { id: 8, month: 9, day: 29, age: 7 },
      { id: 9, month: 6, day: 30, age: 6 }, { id: 10, month: 8, day: 1, age: 6 }, { id: 11, month: 9, day: 15, age: 6 },
    ])
  })

  it('0107 adds the empty one-off extra leave days („Zusatztag nur für dieses Jahr“), gone with their employee', () => {
    const { db, sqlite } = databaseAt('0106')
    sqlite.exec(`INSERT INTO employees (id, name, facility_id) VALUES (1, 'Anna', 1)`)
    migrateDb(db, MIGRATIONS)
    expect(count(sqlite, 'leave_extra_days')).toBe(0)
    sqlite.exec(`INSERT INTO leave_extra_days (employee_id, year, days, reason, created_at) VALUES (1, 2026, 1.5, 'Dank für Sommerfest', '2026-11-20T08:00:00.000Z')`)
    expect(sqlite.prepare('SELECT year, days, reason, created_by FROM leave_extra_days').all())
      .toEqual([{ year: 2026, days: 1.5, reason: 'Dank für Sommerfest', created_by: '' }])
    expect(() => sqlite.exec(`INSERT INTO leave_extra_days (employee_id, year, days, reason, created_at) VALUES (99, 2026, 1, 'x', 'x')`))
      .toThrow(/FOREIGN KEY/)
    sqlite.exec('DELETE FROM employees WHERE id = 1')
    expect(count(sqlite, 'leave_extra_days')).toBe(0)
  })

  it('0108 copies the template categories into every facility, re-points the templates and files the global ones by name', () => {
    const { db, sqlite } = databaseAt('0107')
    // 0063 left the default categories Eltern, Gesundheit and Personal (ids 1–3).
    sqlite.exec(`
      INSERT INTO facilities (id, name) VALUES (2, 'Krippe');
      INSERT INTO users (id, username, password_hash, role) VALUES (1, 'traeger', 'x', 'provider');
      INSERT INTO template_categories (id, name, sort_order, visibility) VALUES
        (4, 'Leitung intern', 3, 'managers'), (5, 'MITARBEITERMAPPE', 4, 'all'), (6, 'Träger intern', 5, 'provider');
      INSERT INTO print_templates (id, facility_id, title, category_id, mime_type, size, data, uploaded_by, uploaded_at, updated_at) VALUES
        (1, 1, 'Zahnarzt', 2, 'application/pdf', 3, x'255044', 1, 'a', 'b'),
        (2, 2, 'Ausflug', 1, 'application/pdf', 3, x'255044', NULL, 'a', 'b'),
        (3, NULL, 'Urlaubsantrag', 3, 'application/pdf', 3, x'255044', 1, 'a', 'b'),
        (4, NULL, 'Interna', 4, 'application/pdf', 3, x'255044', 1, 'a', 'b'),
        (5, 2, 'Mappe', 5, 'application/pdf', 3, x'255044', 1, 'a', 'b'),
        (6, NULL, 'Geheim', 6, 'application/pdf', 3, x'255044', 1, 'a', 'b');
    `)
    const before = sqlite.prepare('SELECT * FROM print_templates ORDER BY id').all() as Record<string, unknown>[]

    // Only through 0108, so a later migration of these tables does not change the result.
    migrateThrough(db, '0108')

    // Each facility its own copy, same names, order and visibility (numbered from 2 on); „Eingewöhnungsmappe“ first (0),
    // „Mitarbeitermappe“ not again: the one there (in other letter case) keeps its place, so 1 stays free.
    const perFacility = [
      ['Eingewöhnungsmappe', 0, 'all'], ['Eltern', 2, 'all'], ['Gesundheit', 3, 'all'], ['Personal', 4, 'all'],
      ['Leitung intern', 5, 'managers'], ['MITARBEITERMAPPE', 6, 'all'], ['Träger intern', 7, 'provider'],
    ]
    expect(sqlite.prepare('SELECT facility_id, name, sort_order, visibility FROM template_categories ORDER BY facility_id, sort_order, id').all()
      .map(row => Object.values(row as Record<string, unknown>)))
      .toEqual([1, 2].flatMap(facility => perFacility.map(row => [facility, ...row])))
    const after = sqlite.prepare(`
      SELECT p.*, c.facility_id AS category_facility, c.name AS category_row_name
      FROM print_templates p LEFT JOIN template_categories c ON c.id = p.category_id ORDER BY p.id
    `).all() as Record<string, unknown>[]
    expect(after.map(row => [row.id, row.category_facility, row.category_row_name, row.category_name, row.visibility])).toEqual([
      [1, 1, 'Gesundheit', null, 'all'],
      [2, 2, 'Eltern', null, 'all'],
      // For all facilities: no category row, but the name and the visibility of the former category.
      [3, null, null, 'Personal', 'all'],
      [4, null, null, 'Leitung intern', 'managers'],
      [5, 2, 'MITARBEITERMAPPE', null, 'all'],
      // From a category for the Träger alone: stays the Träger's (also where a facility deletes its copy).
      [6, null, null, 'Träger intern', 'provider'],
    ])
    expect(after.map(({ category_id: _id, category_name: _name, visibility: _visibility, category_facility: _f, category_row_name: _n, ...rest }) => rest))
      .toEqual(before.map(({ category_id: _id, ...rest }) => rest))
    expect(sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('print_templates', 'template_categories') ORDER BY name`).all())
      .toEqual([{ name: 'print_templates_category' }, { name: 'print_templates_facility' }, { name: 'template_categories_facility_name' }])
    expect(sqlite.prepare('PRAGMA foreign_key_list(template_categories)').all()
      .map(fk => { const { table, from, on_delete } = fk as Record<string, string>; return { table, from, on_delete } }))
      .toEqual([{ table: 'facilities', from: 'facility_id', on_delete: 'CASCADE' }])
    // Unique per facility regardless of (ASCII) case; the same name in another facility is fine.
    expect(() => sqlite.exec(`INSERT INTO template_categories (facility_id, name) VALUES (1, 'ELTERN')`)).toThrow(/UNIQUE/)
    sqlite.exec(`INSERT INTO template_categories (facility_id, name) VALUES (1, 'Küche'), (2, 'Küche')`)
    expect(() => sqlite.exec(`INSERT INTO template_categories (facility_id, name) VALUES (99, 'X')`)).toThrow(/FOREIGN KEY/)
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    // The categories go with their facility (its templates as well).
    sqlite.exec('DELETE FROM facilities WHERE id = 2')
    expect(sqlite.prepare('SELECT DISTINCT facility_id FROM template_categories').all()).toEqual([{ facility_id: 1 }])
    expect(sqlite.prepare('SELECT id FROM print_templates ORDER BY id').all()).toEqual([{ id: 1 }, { id: 3 }, { id: 4 }, { id: 6 }])
  })

  it('0108 skips a folder named alike under the German fold (umlaut in other case) and adds the other one second', () => {
    const { db, sqlite } = databaseAt('0107')
    // SQLite's lower() leaves Ö alone; the migration folds it like the app does.
    sqlite.exec(`INSERT INTO template_categories (id, name, sort_order, visibility) VALUES (4, ' EINGEWÖHNUNGSMAPPE ', 3, 'managers')`)
    migrateThrough(db, '0108')
    expect(sqlite.prepare('SELECT name, sort_order, visibility FROM template_categories WHERE facility_id = 1 ORDER BY sort_order, id').all())
      .toEqual([
        { name: 'Mitarbeitermappe', sort_order: 1, visibility: 'all' },
        { name: 'Eltern', sort_order: 2, visibility: 'all' },
        { name: 'Gesundheit', sort_order: 3, visibility: 'all' },
        { name: 'Personal', sort_order: 4, visibility: 'all' },
        { name: ' EINGEWÖHNUNGSMAPPE ', sort_order: 5, visibility: 'managers' },
      ])
  })

  it('0108 gives a new database the default categories of a new facility, the two folders first', () => {
    const { db, sqlite } = createDb(':memory:')
    migrateDb(db, MIGRATIONS)
    expect(sqlite.prepare('SELECT facility_id, name, visibility FROM template_categories ORDER BY sort_order, id').all())
      .toEqual(DEFAULT_TEMPLATE_CATEGORIES.map(name => ({ facility_id: 1, name, visibility: 'all' })))
    expect(DEFAULT_TEMPLATE_CATEGORIES).toEqual(['Eingewöhnungsmappe', 'Mitarbeitermappe', 'Eltern', 'Gesundheit', 'Personal'])
  })

  it('0112 adds „fillable“ to templates and documents: PDFs of before not judged yet (null), every other file no form', () => {
    const { db, sqlite } = databaseAt('0110')
    sqlite.exec(`
      INSERT INTO print_templates (id, facility_id, title, category_id, mime_type, size, data, uploaded_at, updated_at) VALUES
        (1, 1, 'Bogen', (SELECT min(id) FROM template_categories), 'application/pdf', 1, x'25', 'a', 'a');
      INSERT INTO children (id, facility_id, last_name, first_name, birth_date, created_at) VALUES (1, 1, 'Muster', 'Kind', '2021-03-15', 'x');
      INSERT INTO child_documents (id, child_id, document_type_id, mime_type, size, data, uploaded_at) VALUES
        (1, 1, (SELECT min(id) FROM document_types), 'application/pdf', 1, x'25', 'a'),
        (2, 1, (SELECT min(id) FROM document_types), 'image/png', 1, x'89', 'a');
      INSERT INTO employees (id, name, short_name, sort_order, facility_id) VALUES (1, 'Anna', 'An', 1, 1);
      INSERT INTO employee_documents (id, employee_id, folder, mime_type, size, data, uploaded_at) VALUES
        (1, 1, 'contract', 'image/jpeg', 1, x'ff', 'a'), (2, 1, 'contract', 'application/pdf', 1, x'25', 'a');
    `)
    migrateDb(db, MIGRATIONS)
    const fillable = (table: string) => sqlite.prepare(`SELECT id, fillable FROM ${table} ORDER BY id`).all()
    expect(fillable('print_templates')).toEqual([{ id: 1, fillable: null }])
    expect(fillable('child_documents')).toEqual([{ id: 1, fillable: null }, { id: 2, fillable: 0 }])
    expect(fillable('employee_documents')).toEqual([{ id: 1, fillable: 0 }, { id: 2, fillable: null }])
  })

  it('0113 adds the empty order of the templates per facility, gone with the facility or the template, one row each', () => {
    const { db, sqlite } = databaseAt('0112')
    sqlite.exec(`
      INSERT INTO facilities (id, name) VALUES (2, 'Zweite');
      INSERT INTO print_templates (id, facility_id, title, category_id, mime_type, size, data, uploaded_at, updated_at) VALUES
        (1, 1, 'Bogen', (SELECT min(id) FROM template_categories), 'application/pdf', 1, x'25', 'a', 'a');
      INSERT INTO print_templates (id, facility_id, title, category_name, mime_type, size, data, uploaded_at, updated_at) VALUES
        (2, NULL, 'Für alle', 'Eltern', 'application/pdf', 1, x'25', 'a', 'a');
    `)
    migrateDb(db, MIGRATIONS)
    expect(count(sqlite, 'print_template_order')).toBe(0)
    sqlite.exec('INSERT INTO print_template_order (facility_id, template_id, sort_order) VALUES (1, 1, 0), (1, 2, 1), (2, 2, 0)')
    expect(() => sqlite.exec('INSERT INTO print_template_order (facility_id, template_id, sort_order) VALUES (1, 2, 5)')).toThrow(/UNIQUE/)
    expect(() => sqlite.exec('INSERT INTO print_template_order (facility_id, template_id, sort_order) VALUES (1, 99, 5)')).toThrow(/FOREIGN KEY/)
    sqlite.exec('DELETE FROM print_templates WHERE id = 1')
    expect(sqlite.prepare('SELECT facility_id, template_id FROM print_template_order ORDER BY facility_id').all())
      .toEqual([{ facility_id: 1, template_id: 2 }, { facility_id: 2, template_id: 2 }])
    sqlite.exec('DELETE FROM facilities WHERE id = 2')
    expect(sqlite.prepare('SELECT facility_id, template_id FROM print_template_order').all()).toEqual([{ facility_id: 1, template_id: 2 }])
  })

  it('0114 adds „Wissen“: categories per facility, entries, confirmations per person and the starter record, gone with their owners', () => {
    const { db, sqlite } = databaseAt('0113')
    sqlite.exec(`
      INSERT INTO facilities (id, name) VALUES (2, 'Krippe');
      INSERT INTO employees (id, name, short_name, facility_id) VALUES (1, 'Tina', 'TI', 1);
    `)
    migrateDb(db, MIGRATIONS)
    // The migration adds no rows: the starters come with the next start (seedDefaults), recorded per key.
    for (const table of ['knowledge_categories', 'knowledge_entries', 'knowledge_confirmations', 'knowledge_starter_seeds']) {
      expect(count(sqlite, table), table).toBe(0)
    }
    sqlite.exec(`
      INSERT INTO knowledge_categories (id, facility_id, name) VALUES (1, 1, 'Kinderschutz'), (2, 2, 'Kinderschutz');
      INSERT INTO knowledge_entries (id, facility_id, category_id, kind, title, version_at, created_at, updated_at) VALUES (1, 1, 1, 'link', 'Konzept', 'a', 'a', 'a');
      INSERT INTO knowledge_entries (id, facility_id, category_name, kind, title, version_at, created_at, updated_at) VALUES (2, NULL, 'Hygiene', 'text', 'Für alle', 'a', 'a', 'a');
      INSERT INTO knowledge_entries (id, facility_id, category_id, kind, title, version_at, created_at, updated_at) VALUES (3, 2, 2, 'link', 'Krippe', 'a', 'a', 'a');
      INSERT INTO knowledge_confirmations (entry_id, employee_id, entry_version, confirmed_at, via) VALUES (1, 1, 1, 'a', 'account'), (2, 1, 1, 'a', 'tablet');
      INSERT INTO knowledge_starter_seeds (facility_id, starter_key, seeded_at) VALUES (2, 'category:kinderschutz', 'a');
    `)
    expect(sqlite.prepare('SELECT visibility, description, as_of, url, body, needs_confirmation, version, sort_order, file_data FROM knowledge_entries WHERE id = 1').get())
      .toEqual({ visibility: 'all', description: '', as_of: null, url: '', body: '', needs_confirmation: 0, version: 1, sort_order: 0, file_data: null })
    expect(sqlite.prepare('SELECT sort_order, visibility FROM knowledge_categories WHERE id = 1').get()).toEqual({ sort_order: 0, visibility: 'all' })
    // Names unique per facility regardless of (ASCII) case; one confirmation per entry and person.
    expect(() => sqlite.exec(`INSERT INTO knowledge_categories (facility_id, name) VALUES (1, 'KINDERSCHUTZ')`)).toThrow(/UNIQUE/)
    // Every entry knows when its current version came (printed on the proof).
    expect(() => sqlite.exec(`INSERT INTO knowledge_entries (facility_id, category_id, kind, title, created_at, updated_at) VALUES (1, 1, 'link', 'X', 'a', 'a')`)).toThrow(/NOT NULL/)
    expect(() => sqlite.exec(`INSERT INTO knowledge_confirmations (entry_id, employee_id, entry_version, confirmed_at, via) VALUES (1, 1, 2, 'b', 'account')`)).toThrow(/UNIQUE|PRIMARY/)
    const fks = (table: string) => sqlite.prepare(`PRAGMA foreign_key_list(${table})`).all()
      .map(fk => { const { table: to, from, on_delete } = fk as Record<string, string>; return { to, from, on_delete } })
    expect(fks('knowledge_categories')).toEqual([{ to: 'facilities', from: 'facility_id', on_delete: 'CASCADE' }])
    expect(fks('knowledge_entries')).toEqual(expect.arrayContaining([
      { to: 'facilities', from: 'facility_id', on_delete: 'CASCADE' },
      { to: 'knowledge_categories', from: 'category_id', on_delete: 'NO ACTION' },
      { to: 'users', from: 'created_by', on_delete: 'SET NULL' },
      { to: 'users', from: 'updated_by', on_delete: 'SET NULL' },
    ]))
    expect(fks('knowledge_confirmations')).toEqual(expect.arrayContaining([
      { to: 'knowledge_entries', from: 'entry_id', on_delete: 'CASCADE' },
      { to: 'employees', from: 'employee_id', on_delete: 'CASCADE' },
    ]))
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    // Confirmations go with their entry and with the employee.
    sqlite.exec('DELETE FROM knowledge_entries WHERE id = 1')
    expect(sqlite.prepare('SELECT entry_id FROM knowledge_confirmations').all()).toEqual([{ entry_id: 2 }])
    sqlite.exec('DELETE FROM employees WHERE id = 1')
    expect(count(sqlite, 'knowledge_confirmations')).toBe(0)
    // Categories, entries and the starter record go with their facility; entries for all facilities stay.
    sqlite.exec('DELETE FROM facilities WHERE id = 2')
    expect(sqlite.prepare('SELECT id FROM knowledge_categories').all()).toEqual([{ id: 1 }])
    expect(sqlite.prepare('SELECT id FROM knowledge_entries').all()).toEqual([{ id: 2 }])
    expect(count(sqlite, 'knowledge_starter_seeds')).toBe(0)
  })

  it('adds version_at to a test database that ran 0114 before it was amended, and seeds it afterwards', () => {
    const { db, sqlite } = databaseAt('0114')
    sqlite.exec(`
      ALTER TABLE knowledge_entries DROP COLUMN version_at;
      INSERT INTO knowledge_categories (id, facility_id, name) VALUES (1, 1, 'Eigenes');
      INSERT INTO knowledge_entries (id, facility_id, category_id, kind, title, created_at, updated_at) VALUES (1, 1, 1, 'link', 'Alt', 'a', '2026-11-20T08:00:00.000Z');
    `)
    migrateDb(db, MIGRATIONS)
    expect(sqlite.prepare('SELECT version_at FROM knowledge_entries WHERE id = 1').get()).toEqual({ version_at: '2026-11-20T08:00:00.000Z' })
    // The starters (with their version date) go in at the next start.
    seedDefaults(db)
    expect(count(sqlite, 'knowledge_entries')).toBeGreaterThan(1)
    expect(sqlite.prepare(`SELECT count(*) AS n FROM knowledge_entries WHERE version_at = ''`).get()).toEqual({ n: 0 })
    // Run again it changes nothing.
    migrateDb(db, MIGRATIONS)
    expect(sqlite.prepare('PRAGMA table_info(knowledge_entries)').all().filter(column => (column as { name: string }).name === 'version_at')).toHaveLength(1)
  })

  it('0109 adds the address book with the example categories for every facility and the future school of a child', () => {
    const { db, sqlite } = databaseAt('0108')
    sqlite.exec(`
      INSERT INTO facilities (id, name) VALUES (2, 'Krippe');
      INSERT INTO children (id, facility_id, last_name, first_name, birth_date, created_at) VALUES (1, 2, 'Muster', 'Kind', '2021-03-15', 'x');
    `)
    const before = sqlite.prepare('SELECT * FROM children').all() as Record<string, unknown>[]
    migrateDb(db, MIGRATIONS)

    expect(sqlite.prepare('SELECT facility_id, name FROM contact_categories ORDER BY facility_id, sort_order, id').all()
      .map(row => Object.values(row as Record<string, unknown>)))
      .toEqual([1, 2].flatMap(facility => DEFAULT_CONTACT_CATEGORIES.map(name => [facility, name])))
    expect(count(sqlite, 'contacts')).toBe(0)
    // The children keep everything and have no future school.
    expect(sqlite.prepare('SELECT * FROM children').all()).toEqual(before.map(row => ({ ...row, future_school_contact_id: null })))
    // Names unique per facility regardless of (ASCII) case.
    expect(() => sqlite.exec(`INSERT INTO contact_categories (facility_id, name) VALUES (1, 'JUGENDAMT')`)).toThrow(/UNIQUE/)
    sqlite.exec(`
      INSERT INTO contacts (id, facility_id, category_id, organisation, updated_at) VALUES
        (1, 2, (SELECT id FROM contact_categories WHERE facility_id = 2 AND name = 'Schulen'), 'Grundschule', 'x');
      INSERT INTO contacts (id, facility_id, category_name, organisation, visible_to_staff, updated_at) VALUES (2, NULL, 'Schulen', 'Waldschule', 1, 'x');
      UPDATE children SET future_school_contact_id = 1;
    `)
    expect(sqlite.prepare('SELECT person, email, website, note, visible_to_staff, sort_order, updated_by FROM contacts WHERE id = 1').get())
      .toEqual({ person: '', email: '', website: '', note: '', visible_to_staff: 0, sort_order: 0, updated_by: null })
    const fks = (table: string) => sqlite.prepare(`PRAGMA foreign_key_list(${table})`).all()
      .map(fk => { const { table: to, from, on_delete } = fk as Record<string, string>; return { to, from, on_delete } })
    expect(fks('contact_categories')).toEqual([{ to: 'facilities', from: 'facility_id', on_delete: 'CASCADE' }])
    expect(fks('contacts')).toEqual(expect.arrayContaining([
      { to: 'facilities', from: 'facility_id', on_delete: 'CASCADE' },
      { to: 'contact_categories', from: 'category_id', on_delete: 'NO ACTION' },
      { to: 'users', from: 'updated_by', on_delete: 'SET NULL' },
    ]))
    expect(fks('children')).toContainEqual({ to: 'contacts', from: 'future_school_contact_id', on_delete: 'SET NULL' })
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    // A deleted contact leaves the child without a future school.
    sqlite.exec('DELETE FROM contacts WHERE id = 1')
    expect(sqlite.prepare('SELECT future_school_contact_id AS school FROM children').get()).toEqual({ school: null })
    // Categories and contacts go with their facility; those for all facilities stay.
    sqlite.exec(`
      INSERT INTO contacts (id, facility_id, category_id, organisation, updated_at) VALUES
        (3, 2, (SELECT id FROM contact_categories WHERE facility_id = 2 AND name = 'Jugendamt'), 'Jugendamt', 'x');
      DELETE FROM children; DELETE FROM facilities WHERE id = 2;
    `)
    expect(sqlite.prepare('SELECT DISTINCT facility_id FROM contact_categories').all()).toEqual([{ facility_id: 1 }])
    expect(sqlite.prepare('SELECT id FROM contacts').all()).toEqual([{ id: 2 }])
  })

  // What 0111 writes, frozen here (the defaults for new facilities in shared/domain/childConsents.ts may change later):
  // [builtin key, area, short, text] in their order, and the eight sheets with their columns (consents by key).
  const MIGRATED_QUESTIONS = [
    ['artworkDisplay', 'Datenschutz', 'Bastelarbeiten', 'Bastel- und Malarbeiten aufhängen'],
    ['photosDisplay', 'Datenschutz', 'Fotos aufhängen', 'Einzel- und Gruppenfotos aufhängen'],
    ['photosForeignPortfolios', 'Datenschutz', 'Fremde Portfolios', 'Fotoerlaubnis für fremde Portfolios'],
    ['photosInternalEvents', 'Datenschutz', 'Fotos Feste', 'Fotos hausinterner Feste'],
    ['photosNamesBirthdaysDisplay', 'Datenschutz', 'Fotos, Namen, Geb.', 'Fotos, Namen und Geburtsdaten aufhängen'],
    ['groupWorkWithNames', 'Datenschutz', 'Gruppenarbeiten', 'Gruppenarbeiten mit Namen ausstellen'],
    ['whatsappContact', 'Messenger (WhatsApp, Signal)', 'Kontakt WhatsApp', 'Kontaktaufnahme über WhatsApp'],
    ['whatsappPhotos', 'Messenger (WhatsApp, Signal)', 'Fotos WhatsApp', 'Fotos über WhatsApp versenden'],
    ['signalPhotos', 'Messenger (WhatsApp, Signal)', 'Fotos Signal', 'Fotos über Signal versenden'],
    ['whatsappParentGroup', 'Messenger (WhatsApp, Signal)', 'Elterngruppe', 'WhatsApp-Elterngruppe'],
    ['mayTakeTemperature', 'Gesundheit', 'Fieber', 'Fieber messen'],
    ['mayApplySunscreen', 'Gesundheit', 'Sonnenschutz', 'Sonnenschutz auftragen'],
    ['mayApplyPlaster', 'Gesundheit', 'Pflaster', 'Pflaster kleben'],
    ['insectRepellent', 'Gesundheit', 'Insektenschutz', 'Darf mit Insektenschutz eingesprüht werden'],
  ] as const
  const c = (builtinKey: string) => ({ type: 'consent', builtinKey })
  const f = (key: string) => ({ type: 'field', key })
  const MIGRATED_SHEETS = [
    { name: 'Datenschutz', columns: ['artworkDisplay', 'photosDisplay', 'photosForeignPortfolios', 'photosInternalEvents', 'photosNamesBirthdaysDisplay', 'groupWorkWithNames'].map(c) },
    { name: 'Messenger', columns: ['whatsappContact', 'whatsappPhotos', 'signalPhotos', 'whatsappParentGroup'].map(c) },
    {
      name: 'Gesundheit',
      columns: [f('measlesProof'), f('infectionBriefingDate'), f('allergies'), ...['mayTakeTemperature', 'mayApplySunscreen', 'mayApplyPlaster', 'insectRepellent'].map(c)],
    },
    { name: 'Abholberechtigte', columns: [f('pickUp')] },
    { name: 'Sorgeberechtigte', columns: [f('guardians'), f('contactBan')] },
    { name: 'Anruf-Reihenfolge', columns: [f('emergency')] },
    { name: 'Telefonnummern', columns: [f('address'), f('phones')] },
    { name: 'Elterngespräche', columns: [f('lastMeeting'), f('nextMeeting'), f('allMeetings'), f('meetingCount')] },
  ]

  it('0111 makes the fixed consents questions of every facility, copies every answer and adds the eight tabs', () => {
    const { db, sqlite } = databaseAt('0110')
    insertOverviewSample(sqlite)
    const before = sqlite.prepare('SELECT * FROM children ORDER BY id').all() as Record<string, unknown>[]
    // Only through 0111, so a later migration of these tables does not change the result.
    migrateThrough(db, '0111')

    // Every facility (also the one without children) has the 14 questions in the order and with the texts of before.
    const questions = sqlite.prepare('SELECT * FROM child_consent_questions ORDER BY facility_id, sort_order').all() as Record<string, unknown>[]
    expect(questions.map(({ facility_id, builtin_key, area, short, text, sort_order, hidden }) => ({ facility_id, builtin_key, area, short, text, sort_order, hidden })))
      .toEqual([1, 2, 3].flatMap(facility => MIGRATED_QUESTIONS.map(([key, area, short, text], index) => ({
        facility_id: facility, builtin_key: key, area, short, text, sort_order: index, hidden: 0,
      }))))
    const questionOf = (facility: unknown, key: string) =>
      questions.find(question => question.facility_id === facility && question.builtin_key === key)!.id

    // Each yes and no became an answer to the question of the child's own facility; an open one none.
    const expected: { child_id: unknown; question_id: unknown; value: unknown }[] = []
    for (const child of before) {
      for (const [key, column] of Object.entries(CONSENT_COLUMN_OF)) {
        if (child[column] !== null) expected.push({ child_id: child.id, question_id: questionOf(child.facility_id, key), value: child[column] })
      }
    }
    const answers = sqlite.prepare('SELECT child_id, question_id, value FROM child_consent_answers').all()
    const order = (rows: unknown[]) => [...rows as { child_id: number; question_id: number }[]]
      .sort((a, b) => a.child_id - b.child_id || a.question_id - b.question_id)
    expect(order(answers)).toEqual(order(expected))
    expect(expected.filter(answer => answer.value === 1).length).toBeGreaterThan(10)
    expect(expected.filter(answer => answer.value === 0).length).toBeGreaterThan(10)
    // The archived child's yes and the planned child's no moved as well (the record keeps them).
    expect(answers).toContainEqual({ child_id: 15, question_id: questionOf(1, 'artworkDisplay'), value: 1 })
    expect(answers).toContainEqual({ child_id: 16, question_id: questionOf(1, 'artworkDisplay'), value: 0 })
    // The old columns stay as they were (a rollback to the previous version still finds them).
    expect(sqlite.prepare('SELECT * FROM children ORDER BY id').all()).toEqual(before)

    // Eight tabs per facility, with the columns of the former fixed sheets (questions of the own facility).
    const sheets = sqlite.prepare('SELECT * FROM child_overview_sheets ORDER BY facility_id, sort_order').all() as Record<string, unknown>[]
    expect(sheets.map(sheet => ({
      facility: sheet.facility_id, name: sheet.name, sortOrder: sheet.sort_order,
      columns: (JSON.parse(sheet.columns as string) as Record<string, unknown>[]).map(column => column.type === 'field'
        ? column
        : { type: 'consent', builtinKey: questions.find(question => question.id === column.questionId && question.facility_id === sheet.facility_id)?.builtin_key }),
    }))).toEqual([1, 2, 3].flatMap(facility => MIGRATED_SHEETS.map((sheet, index) => ({
      facility, name: sheet.name, sortOrder: index, columns: sheet.columns,
    }))))

    const fks = (table: string) => sqlite.prepare(`PRAGMA foreign_key_list(${table})`).all()
      .map(fk => { const { table: to, from, on_delete } = fk as Record<string, string>; return { to, from, on_delete } })
    expect(fks('child_consent_questions')).toEqual([{ to: 'facilities', from: 'facility_id', on_delete: 'CASCADE' }])
    expect(fks('child_consent_answers')).toEqual(expect.arrayContaining([
      { to: 'children', from: 'child_id', on_delete: 'CASCADE' },
      { to: 'child_consent_questions', from: 'question_id', on_delete: 'CASCADE' },
    ]))
    expect(fks('child_overview_sheets')).toEqual([{ to: 'facilities', from: 'facility_id', on_delete: 'CASCADE' }])
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    // One answer per child and question; a builtin key once per facility.
    expect(() => sqlite.exec(`INSERT INTO child_consent_answers (child_id, question_id, value) VALUES (11, ${questionOf(1, 'artworkDisplay')}, 1)`))
      .toThrow(/UNIQUE|PRIMARY KEY/)
    expect(() => sqlite.exec(`INSERT INTO child_consent_questions (facility_id, text, short, area, builtin_key) VALUES (1, 'x', 'x', 'x', 'signalPhotos')`))
      .toThrow(/UNIQUE/)
    // The answers go with their child and with their question; questions and tabs with their facility.
    const ofChild11 = count(sqlite, 'child_consent_answers') - expected.filter(answer => answer.child_id !== 11).length
    expect(ofChild11).toBeGreaterThan(0)
    sqlite.exec('DELETE FROM child_contacts WHERE child_id = 11; DELETE FROM child_parent_meetings WHERE child_id = 11; DELETE FROM children WHERE id = 11')
    expect(count(sqlite, 'child_consent_answers')).toBe(expected.length - ofChild11)
    sqlite.exec(`DELETE FROM child_consent_questions WHERE id = ${questionOf(2, 'whatsappContact')}`)
    expect(sqlite.prepare(`SELECT count(*) AS n FROM child_consent_answers WHERE question_id = ${questionOf(2, 'whatsappContact')}`).get()).toEqual({ n: 0 })
    sqlite.exec('DELETE FROM facilities WHERE id = 3')
    expect(sqlite.prepare('SELECT DISTINCT facility_id FROM child_consent_questions ORDER BY facility_id').all()).toEqual([{ facility_id: 1 }, { facility_id: 2 }])
    expect(sqlite.prepare('SELECT DISTINCT facility_id FROM child_overview_sheets ORDER BY facility_id').all()).toEqual([{ facility_id: 1 }, { facility_id: 2 }])
  })

  it('0111 gives a new database the default questions and tabs, without answers', () => {
    const { db, sqlite } = createDb(':memory:')
    migrateDb(db, MIGRATIONS)
    expect(sqlite.prepare('SELECT facility_id, builtin_key FROM child_consent_questions ORDER BY sort_order').all())
      .toEqual(MIGRATED_QUESTIONS.map(([key]) => ({ facility_id: 1, builtin_key: key })))
    expect(sqlite.prepare('SELECT name FROM child_overview_sheets ORDER BY sort_order').all().map(row => (row as { name: string }).name))
      .toEqual(MIGRATED_SHEETS.map(sheet => sheet.name))
    expect(count(sqlite, 'child_consent_answers')).toBe(0)
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
