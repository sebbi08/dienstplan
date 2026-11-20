import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm'
import {
  CHILD_SICK_SETTING_KEYS, childSickDefaults, childSickEntitlement, childSickOutdated, childSickSettingsError, type ChildFacts,
  type ChildSickSettings,
} from '../../shared/domain/childSickDays'
import { isValidIsoDate, parseIsoDate } from '../../shared/domain/dates'
import { can, type PermissionKey } from '../../shared/domain/permissions'
import { isEmployedOn, isWorkday } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import type { Warning } from '../../shared/domain/warnings'
import type {
  ChildSickSettingsDto, ChildSickYearDto, EmployeeChildDto, EmployeeChildrenDto, EmployeeChildrenInput,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { absenceCodes, appSettings, employeeChildren, employees, entries } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { loadEmployee, type EmployeeRecord } from './queries'

/**
 * The children of an employee (section „Kinder“ of the personnel file) with „alleinerziehend“: personal data, read with
 * employees.personal (route), changed with employees.edit (route) and employees.personal (checked here, 403 forbidden).
 * They give the Kinderkrankentage (§ 45 SGB V, „Kind krank“) and the parent status of the Pflegeversicherung in „Lohn
 * und Steuer“; they go with the employee („Sofort“, employeeDeletion.ts).
 */

/** At most this many children per employee (400 too_many_children). */
export const MAX_CHILDREN = 20
const FIRST_NAME_MAX = 100

type ChildRow = typeof employeeChildren.$inferSelect

/** The employee must belong to the facility (404 employee_not_found), as employees.ts assertEmployee. */
function assertEmployee(db: Db, facilityId: number, employeeId: number): void {
  const row = db.select({ id: employees.id }).from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.facilityId, facilityId))).get()
  if (!row) throw new ServiceError(404, 'employee_not_found')
}

const toDto = (row: ChildRow): EmployeeChildDto => ({
  id: row.id, firstName: row.firstName, birthDate: row.birthDate, disabledDependent: row.disabledDependent,
})

function childRows(db: Db, employeeId: number): ChildRow[] {
  return db.select().from(employeeChildren).where(eq(employeeChildren.employeeId, employeeId))
    .orderBy(asc(employeeChildren.birthDate), asc(employeeChildren.id)).all()
}

/** „alleinerziehend“ and the children by birth date; the employee must belong to the facility (404 employee_not_found). */
export function getEmployeeChildren(db: Db, facilityId: number, employeeId: number): EmployeeChildrenDto {
  assertEmployee(db, facilityId, employeeId)
  const { singleParent } = db.select({ singleParent: employees.singleParent }).from(employees).where(eq(employees.id, employeeId)).get()!
  return { singleParent, children: childRows(db, employeeId).map(toDto) }
}

/**
 * Saves the section at once: children with an id (of this employee, else 404 employee_child_not_found) are changed,
 * those without one added, the missing ones removed (a „Kind krank“ entry keeps its day, only the link goes). The birth
 * date must be a real day from 1900 on and not after `today` (400 child_birth_date_invalid); the first name is trimmed,
 * empty = none. Needs employees.personal in `permissions` (403 forbidden).
 */
export function setEmployeeChildren(
  db: Db, facilityId: number, employeeId: number, input: EmployeeChildrenInput, permissions: ReadonlySet<PermissionKey>, today: IsoDate,
): EmployeeChildrenDto {
  assertEmployee(db, facilityId, employeeId)
  if (!can(permissions, 'employees.personal')) throw new ServiceError(403, 'forbidden')
  if (input.children.length > MAX_CHILDREN) throw new ServiceError(400, 'too_many_children')
  const checked = input.children.map((child) => {
    if (!isValidIsoDate(child.birthDate) || child.birthDate < '1900-01-01' || child.birthDate > today) {
      throw new ServiceError(400, 'child_birth_date_invalid')
    }
    return {
      id: child.id ?? null, firstName: child.firstName?.trim().slice(0, FIRST_NAME_MAX) || null, birthDate: child.birthDate,
      disabledDependent: child.disabledDependent,
    }
  })
  const existing = new Set(childRows(db, employeeId).map(row => row.id))
  if (checked.some(child => child.id !== null && !existing.has(child.id))) throw new ServiceError(404, 'employee_child_not_found')
  const kept = new Set(checked.map(child => child.id).filter(id => id !== null))
  const removed = [...existing].filter(id => !kept.has(id))
  db.transaction((tx) => {
    tx.update(employees).set({ singleParent: input.singleParent }).where(eq(employees.id, employeeId)).run()
    if (removed.length) {
      // The entries keep „Kind krank“, without the child (the foreign key does the same; explicit for clarity).
      tx.update(entries).set({ employeeChildId: null }).where(inArray(entries.employeeChildId, removed)).run()
      tx.delete(employeeChildren).where(inArray(employeeChildren.id, removed)).run()
    }
    for (const { id, ...values } of checked) {
      if (id === null) tx.insert(employeeChildren).values({ employeeId, ...values }).run()
      else tx.update(employeeChildren).set(values).where(eq(employeeChildren.id, id)).run()
    }
  })
  return getEmployeeChildren(db, facilityId, employeeId)
}

