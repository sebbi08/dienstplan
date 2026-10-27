import { and, eq, inArray, like, sql } from 'drizzle-orm'
import { todayIso } from '../../shared/domain/dates'
import { confirmsName } from '../../shared/domain/confirmName'
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
function dropWarningAcks(db: Db, employeeId: number): void {
  const ids = db.select({ id: warningAcks.id, key: warningAcks.key }).from(warningAcks)
    .where(like(warningAcks.key, `%|${employeeId}`)).all()
    .filter(({ key }) => {
      const [type, , subject, ...rest] = key.split('|')
      return rest.length === 0 && EMPLOYEE_WARNING_TYPES.has(type ?? '') && subject === String(employeeId)
    })
    .map(row => row.id)
  if (ids.length > 0) db.delete(warningAcks).where(inArray(warningAcks.id, ids)).run()
}

/**
 * Deletes an employee who already left (`leftOn` before today, as the staff page's archive) for good, with everything
 * that belongs to them: plan entries of every month (draft and released: they leave the release snapshots too), change
 * log, time records with corrections and notes, sick-leave markers, balances, hours, leave, mandatory appointments and
 * trainings, help-outs, staff talks with their forms, notifications, warning acknowledgements, week template rows, form
 * editor grants and the tablet unlock. A child keeps no Bezugserzieher; logs keep the name, without the id. A linked
 * Leitung or Mitarbeiter account is deleted, a Träger account only unlinked.
 *
 * Only Träger and Leitung (403 forbidden), for an employee of their facility (404 employee_not_found), never their own
 * record (403 employee_delete_self); a Leitung cannot delete a Träger's employee (403 employee_delete_provider). 409
 * employee_not_left before the leaving day has passed, 400 employee_delete_confirm_mismatch unless `confirm` is the
 * name (compared as confirmsName does). Everything happens in one transaction; a reference left behind rolls it back
 * with 409 employee_delete_blocked.
 */
export function deleteLeftEmployee(
  db: Db, actor: SessionUser, facilityId: number, employeeId: number, confirm: string, today: IsoDate = todayIso(),
): void {
  if (!isManager(actor.role)) throw new ServiceError(403, 'forbidden')
  const employee = db.select({ name: employees.name, leftOn: employees.leftOn }).from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.facilityId, facilityId))).get()
  if (!employee) throw new ServiceError(404, 'employee_not_found')
  if (actor.employeeId === employeeId) throw new ServiceError(403, 'employee_delete_self')
  const account = db.select({ id: users.id, role: users.role }).from(users).where(eq(users.employeeId, employeeId)).get()
  if (account?.role === 'provider' && actor.role !== 'provider') throw new ServiceError(403, 'employee_delete_provider')
  if (employee.leftOn === null || employee.leftOn >= today) throw new ServiceError(409, 'employee_not_left')
  if (!confirmsName(confirm, employee.name)) throw new ServiceError(400, 'employee_delete_confirm_mismatch')

  // Only violations the delete would add count: an old one elsewhere (say from a restored backup) blocks nothing.
  const before = new Set(foreignKeyViolations(db))
  try {
    db.transaction(tx => removeEmployee(tx, employeeId, account, before))
  }
  catch (error) {
    if (error instanceof ServiceError) throw error
    if (isForeignKeyError(error)) throw new ServiceError(409, 'employee_delete_blocked')
    throw error
  }
}

/** PRAGMA foreign_key_check as comparable strings (table, row, referenced table, constraint). */
function foreignKeyViolations(db: Db): string[] {
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

/** The writes of deleteLeftEmployee, inside its transaction. */
function removeEmployee(
  tx: Db, employeeId: number, account: { id: number; role: string } | undefined, before: Set<string>,
): void {
  // Staff talks: the forms are rows of their own (the link rows go with the talk).
  const talkIds = tx.select({ id: staffTalks.id }).from(staffTalks).where(eq(staffTalks.employeeId, employeeId)).all()
    .map(row => row.id)
  if (talkIds.length > 0) {
    const formIds = tx.select({ id: staffTalkForms.formId }).from(staffTalkForms).where(inArray(staffTalkForms.talkId, talkIds))
      .all().map(row => row.id)
    tx.delete(staffTalks).where(inArray(staffTalks.id, talkIds)).run()
    if (formIds.length > 0) tx.delete(forms).where(inArray(forms.id, formIds)).run()
  }
  tx.delete(entries).where(eq(entries.employeeId, employeeId)).run()
  tx.delete(helpOuts).where(eq(helpOuts.employeeId, employeeId)).run()
  tx.delete(changeLog).where(eq(changeLog.employeeId, employeeId)).run()
  tx.delete(timeRecords).where(eq(timeRecords.employeeId, employeeId)).run()
  tx.delete(timeRecordChanges).where(eq(timeRecordChanges.employeeId, employeeId)).run()
  tx.delete(timeDayNotes).where(eq(timeDayNotes.employeeId, employeeId)).run()
  tx.delete(earlySickLeaves).where(eq(earlySickLeaves.employeeId, employeeId)).run()
  tx.delete(balanceAdjustments).where(eq(balanceAdjustments.employeeId, employeeId)).run()
  tx.delete(employeeHours).where(eq(employeeHours.employeeId, employeeId)).run()
  tx.delete(leaveEntitlements).where(eq(leaveEntitlements.employeeId, employeeId)).run()
  tx.delete(leaveRequests).where(eq(leaveRequests.employeeId, employeeId)).run()
  tx.delete(notifications).where(eq(notifications.employeeId, employeeId)).run()
  tx.delete(employeeRequirements).where(eq(employeeRequirements.employeeId, employeeId)).run()
  tx.delete(employeeTrainings).where(eq(employeeTrainings.employeeId, employeeId)).run()
  tx.delete(weekTemplateEntries).where(eq(weekTemplateEntries.employeeId, employeeId)).run()
  tx.delete(formEditors).where(eq(formEditors.employeeId, employeeId)).run()
  tx.delete(terminalUnlocks).where(eq(terminalUnlocks.employeeId, employeeId)).run()
  dropFromSnapshots(tx, employeeId)
  dropWarningAcks(tx, employeeId)
  // References that stay: the child loses its Bezugserzieher, the logs keep the name.
  tx.update(children).set({ keyEducatorId: null }).where(eq(children.keyEducatorId, employeeId)).run()
  tx.update(childDevelopmentDocs).set({ doneByEmployeeId: null }).where(eq(childDevelopmentDocs.doneByEmployeeId, employeeId)).run()
  tx.update(childParentMeetings).set({ createdByEmployeeId: null }).where(eq(childParentMeetings.createdByEmployeeId, employeeId)).run()
  tx.update(childAttendanceChanges).set({ changedByEmployeeId: null }).where(eq(childAttendanceChanges.changedByEmployeeId, employeeId)).run()
  tx.update(groupBookChanges).set({ changedByEmployeeId: null }).where(eq(groupBookChanges.changedByEmployeeId, employeeId)).run()
  if (account?.role === 'provider') {
    tx.update(users).set({ employeeId: null }).where(eq(users.id, account.id)).run()
  }
  else if (account) {
    tx.delete(leavePlanners).where(eq(leavePlanners.userId, account.id)).run()
    tx.delete(users).where(eq(users.id, account.id)).run()
  }
  tx.delete(employees).where(eq(employees.id, employeeId)).run()
  if (foreignKeyViolations(tx).some(violation => !before.has(violation))) throw new ServiceError(409, 'employee_delete_blocked')
}
