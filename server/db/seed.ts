import { count, eq } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { hashPassword, MIN_PASSWORD_LENGTH } from '../lib/password'
import { normalizeUsername } from '../lib/username'
import type { Db } from './client'
import { absenceCodes, coverageRules, shiftTemplates, users } from './schema'

export const DEFAULT_TEMPLATES: (typeof shiftTemplates.$inferInsert)[] = [
  { shortLabel: 'F1', label: 'Frühdienst', start: 420, end: 795, breakStart: null, breakEnd: null, countsAsStaff: true, sortOrder: 1 },
  { shortLabel: 'F2', label: 'Frühdienst 2', start: 450, end: 945, breakStart: 700, breakEnd: 730, countsAsStaff: true, pairsWithPrepTime: true, sortOrder: 2 },
  { shortLabel: 'M', label: 'Mitteldienst', start: 465, end: 960, breakStart: 700, breakEnd: 730, countsAsStaff: true, pairsWithPrepTime: true, sortOrder: 3 },
  { shortLabel: 'S', label: 'Spätdienst', start: 525, end: 1020, breakStart: 730, breakEnd: 760, countsAsStaff: true, pairsWithPrepTime: true, sortOrder: 4 },
  { shortLabel: 'HK', label: 'Haushaltskraft', start: 660, end: 960, breakStart: null, breakEnd: null, countsAsStaff: false, sortOrder: 5 },
]

export const DEFAULT_CODES: (typeof absenceCodes.$inferInsert)[] = [
  { key: 'vacation', label: 'Urlaub', color: 'gray', creditMode: 'daily_target', requiresTimes: false, sortOrder: 1 },
  { key: 'special_leave', label: 'Sonderurlaub', color: 'gray', creditMode: 'daily_target', requiresTimes: false, sortOrder: 2 },
  { key: 'sick', label: 'Krank', color: 'gray', creditMode: 'daily_target', requiresTimes: false, sortOrder: 3 },
  { key: 'office', label: 'Büro', color: 'yellow', creditMode: 'timed', requiresTimes: true, sortOrder: 4 },
  { key: 'prep_time', label: 'VZ', color: 'green', creditMode: 'timed', requiresTimes: true, sortOrder: 5 },
  { key: 'training', label: 'Fortbildung', color: 'gray', creditMode: 'daily_target', requiresTimes: false, sortOrder: 6 },
  { key: 'school', label: 'Schule', color: 'gray', creditMode: 'daily_target', requiresTimes: false, sortOrder: 7 },
  { key: 'other', label: 'sonstiges', color: 'neutral', creditMode: 'none', requiresTimes: false, sortOrder: 8 },
  { key: 'holiday', label: 'Feiertag', color: 'blue', creditMode: 'daily_target', requiresTimes: false, sortOrder: 9 },
  { key: 'closure_day', label: 'Schließtag', color: 'blue', creditMode: 'daily_target', requiresTimes: false, sortOrder: 10 },
]

export const DEFAULT_COVERAGE_RULES: (typeof coverageRules.$inferInsert)[] = [
  { label: 'Spätdienst 8:45–17:00', start: 525, end: 1020, minCount: 2, active: true },
  { label: 'Frühdienst ab 7:00', start: 420, end: null, minCount: 1, active: true },
  { label: 'Frühdienst 2 ab 7:30', start: 450, end: null, minCount: 1, active: true },
]

function isEmpty(db: Db, table: SQLiteTable): boolean {
  return db.select({ value: count() }).from(table).get()!.value === 0
}

/** The facility the existing data moved into (created by the migration 0019_facilities). */
export const FIRST_FACILITY_ID = 1

function facilityHasNone(db: Db, table: typeof shiftTemplates | typeof coverageRules, facilityId: number): boolean {
  return db.select({ value: count() }).from(table).where(eq(table.facilityId, facilityId)).get()!.value === 0
}

/** Absence codes are global; shift templates and coverage rules are seeded for the first facility. */
export function seedDefaults(db: Db): void {
  if (facilityHasNone(db, shiftTemplates, FIRST_FACILITY_ID)) {
    db.insert(shiftTemplates).values(DEFAULT_TEMPLATES.map(template => ({ ...template, facilityId: FIRST_FACILITY_ID }))).run()
  }
  if (isEmpty(db, absenceCodes)) db.insert(absenceCodes).values(DEFAULT_CODES).run()
  if (facilityHasNone(db, coverageRules, FIRST_FACILITY_ID)) {
    db.insert(coverageRules).values(DEFAULT_COVERAGE_RULES.map(rule => ({ ...rule, facilityId: FIRST_FACILITY_ID }))).run()
  }
}

/** Creates the first account (as Träger) from environment variables when no user exists yet. */
export function ensureInitialAdmin(db: Db, username: string | undefined, password: string | undefined): boolean {
  const name = normalizeUsername(username ?? '')
  if (!name || !password || !isEmpty(db, users)) return false
  db.insert(users).values({
    username: name, passwordHash: hashPassword(password), role: 'provider', mustChangePassword: true, facilityId: FIRST_FACILITY_ID,
  }).run()
  return true
}

/**
 * Emergency access: sets a new password for an existing user, makes them an active Träger (provider) and
 * forces a password change at the next login. Returns false when nothing was changed.
 */
export function resetAdminFromEnv(db: Db, username: string | undefined, password: string | undefined): boolean {
  const name = normalizeUsername(username ?? '')
  if (!name || !password || password.length < MIN_PASSWORD_LENGTH) return false
  const user = db.select().from(users).where(eq(users.username, name)).get()
  if (!user) return false
  db.update(users).set({
    passwordHash: hashPassword(password), mustChangePassword: true, failedLogins: 0,
    lockedUntil: null, active: true, role: 'provider',
  }).where(eq(users.id, user.id)).run()
  return true
}