/** The child must belong to the employee, else 400 employee_child_invalid (for the „Kind krank“ entry). */
export function assertChildOf(db: Db, childId: number, employeeIds: readonly number[]): void {
  const row = db.select({ employeeId: employeeChildren.employeeId }).from(employeeChildren).where(eq(employeeChildren.id, childId)).get()
  if (!row || employeeIds.some(employeeId => employeeId !== row.employeeId)) throw new ServiceError(400, 'employee_child_invalid')
}

// --- Kinderkrankentage --------------------------------------------------------------------------------------------

const SETTINGS_KEY = 'child_sick_settings'

/**
 * The Träger's own values (one setting for all facilities, for every year); null while none is stored or a stored one
 * is broken. The setting is only ever written by „Speichern“ in the settings (no migration stored the old defaults),
 * so a stored value is always one the Träger chose.
 */
function storedChildSickSettings(db: Db): ChildSickSettings | null {
  const stored = db.select().from(appSettings).where(eq(appSettings.key, SETTINGS_KEY)).get()?.value
  if (!stored) return null
  try {
    const parsed = JSON.parse(stored) as Partial<ChildSickSettings>
    const settings = Object.fromEntries(CHILD_SICK_SETTING_KEYS.map(key => [key, parsed[key]])) as unknown as ChildSickSettings
    return childSickSettingsError(settings) === null ? settings : null
  }
  catch {
    return null
  }
}

/** The values for a year: the Träger's own, otherwise the legal ones of that year (§ 45 Abs. 2 / 2a SGB V). */
function childSickSettingsFor(db: Db, year: number): ChildSickSettings {
  return storedChildSickSettings(db) ?? childSickDefaults(year)
}

/**
 * The settings as of `today`: the values of its year (own or legal), whether they are the Träger's own, the legal
 * values of the year, and whether own values still hold a raised value of 2026 in a later year (childSickOutdated).
 */
export function getChildSickSettings(db: Db, today: IsoDate): ChildSickSettingsDto {
  const year = parseIsoDate(today).year
  const stored = storedChildSickSettings(db)
  const legal = childSickDefaults(year)
  return {
    ...(stored ?? legal), custom: stored !== null, year, legal, outdated: stored !== null && childSickOutdated(stored, year),
  }
}

/**
 * Stores own values: whole days 0–365, each maximum at least one child's days (400 child_sick_settings_invalid, also
 * for an emptied field, which comes as text). `{ legal: true }` removes them: every year gets its legal values again.
 */
export function setChildSickSettings(
  db: Db, input: Record<keyof ChildSickSettings, number | string> | { legal: true }, today: IsoDate,
): ChildSickSettingsDto {
  if ('legal' in input) {
    db.delete(appSettings).where(eq(appSettings.key, SETTINGS_KEY)).run()
    return getChildSickSettings(db, today)
  }
  const settings = Object.fromEntries(CHILD_SICK_SETTING_KEYS.map(key => [key, input[key]])) as unknown as ChildSickSettings
  const error = childSickSettingsError(settings)
  if (error) throw new ServiceError(400, error)
  const value = JSON.stringify(settings)
  db.insert(appSettings).values({ key: SETTINGS_KEY, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } }).run()
  return getChildSickSettings(db, today)
}

