import { and, eq, inArray, isNotNull, like, ne, or, sql } from 'drizzle-orm'
import { todayIso } from '../../shared/domain/dates'
import { confirmsName } from '../../shared/domain/confirmName'
import { mayDeleteEmployeeByHand } from '../../shared/domain/retention'
import { isManager } from '../../shared/domain/roles'
import type { IsoDate } from '../../shared/domain/types'
import type { SessionUser, SnapshotData } from '../../shared/types/api'
import type { Db } from '../db/client'
import {
  balanceAdjustments, changeLog, childAttendanceChanges, childDevelopmentDocs, childParentMeetings, children,
  earlySickLeaves, employeeHours, employeeRequirements, employees, employeeTrainings, entries, formEditors, forms,
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

/** „Zur Kenntnis genommen“ of the warnings about the employee, in every facility (they may have helped out); answers how many. */
function dropWarningAcks(db: Db, employeeId: number): number {
  const ids = db.select({ id: warningAcks.id, key: warningAcks.key }).from(warningAcks)
    .where(like(warningAcks.key, `%|${employeeId}`)).all()
    .filter(({ key }) => {
      const [type, , subject, ...rest] = key.split('|')
      return rest.length === 0 && EMPLOYEE_WARNING_TYPES.has(type ?? '') && subject === String(employeeId)
    })
    .map(row => row.id)
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
  if (!isManager(actor.role)) throw new ServiceError(403, 'forbidden')
  if (!mayDeleteEmployeeByHand(getRetentionSettings(db, facilityId).employeeDelete, actor.role)) {
    throw new ServiceError(403, 'employee_delete_disabled')
  }
  const employee = db.select({ name: employees.name, leftOn: employees.leftOn }).from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.facilityId, facilityId))).get()
  if (!employee) throw new ServiceError(404, 'employee_not_found')
  if (actor.employeeId === employeeId) throw new ServiceError(403, 'employee_delete_self')
  const account = db.select({ role: users.role }).from(users).where(eq(users.employeeId, employeeId)).get()
  if (account?.role === 'provider' && actor.role !== 'provider') throw new ServiceError(403, 'employee_delete_provider')
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
function isForeignKeyError(error: unknown): boolean {
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
 * „Sofort“: birthday, PIN and lock, qualification and share, contract fields (the row keeps name, short name, group and
 * leaving day), mandatory appointments, leave requests, notifications, week template rows, form editor grants and the
 * tablet unlock. The weekly hours and help-outs stay with the time data (deleteTimeData). A child keeps no Bezugserzieher; logs keep the name, without the id. A linked
 * Leitung or Mitarbeiter account is deleted, a Träger account only unlinked.
 */
export function deleteImmediateData(tx: Db, employeeId: number): number {
  let changed = tx.update(employees).set({
    birthday: null, pinHash: null, pinFailed: 0, pinLockedUntil: null, pinLockLevel: 0, qualification: null, staffingShare: null,
    personnelNumber: null, employedSince: null, jobKey: null, jobOther: null, payGroup: null, payLevel: null,
  }).where(and(eq(employees.id, employeeId), or(
    isNotNull(employees.birthday), isNotNull(employees.pinHash), ne(employees.pinFailed, 0), isNotNull(employees.pinLockedUntil),
    ne(employees.pinLockLevel, 0), isNotNull(employees.qualification), isNotNull(employees.staffingShare),
    isNotNull(employees.personnelNumber), isNotNull(employees.employedSince), isNotNull(employees.jobKey),
    isNotNull(employees.jobOther), isNotNull(employees.payGroup), isNotNull(employees.payLevel),
  ))).run().changes
  changed += tx.delete(employeeRequirements).where(eq(employeeRequirements.employeeId, employeeId)).run().changes
  changed += tx.delete(leaveRequests).where(eq(leaveRequests.employeeId, employeeId)).run().changes
  changed += tx.delete(notifications).where(eq(notifications.employeeId, employeeId)).run().changes
  changed += tx.delete(weekTemplateEntries).where(eq(weekTemplateEntries.employeeId, employeeId)).run().changes
  changed += tx.delete(formEditors).where(eq(formEditors.employeeId, employeeId)).run().changes
  changed += tx.delete(terminalUnlocks).where(eq(terminalUnlocks.employeeId, employeeId)).run().changes
  // References that stay: the child loses its Bezugserzieher, the logs keep the name.
  changed += tx.update(children).set({ keyEducatorId: null }).where(eq(children.keyEducatorId, employeeId)).run().changes
  changed += tx.update(childDevelopmentDocs).set({ doneByEmployeeId: null })
    .where(eq(childDevelopmentDocs.doneByEmployeeId, employeeId)).run().changes
  changed += tx.update(childParentMeetings).set({ createdByEmployeeId: null })
    .where(eq(childParentMeetings.createdByEmployeeId, employeeId)).run().changes
  changed += tx.update(childAttendanceChanges).set({ changedByEmployeeId: null })
    .where(eq(childAttendanceChanges.changedByEmployeeId, employeeId)).run().changes
  changed += tx.update(groupBookChanges).set({ changedByEmployeeId: null })
    .where(eq(groupBookChanges.changedByEmployeeId, employeeId)).run().changes
  const account = tx.select({ id: users.id, role: users.role }).from(users).where(eq(users.employeeId, employeeId)).get()
  if (account?.role === 'provider') {
    changed += tx.update(users).set({ employeeId: null }).where(eq(users.id, account.id)).run().changes
  }
  else if (account) {
    tx.delete(leavePlanners).where(eq(leavePlanners.userId, account.id)).run()
    changed += tx.delete(users).where(eq(users.id, account.id)).run().changes
  }
  return changed
}

/**
 * „Sonstige Überstunden-/Zeitdaten“: plan entries of every month (draft and released: they leave the release snapshots
 * too) with their change log, time records with corrections and notes, sick-leave markers, balance adjustments not
 * paid out, leave entitlements and the acknowledged warnings about the person; and the weekly hours history and the
 * help-outs, since a person is in a month's plan, Stundenkonto, release and leave overview only through their weekly
 * hours (isEmployedInRange), and the help-out facility's plan shows them only through the help-out.
 */
export function deleteTimeData(tx: Db, employeeId: number): number {
  let changed = tx.delete(entries).where(eq(entries.employeeId, employeeId)).run().changes
  changed += tx.delete(employeeHours).where(eq(employeeHours.employeeId, employeeId)).run().changes
  changed += tx.delete(helpOuts).where(eq(helpOuts.employeeId, employeeId)).run().changes
  dropFromSnapshots(tx, employeeId)
  changed += tx.delete(changeLog).where(eq(changeLog.employeeId, employeeId)).run().changes
  changed += tx.delete(timeRecords).where(eq(timeRecords.employeeId, employeeId)).run().changes
  changed += tx.delete(timeRecordChanges).where(eq(timeRecordChanges.employeeId, employeeId)).run().changes
  changed += tx.delete(timeDayNotes).where(eq(timeDayNotes.employeeId, employeeId)).run().changes
  changed += tx.delete(earlySickLeaves).where(eq(earlySickLeaves.employeeId, employeeId)).run().changes
  changed += tx.delete(balanceAdjustments)
    .where(and(eq(balanceAdjustments.employeeId, employeeId), eq(balanceAdjustments.paidOut, false))).run().changes
  changed += tx.delete(leaveEntitlements).where(eq(leaveEntitlements.employeeId, employeeId)).run().changes
  changed += dropWarningAcks(tx, employeeId)
  return changed
}

/** „Beurteilungen und Zeugnisse“: staff talks with all their forms, and the trainings. */
export function deleteAssessmentData(tx: Db, employeeId: number): number {
  let changed = 0
  // The forms are rows of their own (the link rows go with the talk).
  const talkIds = tx.select({ id: staffTalks.id }).from(staffTalks).where(eq(staffTalks.employeeId, employeeId)).all()
    .map(row => row.id)
  if (talkIds.length > 0) {
    const formIds = tx.select({ id: staffTalkForms.formId }).from(staffTalkForms).where(inArray(staffTalkForms.talkId, talkIds))
      .all().map(row => row.id)
    changed += tx.delete(staffTalks).where(inArray(staffTalks.id, talkIds)).run().changes
    if (formIds.length > 0) changed += tx.delete(forms).where(inArray(forms.id, formIds)).run().changes
  }
  changed += tx.delete(employeeTrainings).where(eq(employeeTrainings.employeeId, employeeId)).run().changes
  return changed
}

/** „Ausgezahlte Überstunden“: the balance adjustments marked „ausgezahlt“. */
export function deletePaidOvertimeData(tx: Db, employeeId: number): number {
  return tx.delete(balanceAdjustments)
    .where(and(eq(balanceAdjustments.employeeId, employeeId), eq(balanceAdjustments.paidOut, true))).run().changes
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
