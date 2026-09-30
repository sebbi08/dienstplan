import { and, asc, count, eq } from 'drizzle-orm'
import type { Role, UserDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, users } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { hashPassword } from '../lib/password'
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
  if (role === 'observer' && employeeId === null) throw new ServiceError(400, 'employee_required')
  if (employeeId === null) return
  if (!db.select().from(employees).where(eq(employees.id, employeeId)).get()) {
    throw new ServiceError(400, 'employee_not_found')
  }
  const linked = db.select().from(users).where(eq(users.employeeId, employeeId)).get()
  if (linked && linked.id !== userId) throw new ServiceError(409, 'employee_taken')
}

function activeAdminCount(db: Db): number {
  return db.select({ value: count() }).from(users)
    .where(and(eq(users.role, 'admin'), eq(users.active, true))).get()!.value
}

export function createUser(db: Db, input: UserInput): UserDto {
  const username = input.username.trim()
  if (!username) throw new ServiceError(400, 'username_required')
  if (db.select().from(users).where(eq(users.username, username)).get()) {
    throw new ServiceError(409, 'username_taken')
  }
  assertPasswordStrength(input.password)
  assertEmployeeLink(db, input.role, input.employeeId, null)
  const row = db.insert(users).values({
    username, passwordHash: hashPassword(input.password), role: input.role,
    employeeId: input.employeeId, mustChangePassword: true,
  }).returning().get()
  return findUser(db, row.id)
}

export function updateUser(db: Db, id: number, update: UserUpdate): UserDto {
  const user = findUser(db, id)
  assertEmployeeLink(db, update.role, update.employeeId, id)
  const losesAdmin = user.role === 'admin' && user.active && (update.role !== 'admin' || !update.active)
  if (losesAdmin && activeAdminCount(db) <= 1) throw new ServiceError(409, 'last_admin')
  db.update(users)
    .set({ role: update.role, employeeId: update.employeeId, active: update.active })
    .where(eq(users.id, id)).run()
  return findUser(db, id)
}

export function resetPassword(db: Db, id: number, password: string): void {
  findUser(db, id)
  assertPasswordStrength(password)
  db.update(users).set({
    passwordHash: hashPassword(password), mustChangePassword: true, failedLogins: 0, lockedUntil: null,
  }).where(eq(users.id, id)).run()
}
