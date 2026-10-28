import { and, eq } from 'drizzle-orm'
import { createDb, migrateDb, type Db } from '../../server/db/client'
import {
  absenceCodes, childGroupChanges, children, documentTypes, employeeHours, employees, helpOuts, requirementTypes, shiftTemplates, users,
} from '../../server/db/schema'
import { seedDefaults } from '../../server/db/seed'
import type { ChildActor } from '../../server/lib/childViewer'
import { ServiceError } from '../../server/lib/errors'
import { hashPassword } from '../../server/lib/password'
import { toSessionUser } from '../../server/services/auth'
import { createFacility } from '../../server/services/facilities'
import { createGroup } from '../../server/services/groups'
import { saveBundleOverride } from '../../server/services/permissions'
import type { PermissionKey } from '../../shared/domain/permissions'
import type { Role, SessionUser } from '../../shared/types/api'
import { flaggedPermissions } from './rights'

export const TEST_PASSWORD = 'secret-password'

export function createTestDb(): Db {
  const { db } = createDb(':memory:')
  migrateDb(db, 'server/db/migrations')
  seedDefaults(db)
  return db
}

/** A further facility (with copies of facility 1's shift templates and coverage rules); returns its id. */
export function addFacility(db: Db, name: string): number {
  return createFacility(db, name).id
}

export function addEmployee(
  db: Db, name: string,
  options: {
    weeklyHours?: number; validFrom?: string; leftOn?: string | null; facilityId?: number; groupId?: number | null
  } = {},
): number {
  const sortOrder = db.select().from(employees).all().length + 1
  const employee = db.insert(employees)
    .values({
      name, shortName: name.slice(0, 2), sortOrder, leftOn: options.leftOn ?? null, facilityId: options.facilityId ?? 1,
      groupId: options.groupId ?? null,
    })
    .returning().get()
  db.insert(employeeHours).values({
    employeeId: employee.id,
    weeklyMinutes: Math.round((options.weeklyHours ?? 39) * 60),
    validFrom: options.validFrom ?? '2026-01-01',
  }).run()
  return employee.id
}

/**
 * Leitung, tablet and Träger accounts work in facility 1 unless facilityId says otherwise; a Mitarbeiter account
 * follows its employee. Returns the session user as the server builds it.
 */
export function addUser(
  db: Db, username: string, role: Role, employeeId: number | null = null, facilityId?: number,
): SessionUser {
  const stored = facilityId ?? (role === 'observer' ? null : 1)
  const row = db.insert(users)
    .values({ username, passwordHash: hashPassword(TEST_PASSWORD), role, employeeId, facilityId: stored })
    .returning().get()
  return toSessionUser(db, row)
}

/**
 * The Mitarbeiter account maintains child records: the exception „eintragen und Akten ändern“ (own group), which
 * replaced the flag „darf Kinderakten pflegen“ (the old column is no longer read).
 */
export function allowChildEditing(db: Db, userId: number): void {
  saveBundleOverride(db, userId, 'childrenEdit', 'grant', 'group')
}

/** The account plans and decides leave (the exception „planen und genehmigen“), as a chosen planner did before. */
export function allowLeavePlanning(db: Db, userId: number): void {
  saveBundleOverride(db, userId, 'leavePlan', 'grant')
}

/**
 * Makes the session user a leave planner (`allowLeavePlanning`) and refreshes its permissions in place, as its next
 * request would load them; returns it.
 */
export function makePlanner(db: Db, user: SessionUser): SessionUser {
  allowLeavePlanning(db, user.id)
  return refreshPermissions(db, user)
}

/** The session user with its permissions as its next request would load them (changed in place). */
export function refreshPermissions(db: Db, user: SessionUser): SessionUser {
  const row = db.select().from(users).where(eq(users.id, user.id)).get()!
  return Object.assign(user, { permissions: toSessionUser(db, row).permissions })
}

/** The permissions of an account of the role with the child flag as given (no leave planner, no contract switch). */
export function permissionsOf(role: Role, canEditChildren = false): ReadonlySet<PermissionKey> {
  return flaggedPermissions(role, { canEditChildren })
}

/**
 * The account as the child guards see it at the office (no visibility switches, not on the tablet, every group), named
 * by its username, with the permissions of its role, plus „eintragen und Akten ändern“ when the test passes
 * `canEditChildren: true`. The user's own fields stay, so the same object still serves the services that take a session
 * user.
 */
export function asChildViewer(user: SessionUser & { canEditChildren?: boolean }, facilityId = 1): ChildActor {
  const { canEditChildren, ...account } = user
  return {
    ...account, name: user.username, permissions: permissionsOf(user.role, canEditChildren ?? false),
    facilityId: user.facilityId ?? facilityId, visibility: null, onTablet: false, groups: null,
  }
}

/** A group of the facility, created through the service; returns its id. */
export function addGroup(db: Db, facilityId: number, name: string): number {
  return createGroup(db, facilityId, name).id
}

/** A child of the facility (not yet left unless leftOn is given) with the start entry of its group history; returns its id. */
export function addChild(
  db: Db, facilityId: number,
  overrides: Partial<{
    lastName: string; firstName: string; birthDate: string; entryDate: string | null; plannedEntryDate: string | null
    leftOn: string | null; groupId: number | null; careTypeId: number | null; allergies: string
    keyEducatorId: number | null; schoolDistrict: string; schoolStartDate: string | null
    admissionStatus: 'waitlist' | 'contract'; waitlistedOn: string | null
  }> = {},
): number {
  const createdAt = '2026-01-01T00:00:00.000Z'
  const id = db.insert(children).values({
    facilityId,
    lastName: 'Muster',
    firstName: 'Kind',
    birthDate: '2022-03-15',
    entryDate: '2025-09-01',
    createdAt,
    ...overrides,
  }).returning({ id: children.id }).get().id
  db.insert(childGroupChanges)
    .values({ childId: id, groupId: overrides.groupId ?? null, fromDate: null, appliedAt: createdAt, createdAt }).run()
  return id
}

/** The id of the facility's document type with this name. */
export function documentTypeId(db: Db, facilityId: number, name: string): number {
  return db.select({ id: documentTypes.id }).from(documentTypes)
    .where(and(eq(documentTypes.facilityId, facilityId), eq(documentTypes.name, name))).get()!.id
}

/** Makes the employee a helper in facilityId's plan for the month (no checks); returns the help-out id. */
export function addHelpOut(db: Db, employeeId: number, facilityId: number, year: number, month: number): number {
  return db.insert(helpOuts).values({ employeeId, facilityId, year, month }).returning({ id: helpOuts.id }).get().id
}

export function templateId(db: Db, shortLabel: string, facilityId = 1): number {
  return db.select().from(shiftTemplates)
    .where(and(eq(shiftTemplates.shortLabel, shortLabel), eq(shiftTemplates.facilityId, facilityId))).get()!.id
}

/** The facility's built-in kind of mandatory appointment with this key ('company_doctor', 'first_aid', 'criminal_record', 'measles'). */
export function requirementTypeId(db: Db, key: string, facilityId = 1): number {
  return db.select().from(requirementTypes)
    .where(and(eq(requirementTypes.builtinKey, key), eq(requirementTypes.facilityId, facilityId))).get()!.id
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