/** The children of these employees by employee (for the entitlement). */
function childrenOf(db: Db, employeeIds: readonly number[]): Map<number, ChildFacts[]> {
  const map = new Map<number, ChildFacts[]>()
  if (employeeIds.length === 0) return map
  const rows = db.select({ employeeId: employeeChildren.employeeId, birthDate: employeeChildren.birthDate, disabledDependent: employeeChildren.disabledDependent })
    .from(employeeChildren).where(inArray(employeeChildren.employeeId, [...employeeIds])).all()
  for (const { employeeId, ...child } of rows) map.set(employeeId, [...(map.get(employeeId) ?? []), child])
  return map
}

/** „Kind krank“ days of these employees between from and to, by employee (distinct dates, sorted). */
function childSickDates(db: Db, employeeIds: readonly number[], from: IsoDate, to: IsoDate): Map<number, IsoDate[]> {
  const map = new Map<number, IsoDate[]>()
  if (employeeIds.length === 0) return map
  const rows = db.selectDistinct({ employeeId: entries.employeeId, date: entries.date })
    .from(entries).innerJoin(absenceCodes, eq(entries.absenceCodeId, absenceCodes.id))
    .where(and(
      eq(absenceCodes.key, 'child_sick'), inArray(entries.employeeId, [...employeeIds]), gte(entries.date, from), lte(entries.date, to),
    )).orderBy(asc(entries.date)).all()
  for (const { employeeId, date } of rows) map.set(employeeId, [...(map.get(employeeId) ?? []), date])
  return map
}

function singleParents(db: Db, employeeIds: readonly number[]): Set<number> {
  if (employeeIds.length === 0) return new Set()
  return new Set(db.select({ id: employees.id }).from(employees)
    .where(and(inArray(employees.id, [...employeeIds]), eq(employees.singleParent, true))).all().map(row => row.id))
}

/** Only the person's working days count (as for leave): a „Kind krank“ on a day off takes nothing. */
const workingDays = (employee: EmployeeRecord, dates: readonly IsoDate[]) => dates.filter(date => isWorkday(employee.info, date))

/**
 * The employee's Kinderkrankentage in the year: the working days with „Kind krank“ (planned and past) and the
 * entitlement from the children and „alleinerziehend“ (404 employee_not_found outside the facility).
 */
export function getChildSickYear(db: Db, facilityId: number, employeeId: number, year: number): ChildSickYearDto {
  assertEmployee(db, facilityId, employeeId)
  const employee = loadEmployee(db, employeeId)!
  const dates = childSickDates(db, [employeeId], `${year}-01-01`, `${year}-12-31`).get(employeeId) ?? []
  const { eligibleChildren, days } = childSickEntitlement(
    childrenOf(db, [employeeId]).get(employeeId) ?? [], singleParents(db, [employeeId]).has(employeeId), year,
    childSickSettingsFor(db, year),
  )
  return { year, taken: workingDays(employee, dates).length, entitlement: days, eligibleChildren }
}

/**
 * Plan warnings for more „Kind krank“ days than the entitlement (§ 45 SGB V), never blocking: per employee of `staff`
 * one on the last „Kind krank“ day of the month, when the working days with it from 1 January to that day exceed the
 * entitlement of the year (`taken` counted to that day). Without `withNumbers` (a viewer without the personal data)
 * the warning leaves out the days and the entitlement, which tell the children and „alleinerziehend“.
 */
export function childSickWarnings(
  db: Db, staff: readonly EmployeeRecord[], year: number, month: number, withNumbers = true,
): Warning[] {
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
  const monthEnd = `${year}-${String(month).padStart(2, '0')}-31`
  const ids = staff.map(employee => employee.id)
  const dates = childSickDates(db, ids, `${year}-01-01`, monthEnd)
  if (dates.size === 0) return []
  const children = childrenOf(db, [...dates.keys()])
  const single = singleParents(db, [...dates.keys()])
  const settings = childSickSettingsFor(db, year)
  const warnings: Warning[] = []
  for (const employee of staff) {
    const days = workingDays(employee, dates.get(employee.id) ?? [])
    const last = days.at(-1)
    if (last === undefined || last < monthStart || !isEmployedOn(employee.info, last)) continue
    const entitlement = childSickEntitlement(children.get(employee.id) ?? [], single.has(employee.id), year, settings).days
    if (days.length > entitlement) {
      warnings.push(withNumbers
        ? { type: 'child_sick_days', date: last, employeeId: employee.id, taken: days.length, entitlement }
        : { type: 'child_sick_days', date: last, employeeId: employee.id, taken: null, entitlement: null })
    }
  }
  return warnings
}
