import { and, eq, inArray, isNotNull, like, ne, or, sql, type SQL } from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { todayIso } from '../../shared/domain/dates'
import { confirmsName } from '../../shared/domain/confirmName'
import { mayDeleteEmployeeByHand } from '../../shared/domain/retention'
import { can } from '../../shared/domain/permissions'
import { EMPLOYEE_DOCUMENT_FOLDERS, FOLDER_RETENTION } from '../../shared/domain/personnel'
import type { IsoDate } from '../../shared/domain/types'
import type { SessionUser, SnapshotData } from '../../shared/types/api'
import type { Db } from '../db/client'
import {
  balanceAdjustments, bemProcesses, changeLog, childAttendanceChanges, childDevelopmentDocs, childNotes, childParentMeetings, children,
  earlySickLeaves, employeeChildren, employeeDocuments, employeeEmergencyConsent, employeeEmergencyConsentLog, employeeEmergencyContacts, employeeHours, employeePayroll, employeeRequirements, employees, employeeTrainings, entries,
  formAttachments, formEditors, forms, maternityCases,
  groupBookChanges, helpOuts, leaveEntitlements, leaveForfeitReceipts, leavePlanners, leaveRequests, notifications, offlineStamps,
  releaseSnapshots,
  staffTalkForms, staffTalks, terminalUnlocks, timeDayNotes, timeRecordChanges, timeRecords, users, warningAcks,
  weekTemplateEntries,
} from '../db/schema'
import { ServiceError } from '../lib/errors'
import { getRetentionSettings } from './retentionSettings'

/** Warning types whose acknowledgement key names an employee as subject (`<type>|<date>|<employeeId>`, warningList.ts). */
const EMPLOYEE_WARNING_TYPES = new Set([
  'missing_entry', 'target_gap', 'open_record', 'missing_record', 'break_rule', 'record_without_plan', 'record_on_absence',
  'max_hours', 'max_hours_recorded', 'short_rest', 'short_rest_recorded', 'child_sick_days', 'work_limit',
  'youth_birth_year', 'youth_birthday',
])

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

/**
 * „Zur Kenntnis genommen“ of the warnings about the employee, in every facility (they may have helped out); the
 * Mutterschutz and Jugendarbeitsschutz hints name the rule after the employee (`maternity|<date>|<employeeId>|<rule>`,
 * `youth|…`).
 */
