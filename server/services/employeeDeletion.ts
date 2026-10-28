import { and, eq, inArray, isNotNull, like, ne, or, sql, type SQL } from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { todayIso } from '../../shared/domain/dates'
import { confirmsName } from '../../shared/domain/confirmName'
import { mayDeleteEmployeeByHand } from '../../shared/domain/retention'
import { can } from '../../shared/domain/permissions'
import type { IsoDate } from '../../shared/domain/types'
import type { SessionUser, SnapshotData } from '../../shared/types/api'
import type { Db } from '../db/client'
import {
  balanceAdjustments, changeLog, childAttendanceChanges, childDevelopmentDocs, childParentMeetings, children,
  earlySickLeaves, employeeEmergencyContacts, employeeHours, employeeRequirements, employees, employeeTrainings, entries,
  formEditors, forms,
  groupBookChanges, helpOuts, leaveEntitlements, leavePlanners, leaveRequests, notifications, releaseSnapshots,
  staffTalkForms, staffTalks, terminalUnlocks, timeDayNotes, timeRecordChanges, timeRecords, users, warningAcks,
  weekTemplateEntries,
} from '../db/schema'
import { ServiceError } from '../lib/errors'
import { getRetentionSettings } from './retentionSettings'

/** Warning types whose acknowledgement key names an employee as subject (`<type>|<date>|<employeeId>`, warningList.ts). */
const EMPLOYEE_WARNING_TYPES = new Set(['missing_entry', 'target_gap', 'open_record', 'missing_record', 'break_rule', 'record_without_plan'])

/** Release snapshots of every facility (home, former home, help-out plans) without the employee's column and cells. */
function dropFromSnapshots(db: Db, employeeId: number): void {
  for (const row of db.select({ id: releaseSnapshots.id, data: releaseSnapshots.data }).from(releaseSnapshots).all()) {
    const data = JSON.parse(row.data) as SnapshotData
    const kept = {
      ...data,
      employees: data.employees.filter(employee => employee.id !== employeeId),
      entries: data.entries.filter(entry => entry.employeeId !== employeeId),
    }
    if (kept.employees.length === data.employees.length && kept.entries.length === data.entries.length) continue
    db.update(releaseSnapshots).set({ data: JSON.stringify(kept) }).where(eq(releaseSnapshots.id, row.id)).run()
  }
}

/** „Zur Kenntnis genommen“ of the warnings about the employee, in every facility (they may have helped out). */
function warningAckIds(db: Db, employeeId: number): number[] {
  return db.select({ id: warningAcks.id, key: warningAcks.key }).from(warningAcks)
    .where(like(warningAcks.key, `%|${employeeId}`)).all()
    .filter(({ key }) => {
      const [type, , subject, ...rest] = key.split('|')
      return rest.length === 0 && EMPLOYEE_WARNING_TYPES.has(type ?? '') && subject === String(employeeId)
    })
    .map(row => row.id)
}

/** Deletes the acknowledgements of warningAckIds; answers how many. */
function dropWarningAcks(db: Db, employeeId: number): number {
  const ids = warningAckIds(db, employeeId)
  return ids.length > 0 ? db.delete(warningAcks).where(inArray(warningAcks.id, ids)).run().changes : 0
}

/**
 * Deletes an employee who already left (`leftOn` before today, as the staff page's archive) for good, with everything
 * that belongs to them: every retention category at once (see RETENTION_CATEGORIES), then the employee row. A child
 * keeps no Bezugserzieher; logs keep the name, without the id. A linked Leitung or Mitarbeiter account is deleted, a
 * Träger account only unlinked.
 *
 * Only Träger and Leitung (403 forbidden), as far as the facility's Träger setting „Mitarbeiter endgültig löschen“
 * allows (aus: nobody, nur Träger: no Leitung; 403 employee_delete_disabled, retentionSettings.ts), for an employee of their facility (404 employee_not_found), never their own
 * record (403 employee_delete_self); a Leitung cannot delete a Träger's employee (403 employee_delete_provider). 409
 * employee_not_left before the leaving day has passed, 400 employee_delete_confirm_mismatch unless `confirm` is the
 * name (compared as confirmsName does). Everything happens in one transaction; a reference left behind rolls it back
 * with 409 employee_delete_blocked.
 */
