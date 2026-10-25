import { and, asc, eq, isNotNull } from 'drizzle-orm'
import { childStatus } from '../../shared/domain/children'
import { todayIso } from '../../shared/domain/dates'
import { pinLockState } from '../../shared/domain/pin'
import { isManager } from '../../shared/domain/roles'
import {
  isSetupItemKey, SETUP_PROVIDER_ONLY_KEYS, setupChecklist, type SetupChecklist, type SetupFacts, type SetupItemKey,
} from '../../shared/domain/setupChecklist'
import type { SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { children, employees, facilities, groups, setupHidden, users } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { loadHoursContext } from './openingHours'
import { staffingRulesFor } from './staffing'

/** Only the Leitung and the Träger see „Was noch fehlt“ (the routes check it as well). */
function assertManager(user: SessionUser): void {
  if (!isManager(user.role)) throw new ServiceError(403, 'forbidden')
}

/** What the checklist needs to know about the facility today. */
export function loadSetupFacts(db: Db, facilityId: number, now: Date = new Date()): SetupFacts {
  const today = todayIso(now)
  const facility = db.select().from(facilities).where(eq(facilities.id, facilityId)).get()
  if (!facility) throw new ServiceError(404, 'facility_not_found')
  const terminal = db.select({ id: users.id }).from(users)
    .where(and(eq(users.role, 'terminal'), eq(users.facilityId, facilityId), eq(users.active, true))).get()
  const linked = new Set(db.select({ employeeId: users.employeeId }).from(users)
    .where(and(isNotNull(users.employeeId), eq(users.active, true))).all().map(row => row.employeeId))
  const staff = db.select().from(employees).where(eq(employees.facilityId, facilityId))
    .orderBy(asc(employees.sortOrder), asc(employees.id)).all()
    .filter(employee => employee.leftOn === null || employee.leftOn >= today)
  const kids = db.select({
    id: children.id, firstName: children.firstName, lastName: children.lastName, careTypeId: children.careTypeId,
    admissionStatus: children.admissionStatus, entryDate: children.entryDate, leftOn: children.leftOn,
  }).from(children).where(eq(children.facilityId, facilityId)).orderBy(asc(children.lastName), asc(children.firstName)).all()
    // Only children with a contract today (entered, not left): the ones the children list shows.
    .filter(child => childStatus(child, today) === 'active')
  return {
    openingHoursEntered: loadHoursContext(db, facilityId).facility !== null,
    hasTerminalAccount: terminal !== undefined,
    capacitySet: facility.capacity !== null,
    usesGroupTypes: (staffingRulesFor(db, facilityId, today).rules.groupTypes ?? []).length > 0,
    timeTrackingOn: facility.timeTrackingFrom !== null,
    groups: db.select().from(groups).where(eq(groups.facilityId, facilityId)).orderBy(asc(groups.sortOrder), asc(groups.id)).all()
      .map(group => ({ id: group.id, name: group.name, groupType: group.groupType, documentationOn: group.docMode !== 'off' })),
    employees: staff.map(employee => ({
      id: employee.id,
      name: employee.name,
      hasPin: employee.pinHash !== null,
      pinLocked: pinLockState(employee, now).pinLockedPermanently,
      hasQualification: employee.qualification !== null,
      hasBirthday: employee.birthday !== null,
      hasAccount: linked.has(employee.id),
    })),
    children: kids.map(child => ({ id: child.id, name: `${child.firstName} ${child.lastName}`, hasCareType: child.careTypeId !== null })),
  }
}

function hiddenKeys(db: Db, facilityId: number): string[] {
  return db.select({ key: setupHidden.key }).from(setupHidden).where(eq(setupHidden.facilityId, facilityId)).all().map(row => row.key)
}

/** „Was noch fehlt“ of the facility for this Leitung or Träger (items for the Träger only are left out for a Leitung). */
export function getSetupChecklist(db: Db, user: SessionUser, facilityId: number, now: Date = new Date()): SetupChecklist {
  assertManager(user)
  return setupChecklist(loadSetupFacts(db, facilityId, now), { isProvider: user.role === 'provider' }, hiddenKeys(db, facilityId))
}

/** A known item this viewer sees: a Leitung cannot hide or show the items for the Träger only. */
function assertKey(user: SessionUser, key: unknown): asserts key is SetupItemKey {
  if (!isSetupItemKey(key)) throw new ServiceError(400, 'invalid_setup_item')
  if (SETUP_PROVIDER_ONLY_KEYS.includes(key) && user.role !== 'provider') throw new ServiceError(403, 'forbidden')
}

/** „Brauchen wir nicht“: hides the item for every Leitung and the Träger of the facility (hiding it again changes nothing). */
export function hideSetupItem(db: Db, user: SessionUser, facilityId: number, key: string, now: Date = new Date()): void {
  assertManager(user)
  assertKey(user, key)
  db.insert(setupHidden).values({ facilityId, key, hiddenAt: now.toISOString(), hiddenBy: user.id })
    .onConflictDoNothing({ target: [setupHidden.facilityId, setupHidden.key] }).run()
}

/** „Wieder einblenden“: shows the hidden item again (an item already shown stays as it is). */
export function showSetupItem(db: Db, user: SessionUser, facilityId: number, key: string): void {
  assertManager(user)
  assertKey(user, key)
  db.delete(setupHidden).where(and(eq(setupHidden.facilityId, facilityId), eq(setupHidden.key, key))).run()
}
