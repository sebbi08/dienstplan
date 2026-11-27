import { and, asc, eq, isNotNull } from 'drizzle-orm'
import { childStatus } from '../../shared/domain/children'
import { todayIso } from '../../shared/domain/dates'
import { mayManagePins, pinLockState } from '../../shared/domain/pin'
import { can } from '../../shared/domain/permissions'
import {
  isSetupItemKey, SETUP_CHILD_KEYS, SETUP_PROVIDER_ONLY_KEYS, setupChecklist, type SetupChecklist, type SetupFacts,
  type SetupItemKey, type SetupViewer,
} from '../../shared/domain/setupChecklist'
import type { SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { children, employees, facilities, groups, setupHidden, users } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { loadHoursContext } from './openingHours'
import { missingRequiredDocuments } from './requiredDocuments'
import { staffingRulesFor } from './staffing'

/** Whoever runs the facility's settings sees „Was noch fehlt“ (the routes check it as well). */
function assertManager(user: SessionUser): void {
  if (!can(user.permissions, 'settings.facility')) throw new ServiceError(403, 'forbidden')
}

/**
 * What the checklist needs to know about the facility today; with a viewer also the Pflichtdokumente missing or expired
 * (only types in folders the viewer may use).
 */
export function loadSetupFacts(db: Db, facilityId: number, now: Date = new Date(), viewer?: Pick<SessionUser, 'permissions'>): SetupFacts {
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
    requiredDocuments: viewer ? requiredDocumentFacts(db, viewer, facilityId, today, staff) : undefined,
  }
}

/** Per Pflichtdokument the employees (in the list's order) it is missing or expired for; types nobody misses are left out. */
function requiredDocumentFacts(
  db: Db, viewer: Pick<SessionUser, 'permissions'>, facilityId: number, today: string, staff: readonly { id: number; name: string }[],
): NonNullable<SetupFacts['requiredDocuments']> {
  const missing = missingRequiredDocuments(db, viewer, facilityId, today)
  const byType = new Map<number, { typeId: number; name: string; employees: { id: number; name: string }[] }>()
  for (const person of staff) {
    for (const type of missing.get(person.id) ?? []) {
      const entry = byType.get(type.typeId) ?? { typeId: type.typeId, name: type.name, employees: [] }
      entry.employees.push({ id: person.id, name: person.name })
      byType.set(type.typeId, entry)
    }
  }
  return [...byType.values()]
}

function hiddenKeys(db: Db, facilityId: number): string[] {
  return db.select({ key: setupHidden.key }).from(setupHidden).where(eq(setupHidden.facilityId, facilityId)).all().map(row => row.key)
}

/**
 * Whether the account sees children with its own account (children.view and children.ownAccount, as the child routes
 * ask): the checklist names children only then. Without it – „Nur Kinderzahlen“, or a Mitarbeiter given „Einstellungen
 * der Einrichtung“ who sees children only at the tablet – the items naming children are left out.
 */
function seesChildren(user: Pick<SessionUser, 'permissions'>): boolean {
  return can(user.permissions, 'children.view') && can(user.permissions, 'children.ownAccount')
}

/**
 * „Was noch fehlt“ of the facility for this Leitung or Träger (items for the Träger only are left out for a Leitung, the
 * PIN items for an account that sets no PINs, the items naming children for an account that sees no children).
 */
export function getSetupChecklist(db: Db, user: SessionUser, facilityId: number, now: Date = new Date()): SetupChecklist {
  assertManager(user)
  const viewer: SetupViewer = {
    isProvider: can(user.permissions, 'facilities.manage'),
    managesPins: mayManagePins(user.role, key => can(user.permissions, key)),
    seesChildren: seesChildren(user),
  }
  return setupChecklist(loadSetupFacts(db, facilityId, now, user), viewer, hiddenKeys(db, facilityId))
}

/**
 * A known item this viewer sees: a Leitung cannot hide or show the items for the Träger only, an account that sees no
 * children not the items naming children.
 */
function assertKey(user: SessionUser, key: unknown): asserts key is SetupItemKey {
  if (!isSetupItemKey(key)) throw new ServiceError(400, 'invalid_setup_item')
  if (SETUP_PROVIDER_ONLY_KEYS.includes(key) && !can(user.permissions, 'facilities.manage')) throw new ServiceError(403, 'forbidden')
  if (SETUP_CHILD_KEYS.includes(key) && !seesChildren(user)) throw new ServiceError(403, 'forbidden')
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