export function deleteLeftEmployee(
  db: Db, actor: SessionUser, facilityId: number, employeeId: number, confirm: string, today: IsoDate = todayIso(),
): void {
  if (!can(actor.permissions, 'employees.delete')) throw new ServiceError(403, 'forbidden')
  // The Träger's per-facility setting („aus / nur Träger / Leitung und Träger“) stays a rule next to the permissions.
  if (!mayDeleteEmployeeByHand(getRetentionSettings(db, facilityId).employeeDelete, actor.role)) {
    throw new ServiceError(403, 'employee_delete_disabled')
  }
  const employee = db.select({ name: employees.name, leftOn: employees.leftOn }).from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.facilityId, facilityId))).get()
  if (!employee) throw new ServiceError(404, 'employee_not_found')
  if (actor.employeeId === employeeId) throw new ServiceError(403, 'employee_delete_self')
  const account = db.select({ role: users.role }).from(users).where(eq(users.employeeId, employeeId)).get()
  // A Träger's employee (with the Träger account) only by whoever manages Träger accounts.
  if (account?.role === 'provider' && !can(actor.permissions, 'users.providerAccounts')) {
    throw new ServiceError(403, 'employee_delete_provider')
  }
  if (employee.leftOn === null || employee.leftOn >= today) throw new ServiceError(409, 'employee_not_left')
  if (!confirmsName(confirm, employee.name)) throw new ServiceError(400, 'employee_delete_confirm_mismatch')

  // Only violations the delete would add count: an old one elsewhere (say from a restored backup) blocks nothing.
  const before = new Set(foreignKeyViolations(db))
  try {
    db.transaction(tx => removeEmployee(tx, employeeId, before))
  }
  catch (error) {
    if (error instanceof ServiceError) throw error
    if (isForeignKeyError(error)) throw new ServiceError(409, 'employee_delete_blocked')
    throw error
  }
}

/** PRAGMA foreign_key_check as comparable strings (table, row, referenced table, constraint). */
export function foreignKeyViolations(db: Db): string[] {
  return db.all<{ table: string; rowid: number | null; parent: string; fkid: number }>(sql`PRAGMA foreign_key_check`)
    .map(row => `${row.table}|${row.rowid}|${row.parent}|${row.fkid}`)
}

/** A row still pointing at the employee through a reference without ON DELETE, as SQLite reports it (also wrapped). */
export function isForeignKeyError(error: unknown): boolean {
  for (let current: unknown = error; current instanceof Error; current = (current as Error & { cause?: unknown }).cause) {
    const code = (current as Error & { code?: unknown }).code
    if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || current.message.includes('FOREIGN KEY constraint failed')) return true
  }
  return false
}

/** The writes of deleteLeftEmployee, inside its transaction: every category at once, then the employee row. */
function removeEmployee(tx: Db, employeeId: number, before: Set<string>): void {
  deleteCategories(tx, employeeId, RETENTION_CATEGORIES)
  deleteEmployeeRow(tx, employeeId)
  if (foreignKeyViolations(tx).some(violation => !before.has(violation))) throw new ServiceError(409, 'employee_delete_blocked')
}

/**
 * The deletion categories after leaving (spec Löschfristen §2), in the order they come due with the default periods.
 * Each helper deletes (or, for references that stay, clears) what belongs to its category and answers how many rows it
 * changed; run again it changes nothing. The employee row itself goes last (deleteEmployeeRow).
 */
export const RETENTION_CATEGORIES = ['immediate', 'time', 'assessment', 'paidOvertime'] as const
export type RetentionCategory = typeof RETENTION_CATEGORIES[number]

/**
 * Rows of a table that belong to the employee (`column` = the employee id, narrowed by `also`). The same lists drive
 * the deletion helpers and categoryHasData, so what a category deletes and what counts as its data cannot drift apart.
 */
interface EmployeeRows { table: SQLiteTable; column: SQLiteColumn; also?: SQL }

const rowsOf = (employeeId: number, rows: EmployeeRows) =>
  rows.also ? and(eq(rows.column, employeeId), rows.also) : eq(rows.column, employeeId)

function deleteRows(tx: Db, employeeId: number, list: readonly EmployeeRows[]): number {
  return list.reduce((changed, rows) => changed + tx.delete(rows.table).where(rowsOf(employeeId, rows)).run().changes, 0)
}

/** References that stay with their row: the column is set to null. */
function clearRows(tx: Db, employeeId: number, list: readonly EmployeeRows[]): number {
  return list.reduce((changed, rows) => changed
    + tx.run(sql`UPDATE ${rows.table} SET ${sql.identifier(rows.column.name)} = NULL WHERE ${rowsOf(employeeId, rows)}`).changes, 0)
}

function anyRows(db: Db, employeeId: number, list: readonly EmployeeRows[]): boolean {
  return list.some(rows => db.select({ one: sql`1` }).from(rows.table).where(rowsOf(employeeId, rows)).limit(1).get() !== undefined)
}

