import { eq } from 'drizzle-orm'
import { can } from '../../shared/domain/permissions'
import { isManager } from '../../shared/domain/roles'
import { nowInBerlin } from '../../shared/domain/timeRecords'
import type { ChildCountsDto, ChildCountsLineDto, CountsOnlyStateDto, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, users } from '../db/schema'
import type { ChildViewer } from '../lib/childViewer'
import { ServiceError } from '../lib/errors'
import { getAttendanceDay } from './childAttendance'
import { listGroups } from './groups'

/**
 * „Nur Kinderzahlen (keine Namen, keine Akten)“ (shared/domain/countsOnly.ts): the setting on the employee (with or without
 * an own account) and the names-free numbers of the day the person sees at the tablet instead of the child records.
 */

type Access = 'edit' | 'read' | 'hidden'

/**
 * Who sets it, as who sets the person's child rights („Kinder: eintragen und Akten ändern“, rights.ts loadTarget): the
 * Träger (rights.manage) for anyone of any facility; the Leitung (role admin; the routes ask for users.manage) for the
 * people of its facility without an account or with a Mitarbeiter account – a Gruppenleitung's she sees, the Träger sets
 * it ('read'); an employee of another facility is 404 employee_not_found for her. Not offered ('hidden') for a person
 * with a Leitung or Träger account (their child rights are never cut this way) and for anyone else with „Zugänge
 * verwalten“ (they set no child rights).
 */
function accessTo(db: Db, actor: SessionUser, employeeId: number): { access: Access; countsOnly: boolean } {
  const employee = db.select({ facilityId: employees.facilityId, countsOnly: employees.countsOnly })
    .from(employees).where(eq(employees.id, employeeId)).get()
  if (!employee) throw new ServiceError(404, 'employee_not_found')
  const provider = can(actor.permissions, 'rights.manage')
  if (!provider && actor.role === 'admin' && employee.facilityId !== actor.facilityId) {
    throw new ServiceError(404, 'employee_not_found')
  }
  const account = db.select({ role: users.role }).from(users).where(eq(users.employeeId, employeeId)).get()
  const result = (access: Access) => ({ access, countsOnly: employee.countsOnly })
  if (account && (isManager(account.role) || account.role === 'terminal')) return result('hidden')
  if (provider) return result('edit')
  if (actor.role !== 'admin') return result('hidden')
  return result(account?.role === 'group_lead' ? 'read' : 'edit')
}

function stateOf({ access, countsOnly }: { access: Access; countsOnly: boolean }): CountsOnlyStateDto {
  if (access === 'hidden') return { countsOnly: false, offered: false, editable: false }
  return { countsOnly, offered: true, editable: access === 'edit' }
}

/** GET /api/employees/[id]/counts-only: the setting as the tab „Zugang“ shows it (see accessTo). */
export function getCountsOnly(db: Db, actor: SessionUser, employeeId: number): CountsOnlyStateDto {
  return stateOf(accessTo(db, actor, employeeId))
}

/**
 * PUT /api/employees/[id]/counts-only: switches „Nur Kinderzahlen“ on or off (see accessTo; 403 counts_only_manager for
 * a person with a Leitung or Träger account, 403 forbidden for whoever may not set it). It takes effect with the next
 * request: the own account's rights and the tablet's unlock are read afresh every time.
 */
export function setCountsOnly(db: Db, actor: SessionUser, employeeId: number, countsOnly: boolean): CountsOnlyStateDto {
  const { access } = accessTo(db, actor, employeeId)
  if (access !== 'edit') {
    const account = db.select({ role: users.role }).from(users).where(eq(users.employeeId, employeeId)).get()
    throw new ServiceError(403, account && isManager(account.role) ? 'counts_only_manager' : 'forbidden')
  }
  db.update(employees).set({ countsOnly }).where(eq(employees.id, employeeId)).run()
  return getCountsOnly(db, actor, employeeId)
}

/**
 * The viewer for the day list behind the numbers: every child of the facility, no rights at all. Only the numbers leave
 * this file; names, ids and the rest of the list stay here.
 */
function countingViewer(facilityId: number): ChildViewer {
  return {
    id: null, employeeId: null, name: '', role: 'observer', permissions: new Set(), facilityId, visibility: null, onTablet: true,
    groups: null,
  }
}

/**
 * „Kinder heute“ (GET /api/terminal/children/counts): today's numbers of the facility, taken from the attendance list
 * itself (getAttendanceDay), so they are always the numbers of its summary line – da, noch nicht da, abwesend,
 * abgeholt, and the children counted for each meal of the day (spec Essen: at its time or by its tick). Per group as
 * well when the facility has more than one group (the groups of today's children, without group last). No names, no ids.
 */
export function childCountsToday(db: Db, facilityId: number, now: Date = new Date()): ChildCountsDto {
  const date = nowInBerlin(now).date
  const day = getAttendanceDay(db, countingViewer(facilityId), date, now)
  const line = (rows: typeof day.children): ChildCountsLineDto => ({
    present: rows.filter(row => row.status === 'present').length,
    notYet: rows.filter(row => row.status === 'not_yet').length,
    absent: rows.filter(row => !['present', 'gone', 'not_yet'].includes(row.status)).length,
    gone: rows.filter(row => row.status === 'gone').length,
    meals: day.meals.map(meal => rows.filter(row => row.meals[meal.mealId]?.counted).length),
  })
  const perGroup = listGroups(db, facilityId).length > 1
  return {
    date,
    isCareDay: day.isCareDay,
    meals: day.meals.map(meal => ({ name: meal.name, time: meal.time })),
    total: line(day.children),
    groups: perGroup
      ? day.groups.map(group => ({ name: group.id === null ? null : group.name, ...line(day.children.filter(row => row.groupId === group.id)) }))
      : [],
  }
}
