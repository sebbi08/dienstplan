import { and, asc, count, eq, inArray } from 'drizzle-orm'
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
}

export function listUsers(db: Db): UserDto[] {
  return db.select({ user: users, employeeName: employees.name })
    .from(users)
    .leftJoin(employees, eq(users.employeeId, employees.id))
    .orderBy(asc(users.username))
    .all()
    .map(({ user, employeeName }) => ({
      id: user.id, username: user.username, role: user.role, employeeId: user.employeeId,
      employeeName: employeeName ?? null, active: user.active,
      mustChangePassword: user.mustChangePassword, lockedUntil: user.lockedUntil,
    }))
}

function findUser(db: Db, id: number): UserDto {
  const user = listUsers(db).find(candidate => candidate.id === id)
  if (!user) throw new ServiceError(404, 'user_not_found')
  return user
}

function assertEmployeeLink(db: Db, role: Role, employeeId: number | null, userId: number | null): void {
  if (role === 'terminal' && employeeId !== null) throw new ServiceError(400, 'terminal_no_employee')
  if (role === 'observer' && employeeId === null) throw new ServiceError(400, 'employee_required')
  if (employeeId === null) return
  if (!db.select().from(employees).where(eq(employees.id, employeeId)).get()) {
    throw new ServiceError(400, 'employee_not_found')
  }
  const linked = db.select().from(users).where(eq(users.employeeId, employeeId)).get()
  if (linked && linked.id !== userId) throw new ServiceError(409, 'employee_taken')
}

function activeCount(db: Db, roles: Role[]): number {
  return db.select({ value: count() }).from(users)
    .where(and(inArray(users.role, roles), eq(users.active, true))).get()!.value
}

/** Only a Träger may create, change, appoint or reset Träger accounts. */
function assertMayManage(actor: SessionUser, ...roles: Role[]): void {
  if (actor.role !== 'provider' && roles.includes('provider')) throw new ServiceError(403, 'provider_only')
}

export function createUser(db: Db, actor: SessionUser, input: UserInput): UserDto {
  assertMayManage(actor, input.role)
  const username = normalizeUsername(input.username)
  if (!username) throw new ServiceError(400, 'username_required')
  if (db.select().from(users).where(eq(users.username, username)).get()) {
    throw new ServiceError(409, 'username_taken')
  }
  assertPasswordStrength(input.password)
  assertEmployeeLink(db, input.role, input.employeeId, null)
  const row = db.insert(users).values({
    username, passwordHash: hashPassword(input.password), role: input.role,
    employeeId: input.employeeId, mustChangePassword: input.role !== 'terminal',
  }).returning().get()
  return findUser(db, row.id)
}

export function updateUser(db: Db, actor: SessionUser, id: number, update: UserUpdate): UserDto {
  const user = findUser(db, id)
  assertMayManage(actor, user.role, update.role)
  assertEmployeeLink(db, update.role, update.employeeId, id)
  const loses = (roles: Role[]) => roles.includes(user.role) && user.active && (!roles.includes(update.role) || !update.active)
  if (loses(['provider']) && activeCount(db, ['provider']) <= 1) throw new ServiceError(409, 'last_provider')
  if (loses([...MANAGER_ROLES]) && activeCount(db, [...MANAGER_ROLES]) <= 1) throw new ServiceError(409, 'last_admin')
  db.update(users)
    .set({
      role: update.role, employeeId: update.employeeId, active: update.active,
      // The tablet cannot reach the password page, so a terminal must never be forced to change it.
      ...(update.role === 'terminal' ? { mustChangePassword: false } : {}),
    })
    .where(eq(users.id, id)).run()
  return findUser(db, id)
}

export function resetPassword(db: Db, actor: SessionUser, id: number, password: string): void {
  const user = findUser(db, id)
  assertMayManage(actor, user.role)
  assertPasswordStrength(password)
  db.update(users).set({
    passwordHash: hashPassword(password), mustChangePassword: user.role !== 'terminal', failedLogins: 0, lockedUntil: null,
  }).where(eq(users.id, id)).run()
}
