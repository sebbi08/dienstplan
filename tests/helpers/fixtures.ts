import { eq } from 'drizzle-orm'
import { createDb, migrateDb, type Db } from '../../server/db/client'
import { absenceCodes, employeeHours, employees, shiftTemplates, users } from '../../server/db/schema'
import { seedDefaults } from '../../server/db/seed'
import { ServiceError } from '../../server/lib/errors'
import { hashPassword } from '../../server/lib/password'
import type { Role, SessionUser } from '../../shared/types/api'

export const TEST_PASSWORD = 'secret-password'

export function createTestDb(): Db {
  const { db } = createDb(':memory:')
  migrateDb(db, 'server/db/migrations')
  seedDefaults(db)
  return db
}

export function addEmployee(
  db: Db, name: string,
  options: { weeklyHours?: number; validFrom?: string; leftOn?: string | null } = {},
): number {
  const sortOrder = db.select().from(employees).all().length + 1
  const employee = db.insert(employees)
    .values({ name, shortName: name.slice(0, 2), sortOrder, leftOn: options.leftOn ?? null })
    .returning().get()
  db.insert(employeeHours).values({
    employeeId: employee.id,
    weeklyMinutes: Math.round((options.weeklyHours ?? 39) * 60),
    validFrom: options.validFrom ?? '2026-01-01',
  }).run()
  return employee.id
}

export function addUser(db: Db, username: string, role: Role, employeeId: number | null = null): SessionUser {
  const row = db.insert(users)
    .values({ username, passwordHash: hashPassword(TEST_PASSWORD), role, employeeId })
    .returning().get()
  return { id: row.id, username, role, employeeId, mustChangePassword: false }
}

export function templateId(db: Db, shortLabel: string): number {
  return db.select().from(shiftTemplates).where(eq(shiftTemplates.shortLabel, shortLabel)).get()!.id
}

export function codeId(db: Db, key: string): number {
  return db.select().from(absenceCodes).where(eq(absenceCodes.key, key)).get()!.id
}

/** Runs fn and returns the ServiceError code it throws, or null if it does not throw. */
export function errorCode(fn: () => unknown): string | null {
  try {
    fn()
    return null
  }
  catch (error) {
    if (error instanceof ServiceError) return error.code
    throw error
  }
}