/** „Sofort“: the fields of the employee row that are cleared (the row keeps name, short name, group and leaving day). */
const IMMEDIATE_FIELDS_CLEARED = {
  birthday: null, pinHash: null, pinFailed: 0, pinLockedUntil: null, pinLockLevel: 0, qualification: null, staffingShare: null,
  personnelNumber: null, employedSince: null, jobKey: null, jobOther: null, payGroup: null, payLevel: null,
}
/** The employee row while one of IMMEDIATE_FIELDS_CLEARED still holds something. */
const immediateFieldsSet = (employeeId: number) => and(eq(employees.id, employeeId), or(
  isNotNull(employees.birthday), isNotNull(employees.pinHash), ne(employees.pinFailed, 0), isNotNull(employees.pinLockedUntil),
  ne(employees.pinLockLevel, 0), isNotNull(employees.qualification), isNotNull(employees.staffingShare),
  isNotNull(employees.personnelNumber), isNotNull(employees.employedSince), isNotNull(employees.jobKey),
  isNotNull(employees.jobOther), isNotNull(employees.payGroup), isNotNull(employees.payLevel),
))
const IMMEDIATE_ROWS: readonly EmployeeRows[] = [
  { table: employeeEmergencyContacts, column: employeeEmergencyContacts.employeeId },
  { table: employeeRequirements, column: employeeRequirements.employeeId },
  { table: leaveRequests, column: leaveRequests.employeeId },
  { table: notifications, column: notifications.employeeId },
  { table: weekTemplateEntries, column: weekTemplateEntries.employeeId },
  { table: formEditors, column: formEditors.employeeId },
  { table: terminalUnlocks, column: terminalUnlocks.employeeId },
]
/** References that stay: the child loses its Bezugserzieher, the logs keep the name. */
const IMMEDIATE_CLEARED: readonly EmployeeRows[] = [
  { table: children, column: children.keyEducatorId },
  { table: childDevelopmentDocs, column: childDevelopmentDocs.doneByEmployeeId },
  { table: childParentMeetings, column: childParentMeetings.createdByEmployeeId },
  { table: childAttendanceChanges, column: childAttendanceChanges.changedByEmployeeId },
  { table: groupBookChanges, column: groupBookChanges.changedByEmployeeId },
]
/** The linked account: deleted, a Träger account only unlinked. */
const ACCOUNT: EmployeeRows = { table: users, column: users.employeeId }

/**
 * „Sofort“: birthday, PIN and lock, qualification and share, contract fields (the row keeps name, short name, group and
 * leaving day), emergency contacts, mandatory appointments, leave requests, notifications, week template rows, form editor
 * grants and the tablet unlock. The weekly hours and help-outs stay with the time data (deleteTimeData). A child keeps no Bezugserzieher; logs keep the name, without the id. A linked
 * Leitung or Mitarbeiter account is deleted, a Träger account only unlinked.
 */
export function deleteImmediateData(tx: Db, employeeId: number): number {
  let changed = tx.update(employees).set(IMMEDIATE_FIELDS_CLEARED).where(immediateFieldsSet(employeeId)).run().changes
  changed += deleteRows(tx, employeeId, IMMEDIATE_ROWS)
  changed += clearRows(tx, employeeId, IMMEDIATE_CLEARED)
  const account = tx.select({ id: users.id, role: users.role }).from(users).where(rowsOf(employeeId, ACCOUNT)).get()
  if (account?.role === 'provider') {
    changed += tx.update(users).set({ employeeId: null }).where(eq(users.id, account.id)).run().changes
  }
  else if (account) {
    tx.delete(leavePlanners).where(eq(leavePlanners.userId, account.id)).run()
    changed += tx.delete(users).where(eq(users.id, account.id)).run().changes
  }
  return changed
}

/** „Sonstige Überstunden-/Zeitdaten“ (deleteTimeData); the release snapshots and the warning acks come on top. */
const TIME_ROWS: readonly EmployeeRows[] = [
  { table: entries, column: entries.employeeId },
  { table: employeeHours, column: employeeHours.employeeId },
  { table: helpOuts, column: helpOuts.employeeId },
  { table: changeLog, column: changeLog.employeeId },
  { table: timeRecords, column: timeRecords.employeeId },
  { table: timeRecordChanges, column: timeRecordChanges.employeeId },
  { table: timeDayNotes, column: timeDayNotes.employeeId },
  { table: earlySickLeaves, column: earlySickLeaves.employeeId },
  { table: balanceAdjustments, column: balanceAdjustments.employeeId, also: eq(balanceAdjustments.paidOut, false) },
  { table: leaveEntitlements, column: leaveEntitlements.employeeId },
]

