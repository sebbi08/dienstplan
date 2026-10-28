import { and, asc, count, eq, inArray, or } from 'drizzle-orm'
import { can } from '../../shared/domain/permissions'
import { MANAGER_ROLES } from '../../shared/domain/roles'
import type { Role, SessionUser, UserDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, users } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { hashPassword } from '../lib/password'
import { normalizeUsername } from '../lib/username'
import { assertPasswordStrength } from './auth'

export interface UserInput {
  username: string
  password: string
  role: Role
  employeeId: number | null
}

export interface UserUpdate {
  role: Role
  employeeId: number | null
  active: boolean
  /** Stored only for a Mitarbeiter; any other role stores false. */
  canEditChildren: boolean
}

/** The users a viewer manages: Leitung and tablet of the viewer's facility, Mitarbeiter of its employees, and all Träger. */
function visibleUsers(db: Db, viewer: SessionUser) {
  const facilityId = viewer.facilityId
  return db.select({ user: users, employeeName: employees.name })
    .from(users)
    .leftJoin(employees, eq(users.employeeId, employees.id))
    .where(or(
      eq(users.role, 'provider'),
      facilityId === null ? undefined : and(inArray(users.role, ['admin', 'terminal']), eq(users.facilityId, facilityId)),
      facilityId === null ? undefined : and(eq(users.role, 'observer'), eq(employees.facilityId, facilityId)),
    ))
    .orderBy(asc(users.username))
    .all()
}

export function listUsers(db: Db, viewer: SessionUser): UserDto[] {
  return visibleUsers(db, viewer).map(({ user, employeeName }) => ({
    id: user.id, username: user.username, role: user.role, employeeId: user.employeeId,
    employeeName: employeeName ?? null, active: user.active,
    mustChangePassword: user.mustChangePassword, canEditChildren: user.canEditChildren, lockedUntil: user.lockedUntil,
  }))
}

function findUser(db: Db, viewer: SessionUser, id: number): { dto: UserDto; facilityId: number | null } {
  const dto = listUsers(db, viewer).find(candidate => candidate.id === id)
  if (!dto) throw new ServiceError(404, 'user_not_found')
  return { dto, facilityId: db.select({ facilityId: users.facilityId }).from(users).where(eq(users.id, id)).get()!.facilityId }
}

/** The facility a new or changed Leitung or tablet account belongs to: the acting user's. */
function actorFacility(actor: SessionUser): number {
  if (actor.facilityId === null) throw new ServiceError(403, 'no_facility')
  return actor.facilityId
}

/** A Mitarbeiter account may only be linked to an employee of the acting user's facility. */
function assertEmployeeLink(db: Db, actor: SessionUser, role: Role, employeeId: number | null, userId: number | null): void {
  if (role === 'terminal' && employeeId !== null) throw new ServiceError(400, 'terminal_no_employee')
  if (role === 'observer' && employeeId === null) throw new ServiceError(400, 'employee_required')
  if (employeeId === null) return
  if (!db.select().from(employees)
    .where(and(eq(employees.id, employeeId), actor.facilityId === null ? undefined : eq(employees.facilityId, actor.facilityId))).get()) {
    throw new ServiceError(400, 'employee_not_found')
  }
  const linked = db.select().from(users).where(eq(users.employeeId, employeeId)).get()
  if (linked && linked.id !== userId) throw new ServiceError(409, 'employee_taken')
}

function activeProviders(db: Db): number {
  return db.select({ value: count() }).from(users)
    .where(and(eq(users.role, 'provider'), eq(users.active, true))).get()!.value
}

/** Active Leitung accounts of the facility plus all active Träger: whoever can still manage it. */
function activeManagers(db: Db, facilityId: number | null): number {
  const leitung = facilityId === null ? 0 : db.select({ value: count() }).from(users)
    .where(and(eq(users.role, 'admin'), eq(users.facilityId, facilityId), eq(users.active, true))).get()!.value
  return leitung + activeProviders(db)
}

/** Only whoever manages Träger accounts (the Träger) may create, change, appoint or reset Träger accounts. */
function assertMayManage(actor: SessionUser, ...roles: Role[]): void {
  if (roles.includes('provider') && !can(actor.permissions, 'users.providerAccounts')) {
    throw new ServiceError(403, 'provider_only')
  }
}

export function createUser(db: Db, actor: SessionUser, input: UserInput): UserDto {
  assertMayManage(actor, input.role)
  const username = normalizeUsername(input.username)
  if (!username) throw new ServiceError(400, 'username_required')
  if (db.select().from(users).where(eq(users.username, username)).get()) {
    throw new ServiceError(409, 'username_taken')
  }
  assertPasswordStrength(input.password)
  assertEmployeeLink(db, actor, input.role, input.employeeId, null)
  // Leitung and tablet belong to the creating user's facility, a Mitarbeiter follows its employee, a new Träger starts in the creator's facility.
  const facilityId = input.role === 'observer' ? null : input.role === 'provider' ? actor.facilityId : actorFacility(actor)
  const row = db.insert(users).values({
    username, passwordHash: hashPassword(input.password), role: input.role,
    employeeId: input.employeeId, facilityId, mustChangePassword: input.role !== 'terminal',
  }).returning().get()
  return findUser(db, actor, row.id).dto
}

export function updateUser(db: Db, actor: SessionUser, id: number, update: UserUpdate): UserDto {
  const { dto: user, facilityId: userFacilityId } = findUser(db, actor, id)
  assertMayManage(actor, user.role, update.role)
  assertEmployeeLink(db, actor, update.role, update.employeeId, id)
  const loses = (roles: Role[]) => roles.includes(user.role) && user.active && (!roles.includes(update.role) || !update.active)
  if (loses(['provider']) && activeProviders(db) <= 1) throw new ServiceError(409, 'last_provider')
  if (loses([...MANAGER_ROLES]) && activeManagers(db, user.role === 'admin' ? userFacilityId : actor.facilityId) <= 1) {
    throw new ServiceError(409, 'last_admin')
  }
  // Leitung and tablet belong to a facility, a Mitarbeiter follows its employee; whoever newly becomes Leitung or tablet joins the acting user's facility.
  const facilityId = update.role === 'observer' ? null
    : update.role === 'provider' ? userFacilityId
      : user.role === update.role ? userFacilityId : actorFacility(actor)
  db.update(users)
    .set({
      role: update.role, employeeId: update.employeeId, active: update.active, facilityId,
      canEditChildren: update.role === 'observer' && update.canEditChildren,
      // The tablet cannot reach the password page, so a terminal must never be forced to change it.
      ...(update.role === 'terminal' ? { mustChangePassword: false } : {}),
    })
    .where(eq(users.id, id)).run()
  return findUser(db, actor, id).dto
}

export function resetPassword(db: Db, actor: SessionUser, id: number, password: string): void {
  const { dto: user } = findUser(db, actor, id)
  assertMayManage(actor, user.role)
  assertPasswordStrength(password)
  db.update(users).set({
    passwordHash: hashPassword(password), mustChangePassword: user.role !== 'terminal', failedLogins: 0, lockedUntil: null,
  }).where(eq(users.id, id)).run()
}
