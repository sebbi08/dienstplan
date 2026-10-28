import { eq, sql } from 'drizzle-orm'
import type { Db } from '../../server/db/client'
import {
  balanceAdjustments, childAttendanceChanges, childDevelopmentDocs, childParentMeetings, earlySickLeaves, employeeDocuments,
  employeeEmergencyContacts, employeePayroll, employeeRequirements,
  employeeTrainings, formEditors, forms, groupBookChanges, leaveEntitlements, leaveRequests, notifications, terminalUnlocks,
  timeDayNotes, timeRecordChanges, timeRecords, warningAcks, weekTemplateEntries, weekTemplates,
} from '../../server/db/schema'
import { applyToCells } from '../../server/services/entries'
import { listTemplates } from '../../server/services/formTemplates'
import { releaseMonth } from '../../server/services/release'
import { createTalk } from '../../server/services/staffTalks'
import { setPin } from '../../server/services/terminal'
import type { EmployeeDocumentFolder } from '../../shared/domain/personnel'
import type { SessionUser } from '../../shared/types/api'
import { addChild, addGroup, addHelpOut, addUser, codeId, requirementTypeId, templateId } from './fixtures'

const now = new Date('2026-10-27T09:00:00.000Z')

/** Every column with a foreign key to employees.id, read from the database itself (so new tables are covered). */
export function employeeColumns(db: Db): { table: string; column: string }[] {
  const tables = db.all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`)
  return tables.flatMap(({ name }) => db.all<{ table: string; from: string }>(sql.raw(`PRAGMA foreign_key_list("${name}")`))
    .filter(fk => fk.table === 'employees').map(fk => ({ table: name, column: fk.from })))
}

/** Rows per referencing column (`table.column`) that point at the employee. */
export function employeeReferences(db: Db, employeeId: number): Record<string, number> {
  return Object.fromEntries(employeeColumns(db).map(({ table, column }) => [
    `${table}.${column}`,
    db.get<{ n: number }>(sql.raw(`SELECT count(*) AS n FROM "${table}" WHERE "${column}" = ${employeeId}`))!.n,
  ]))
}

/** A document of `folder` in the employee's personnel file (a tiny PDF). */
export function addEmployeeDocument(db: Db, employeeId: number, folder: EmployeeDocumentFolder, uploadedBy: number | null = null): number {
  return db.insert(employeeDocuments).values({
    employeeId, folder, title: `Dokument ${folder}`, mimeType: 'application/pdf', size: 4, data: Buffer.from('%PDF'), uploadedBy,
    uploadedAt: now.toISOString(),
  }).returning({ id: employeeDocuments.id }).get().id
}

/** The folder of each document of the employee, sorted. */
export function documentFolders(db: Db, employeeId: number): string[] {
  return db.select({ folder: employeeDocuments.folder }).from(employeeDocuments)
    .where(eq(employeeDocuments.employeeId, employeeId)).all().map(row => row.folder).sort()
}

/** The documents of `fillEmployeeData`: one in each folder of the assessment category (3 years). */
export const ASSESSMENT_FOLDERS: EmployeeDocumentFolder[] = ['application', 'correspondence', 'measures', 'qualifications']

/**
 * The same kinds of data for each of `employeeIds` in facility 1, a row for every column that references employees;
 * October 2026 released, then a draft change of each (change log). `helper` also helped out in `hort` in September,
 * which was released with their column.
 */
export function fillEmployeeData(db: Db, leitung: SessionUser, employeeIds: number[], helper: number, hort: number): void {
  const shift = (actor: SessionUser, facilityId: number, employeeId: number, date: string, label = 'F2') =>
    applyToCells(db, actor, facilityId, [{ employeeId, date }], 'replace', { kind: 'shift', templateId: templateId(db, label, facilityId) })
  const group = addGroup(db, 1, 'Bären')
  const weekTemplate = db.insert(weekTemplates).values({ facilityId: 1, name: 'A-Woche', updatedAt: now.toISOString() })
    .returning({ id: weekTemplates.id }).get().id
  for (const id of employeeIds) {
    shift(leitung, 1, id, '2026-10-06')
    shift(leitung, 1, id, '2026-09-15')
    applyToCells(db, leitung, 1, [{ employeeId: id, date: '2026-10-08' }], 'replace', { kind: 'code', codeId: codeId(db, 'sick') })
    db.insert(timeRecords).values({ employeeId: id, date: '2026-10-06', start: 450, end: 945, source: 'terminal', createdAt: now.toISOString() }).run()
    db.insert(timeDayNotes).values({ employeeId: id, date: '2026-10-06', note: 'Arzttermin' }).run()
    db.insert(earlySickLeaves).values({ employeeId: id, date: '2026-10-07', createdAt: now.toISOString() }).run()
    db.insert(balanceAdjustments).values({ employeeId: id, date: '2026-01-01', minutes: 120, reason: 'Übertrag' }).run()
    db.insert(leaveEntitlements).values({ employeeId: id, year: 2026, days: 30 }).run()
    db.insert(leaveRequests).values({ employeeId: id, startDate: '2026-10-12', endDate: '2026-10-13', createdAt: now.toISOString() }).run()
    db.insert(notifications).values({ employeeId: id, year: 2026, month: 10, createdAt: now.toISOString(), changes: '[]' }).run()
    db.insert(employeeRequirements).values({ employeeId: id, typeId: requirementTypeId(db, 'first_aid'), date: '2026-03-01' }).run()
    db.insert(employeeTrainings).values({ employeeId: id, date: '2026-04-01', title: 'Sprachförderung' }).run()
    db.insert(employeeEmergencyContacts).values({ employeeId: id, name: 'Max Muster', relation: 'Ehemann', phone: '0171 1234567' }).run()
    // The personnel file: payroll (immediate) and a document in each folder of the assessment category.
    db.insert(employeePayroll).values({
      employeeId: id, taxId: '86095742719', taxClass: 1, svNumber: '15070649C103', healthInsurer: 'AOK', iban: 'DE89370400440532013000',
      accountHolder: 'Tina Test', denomination: 'rk',
    }).run()
    for (const folder of ASSESSMENT_FOLDERS) addEmployeeDocument(db, id, folder, leitung.id)
    db.insert(warningAcks).values({
      facilityId: 1, key: `missing_entry|2026-10-09|${id}`, date: '2026-10-09', signature: '', acknowledgedAt: now.toISOString(),
    }).run()
    setPin(db, 1, id, '135790')
    const templateIds = listTemplates(db, 1, 'staff').filter(template => template.starterKey !== null).map(template => template.id)
    createTalk(db, leitung, { facilityId: 1, ownEmployeeId: null }, {
      employeeId: id, templateIds, date: '2026-06-01', start: 600, participants: '', period: '',
    }, now)
    const childId = addChild(db, 1, { keyEducatorId: id, firstName: `Kind von ${id}` })
    // The rest of the references: time corrections, a week template row, a form editor grant, a tablet unlock, and the
    // person as the one who entered something in a child's record or a group book.
    const at = now.toISOString()
    db.insert(timeRecordChanges).values({ employeeId: id, date: '2026-10-06', before: '', after: '7:30–15:45', at }).run()
    db.insert(weekTemplateEntries).values({ weekTemplateId: weekTemplate, employeeId: id, weekday: 0, kind: 'shift', start: 450, end: 945 }).run()
    const formId = db.insert(forms).values({
      facilityId: 1, kind: 'child', title: 'Beobachtung', content: '{"sections":[]}', createdAt: at, updatedAt: at, childId,
    }).returning({ id: forms.id }).get().id
    db.insert(formEditors).values({ formId, employeeId: id, grantedAt: at }).run()
    const tablet = addUser(db, `tablet-${id}`, 'terminal')
    db.insert(terminalUnlocks).values({ id: `unlock-${id}`, terminalUserId: tablet.id, facilityId: 1, employeeId: id, createdAt: at, lastActiveAt: at }).run()
    db.insert(childDevelopmentDocs).values({ childId, doneOn: '2026-10-01', doneByEmployeeId: id, doneByName: 'am Tablet', createdAt: at }).run()
    db.insert(childParentMeetings).values({
      childId, date: '2026-10-02', start: 600, kind: 'development', createdAt: at, createdByEmployeeId: id, createdByName: 'am Tablet',
    }).run()
    db.insert(childAttendanceChanges).values({
      childId, date: '2026-10-02', field: 'arrived', before: '', after: '8:00', changedAt: at, changedByEmployeeId: id, changedByName: 'am Tablet',
    }).run()
    db.insert(groupBookChanges).values({
      groupId: group, field: 'day', date: '2026-10-02', before: '', after: 'Wald', changedAt: at, changedByEmployeeId: id, changedByName: 'am Tablet',
    }).run()
  }
  // October released, then a draft change of each (change log).
  releaseMonth(db, leitung, 1, 2026, 10, new Date('2026-09-25T10:00:00Z'))
  for (const id of employeeIds) shift(leitung, 1, id, '2026-10-07', 'S')
  // The helper helped out in the Hort in September, which was released with their column.
  const hortLeitung = addUser(db, 'hortleitung', 'admin', null, hort)
  addHelpOut(db, helper, hort, 2026, 9)
  shift(hortLeitung, hort, helper, '2026-09-16')
  releaseMonth(db, hortLeitung, hort, 2026, 9, new Date('2026-08-25T10:00:00Z'))
}