/**
 * „Sonstige Überstunden-/Zeitdaten“: plan entries of every month (draft and released: they leave the release snapshots
 * too) with their change log, time records with corrections and notes, sick-leave markers, balance adjustments not
 * paid out, leave entitlements and the acknowledged warnings about the person; and the weekly hours history and the
 * help-outs, since a person is in a month's plan, Stundenkonto, release and leave overview only through their weekly
 * hours (isEmployedInRange), and the help-out facility's plan shows them only through the help-out.
 */
export function deleteTimeData(tx: Db, employeeId: number): number {
  dropFromSnapshots(tx, employeeId)
  return deleteRows(tx, employeeId, TIME_ROWS) + dropWarningAcks(tx, employeeId)
}

/** „Beurteilungen und Zeugnisse“: staff talks (their forms go along, deleteAssessmentData) and trainings. */
const ASSESSMENT_ROWS: readonly EmployeeRows[] = [
  { table: staffTalks, column: staffTalks.employeeId },
  { table: employeeTrainings, column: employeeTrainings.employeeId },
]

/** „Beurteilungen und Zeugnisse“: staff talks with all their forms, and the trainings. */
export function deleteAssessmentData(tx: Db, employeeId: number): number {
  // The forms are rows of their own (the link rows go with the talk).
  const formIds = tx.select({ id: staffTalkForms.formId }).from(staffTalkForms)
    .innerJoin(staffTalks, eq(staffTalks.id, staffTalkForms.talkId)).where(eq(staffTalks.employeeId, employeeId)).all()
    .map(row => row.id)
  let changed = deleteRows(tx, employeeId, ASSESSMENT_ROWS)
  if (formIds.length > 0) changed += tx.delete(forms).where(inArray(forms.id, formIds)).run().changes
  return changed
}

/** „Ausgezahlte Überstunden“: the balance adjustments marked „ausgezahlt“. */
const PAID_OVERTIME_ROWS: readonly EmployeeRows[] = [
  { table: balanceAdjustments, column: balanceAdjustments.employeeId, also: eq(balanceAdjustments.paidOut, true) },
]

/** „Ausgezahlte Überstunden“: the balance adjustments marked „ausgezahlt“. */
export function deletePaidOvertimeData(tx: Db, employeeId: number): number {
  return deleteRows(tx, employeeId, PAID_OVERTIME_ROWS)
}

/** Whether the employee has balance adjustments marked „ausgezahlt“ (kept for the paid-overtime period). */
export function hasPaidOut(db: Db, employeeId: number): boolean {
  return anyRows(db, employeeId, PAID_OVERTIME_ROWS)
}

/**
 * Per category whether its helper would still delete or clear something, from the same row lists (the release
 * snapshots aside: deleteEmployeeRow takes the person out of them anyway). A category without data is no item of the
 * retention overview; the employee row may go once every category says false.
 */
export function categoryHasData(db: Db, employeeId: number): Record<RetentionCategory, boolean> {
  return {
    immediate: db.select({ id: employees.id }).from(employees).where(immediateFieldsSet(employeeId)).get() !== undefined
      || anyRows(db, employeeId, [...IMMEDIATE_ROWS, ...IMMEDIATE_CLEARED, ACCOUNT]),
    time: anyRows(db, employeeId, TIME_ROWS) || warningAckIds(db, employeeId).length > 0,
    assessment: anyRows(db, employeeId, ASSESSMENT_ROWS),
    paidOvertime: hasPaidOut(db, employeeId),
  }
}

const DELETE_CATEGORY: Record<RetentionCategory, (tx: Db, employeeId: number) => number> = {
  immediate: deleteImmediateData, time: deleteTimeData, assessment: deleteAssessmentData, paidOvertime: deletePaidOvertimeData,
}

/** Runs the given categories in their order; answers the changed rows per category (0 for those not run). */
export function deleteCategories(
  tx: Db, employeeId: number, categories: readonly RetentionCategory[],
): Record<RetentionCategory, number> {
  const counts: Record<RetentionCategory, number> = { immediate: 0, time: 0, assessment: 0, paidOvertime: 0 }
  for (const category of RETENTION_CATEGORIES) {
    if (categories.includes(category)) counts[category] = DELETE_CATEGORY[category](tx, employeeId)
  }
  return counts
}

/**
 * The employee row itself (name, short name, group, leaving day), after every category: the release snapshots no longer
 * name the person either. Answers 1 when the row was deleted.
 */
export function deleteEmployeeRow(tx: Db, employeeId: number): number {
  dropFromSnapshots(tx, employeeId)
  return tx.delete(employees).where(eq(employees.id, employeeId)).run().changes
}