function warningAckIds(db: Db, employeeId: number): number[] {
  return db.select({ id: warningAcks.id, key: warningAcks.key }).from(warningAcks)
    .where(or(
      like(warningAcks.key, `%|${employeeId}`), like(warningAcks.key, `maternity|%|${employeeId}|%`),
      like(warningAcks.key, `youth|%|${employeeId}|%`),
    )).all()
    .filter(({ key }) => {
      const [type, , subject, ...rest] = key.split('|')
      if (type === 'maternity' || type === 'youth') return rest.length === 1 && subject === String(employeeId)
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
 * changed; run again it changes nothing. The employee row itself goes last (deleteEmployeeRow). „BEM-Unterlagen“ (`bem`)
 * count from the end of each process rather than from leaving (server/services/bem.ts, also for employees still there);
 * its helper here deletes all of them, as „Endgültig löschen“ does. „Mutterschutz-Unterlagen“ (`maternity`) the same from
 * the end of each case (server/services/maternity.ts). „Lohn und Steuer“ (`payroll`) is due with the personal data while a
 * Lohnbüro keeps the payroll records (the facility's retention setting, the default; the overview then lists and deletes
 * it as part of `immediate`), otherwise 6 years after the end of the leaving year (retentionDueDates).
 */
export const RETENTION_CATEGORIES = ['immediate', 'payroll', 'time', 'assessment', 'bem', 'maternity', 'paidOvertime'] as const
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
  // The personnel file (spec Personalakte §7): personal and sensitive fields, „befristet bis“.
  birthYear: null, street: null, postalCode: null, city: null, phone: null, email: null, nationality: null, disability: false,
  disabilityDegree: null, disabilityEqual: false, disabilityUntil: null, fixedTermUntil: null,
  // „Probezeit bis“, „Ausbildung/Studium hier bis“ and „Anerkennungsjahr zählt als Stufe 1“ with the contract data.
  probationUntil: null, trainingUntil: null, recognitionYearCounts: false,
  // „alleinerziehend“ with the children (IMMEDIATE_ROWS).
  singleParent: false,
}
/** The employee row while one of IMMEDIATE_FIELDS_CLEARED still holds something. */
const immediateFieldsSet = (employeeId: number) => and(eq(employees.id, employeeId), or(
  isNotNull(employees.birthday), isNotNull(employees.pinHash), ne(employees.pinFailed, 0), isNotNull(employees.pinLockedUntil),
  ne(employees.pinLockLevel, 0), isNotNull(employees.qualification), isNotNull(employees.staffingShare),
  isNotNull(employees.personnelNumber), isNotNull(employees.employedSince), isNotNull(employees.jobKey),
  isNotNull(employees.jobOther), isNotNull(employees.payGroup), isNotNull(employees.payLevel),
  isNotNull(employees.birthYear), isNotNull(employees.street), isNotNull(employees.postalCode), isNotNull(employees.city),
  isNotNull(employees.phone), isNotNull(employees.email), isNotNull(employees.nationality), ne(employees.disability, false),
  isNotNull(employees.disabilityDegree), ne(employees.disabilityEqual, false), isNotNull(employees.disabilityUntil),
  isNotNull(employees.fixedTermUntil), isNotNull(employees.probationUntil), isNotNull(employees.trainingUntil),
  ne(employees.recognitionYearCounts, false), ne(employees.singleParent, false),
))
const IMMEDIATE_ROWS: readonly EmployeeRows[] = [
  { table: employeeEmergencyContacts, column: employeeEmergencyContacts.employeeId },
  // The children (Kinderkrankentage, Pflegeversicherung): personal data; „Kind krank“ entries only lose the link.
  { table: employeeChildren, column: employeeChildren.employeeId },
  // The consent to show them at the tablet, with its log: personal data of the same kind.
  { table: employeeEmergencyConsent, column: employeeEmergencyConsent.employeeId },
  { table: employeeEmergencyConsentLog, column: employeeEmergencyConsentLog.employeeId },
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
  { table: childNotes, column: childNotes.educatorEmployeeId },
  { table: childNotes, column: childNotes.createdByEmployeeId },
  // The author of an accident report (e.g. about a child at the tablet): the report stays, „zuletzt geändert von“ keeps the name.
  { table: forms, column: forms.createdByEmployeeId },
  // Who uploaded an accident report's attachment: the file stays with its uploader's name.
  { table: formAttachments, column: formAttachments.uploadedByEmployeeId },
  { table: childAttendanceChanges, column: childAttendanceChanges.changedByEmployeeId },
  { table: groupBookChanges, column: groupBookChanges.changedByEmployeeId },
]
/** The linked account: deleted, a Träger account only unlinked. */
const ACCOUNT: EmployeeRows = { table: users, column: users.employeeId }
/**
 * The employee's Sonderurlaub entries that still carry a reason (key or text, often about relatives' health): the
 * reason goes with the immediate data, the entry („Sonderurlaub“) stays with the time data for the hours account.
 */
const specialLeaveReasonsOf = (employeeId: number) => and(
  eq(entries.employeeId, employeeId), or(isNotNull(entries.specialLeaveReason), isNotNull(entries.specialLeaveText)),
)

/**
 * „Sofort“: birthday, PIN and lock, qualification and share, contract fields, the personnel file's personal and
 * sensitive fields and „befristet bis“ (the row keeps name, short name, group and leaving day), the children with
 * „alleinerziehend“, the reasons of Sonderurlaub (the entries stay), emergency contacts with the consent to show them at the tablet and its log, mandatory appointments, leave requests, notifications, week template rows, form editor
 * grants and the tablet unlock. The weekly hours and help-outs stay with the time data (deleteTimeData). A child keeps no Bezugserzieher; logs keep the name, without the id. A linked
 * Leitung or Mitarbeiter account is deleted, a Träger account only unlinked.
 */
export function deleteImmediateData(tx: Db, employeeId: number): number {
  let changed = tx.update(employees).set(IMMEDIATE_FIELDS_CLEARED).where(immediateFieldsSet(employeeId)).run().changes
  changed += deleteRows(tx, employeeId, IMMEDIATE_ROWS)
  changed += clearRows(tx, employeeId, IMMEDIATE_CLEARED)
  changed += tx.update(entries).set({ specialLeaveReason: null, specialLeaveText: null }).where(specialLeaveReasonsOf(employeeId)).run().changes
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

/** „Lohn und Steuer“ of the personnel file (Steuer-ID, Steuerklasse, SV-Nummer, Krankenkasse, Bankverbindung, Konfession). */
const PAYROLL_ROWS: readonly EmployeeRows[] = [{ table: employeePayroll, column: employeePayroll.employeeId }]

/** „Lohn und Steuer“: the employee's payroll row. */
export function deletePayrollData(tx: Db, employeeId: number): number {
  return deleteRows(tx, employeeId, PAYROLL_ROWS)
}

/** „Sonstige Überstunden-/Zeitdaten“ (deleteTimeData); the release snapshots and the warning acks come on top. */
const TIME_ROWS: readonly EmployeeRows[] = [
  { table: entries, column: entries.employeeId },
  { table: employeeHours, column: employeeHours.employeeId },
  { table: helpOuts, column: helpOuts.employeeId },
  { table: changeLog, column: changeLog.employeeId },
  { table: timeRecords, column: timeRecords.employeeId },
  { table: timeRecordChanges, column: timeRecordChanges.employeeId },
  // The offline stamps of the tablet (taken over or on the review list) go with the time records.
  { table: offlineStamps, column: offlineStamps.employeeId },
  { table: timeDayNotes, column: timeDayNotes.employeeId },
  { table: earlySickLeaves, column: earlySickLeaves.employeeId },
  { table: balanceAdjustments, column: balanceAdjustments.employeeId, also: eq(balanceAdjustments.paidOut, false) },
  { table: leaveEntitlements, column: leaveEntitlements.employeeId },
  // The read receipts of the notice on remaining leave: evidence about the leave, kept as long as the leave data.
  { table: leaveForfeitReceipts, column: leaveForfeitReceipts.employeeId },
]

/**
 * „Sonstige Überstunden-/Zeitdaten“: plan entries of every month (draft and released: they leave the release snapshots
 * too) with their change log, time records with corrections and notes, sick-leave markers, balance adjustments not
 * paid out, leave entitlements with the read receipts of the notice on remaining leave and the acknowledged warnings
 * about the person; and the weekly hours history and the
 * help-outs, since a person is in a month's plan, Stundenkonto, release and leave overview only through their weekly
 * hours (isEmployedInRange), and the help-out facility's plan shows them only through the help-out.
 */
export function deleteTimeData(tx: Db, employeeId: number): number {
  dropFromSnapshots(tx, employeeId)
  return deleteRows(tx, employeeId, TIME_ROWS) + dropWarningAcks(tx, employeeId)
}

/** The personnel file's document folders of a retention category (shared/domain/personnel.ts FOLDER_RETENTION). */
const documentsOf = (category: 'assessment' | 'paidOvertime'): EmployeeRows => ({
  table: employeeDocuments,
  column: employeeDocuments.employeeId,
  also: inArray(employeeDocuments.folder, EMPLOYEE_DOCUMENT_FOLDERS.filter(folder => FOLDER_RETENTION[folder] === category)),
})

/**
 * „Beurteilungen und Zeugnisse“: staff talks (their forms go along, deleteAssessmentData), trainings, and the documents
 * in the folders application, qualifications, correspondence and measures.
 */
const ASSESSMENT_ROWS: readonly EmployeeRows[] = [
  { table: staffTalks, column: staffTalks.employeeId },
  { table: employeeTrainings, column: employeeTrainings.employeeId },
  documentsOf('assessment'),
]

/** „Beurteilungen und Zeugnisse“: staff talks with all their forms, the trainings and their folders' documents. */
export function deleteAssessmentData(tx: Db, employeeId: number): number {
  // The forms are rows of their own (the link rows go with the talk).
  const formIds = tx.select({ id: staffTalkForms.formId }).from(staffTalkForms)
    .innerJoin(staffTalks, eq(staffTalks.id, staffTalkForms.talkId)).where(eq(staffTalks.employeeId, employeeId)).all()
    .map(row => row.id)
  let changed = deleteRows(tx, employeeId, ASSESSMENT_ROWS)
  if (formIds.length > 0) changed += tx.delete(forms).where(inArray(forms.id, formIds)).run().changes
  return changed
}

/**
 * „Ausgezahlte Überstunden, Verträge, Gehalt“ (10 years): the balance adjustments marked „ausgezahlt“, the documents in
 * the folders contract and salary, and the accident reports about the employee (Unfallanzeigen, kept for the longest
 * period as a claim may follow years later; their attachments go along).
 */
const PAID_OVERTIME_ROWS: readonly EmployeeRows[] = [
  { table: balanceAdjustments, column: balanceAdjustments.employeeId, also: eq(balanceAdjustments.paidOut, true) },
  documentsOf('paidOvertime'),
  { table: forms, column: forms.employeeId },
]

/** „Ausgezahlte Überstunden, Verträge, Gehalt“: paid-out balance adjustments, contract and salary documents, accident reports. */
export function deletePaidOvertimeData(tx: Db, employeeId: number): number {
  return deleteRows(tx, employeeId, PAID_OVERTIME_ROWS)
}

/** „BEM-Unterlagen“: the BEM processes with their steps (the steps go with their process). */
const BEM_ROWS: readonly EmployeeRows[] = [{ table: bemProcesses, column: bemProcesses.employeeId }]

/** „Mutterschutz-Unterlagen“: the Mutterschutz cases (the plan's codes go with the time data). */
const MATERNITY_ROWS: readonly EmployeeRows[] = [{ table: maternityCases, column: maternityCases.employeeId }]

/** „Mutterschutz-Unterlagen“: every Mutterschutz case of the employee. */
export function deleteMaternityData(tx: Db, employeeId: number): number {
  return deleteRows(tx, employeeId, MATERNITY_ROWS)
}

/** „BEM-Unterlagen“: every BEM process of the employee with its steps. */
export function deleteBemData(tx: Db, employeeId: number): number {
  return deleteRows(tx, employeeId, BEM_ROWS)
}

/**
 * Whether the employee still has data of the paid-overtime period: balance adjustments marked „ausgezahlt“ or
 * contract and salary documents.
 */
export function hasPaidOvertimeData(db: Db, employeeId: number): boolean {
  return anyRows(db, employeeId, PAID_OVERTIME_ROWS)
}

/**
 * The employees among `employeeIds` with data of the paid-overtime period, from the same row lists as
 * hasPaidOvertimeData: one query per list, however many employees.
 */
export function employeesWithPaidOvertimeData(db: Db, employeeIds: readonly number[]): Set<number> {
  if (employeeIds.length === 0) return new Set()
  return new Set(PAID_OVERTIME_ROWS.flatMap(rows => db.selectDistinct({ id: rows.column }).from(rows.table)
    .where(and(inArray(rows.column, [...employeeIds]), rows.also)).all().map(row => row.id as number)))
}

/**
 * Per category whether its helper would still delete or clear something, from the same row lists (the release
 * snapshots aside: deleteEmployeeRow takes the person out of them anyway). A category without data is no item of the
 * retention overview; the employee row may go once every category says false.
 */
export function categoryHasData(db: Db, employeeId: number): Record<RetentionCategory, boolean> {
  return {
    immediate: db.select({ id: employees.id }).from(employees).where(immediateFieldsSet(employeeId)).get() !== undefined
      || anyRows(db, employeeId, [...IMMEDIATE_ROWS, ...IMMEDIATE_CLEARED, ACCOUNT])
      || db.select({ id: entries.id }).from(entries).where(specialLeaveReasonsOf(employeeId)).limit(1).get() !== undefined,
    payroll: anyRows(db, employeeId, PAYROLL_ROWS),
    time: anyRows(db, employeeId, TIME_ROWS) || warningAckIds(db, employeeId).length > 0,
    assessment: anyRows(db, employeeId, ASSESSMENT_ROWS),
    bem: anyRows(db, employeeId, BEM_ROWS),
    maternity: anyRows(db, employeeId, MATERNITY_ROWS),
    paidOvertime: hasPaidOvertimeData(db, employeeId),
  }
}

const DELETE_CATEGORY: Record<RetentionCategory, (tx: Db, employeeId: number) => number> = {
  immediate: deleteImmediateData, payroll: deletePayrollData, time: deleteTimeData, assessment: deleteAssessmentData, bem: deleteBemData,
  maternity: deleteMaternityData, paidOvertime: deletePaidOvertimeData,
}

/** Runs the given categories in their order; answers the changed rows per category (0 for those not run). */
export function deleteCategories(
  tx: Db, employeeId: number, categories: readonly RetentionCategory[],
): Record<RetentionCategory, number> {
  const counts: Record<RetentionCategory, number> = {
    immediate: 0, payroll: 0, time: 0, assessment: 0, bem: 0, maternity: 0, paidOvertime: 0,
  }
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
