import { eq, sql } from 'drizzle-orm'
import type { Db } from '../../server/db/client'
import {
  balanceAdjustments, bemProcesses, bemSteps, childAttendanceChanges, childDevelopmentDocs, childNotes, childParentMeetings, earlySickLeaves, employeeChildren, employeeDocuments,
  employeeEmergencyConsent, employeeEmergencyConsentLog, employeeEmergencyContacts, employeePayroll, employeeRequirements,
  employeeTrainings, formAttachments, formEditors, forms, groupBookChanges, knowledgeConfirmations, knowledgeEntries, leaveEntitlements, leaveExtraDays, leaveForfeitReceipts, leaveRequests, maternityCases, notifications, offlineStamps, parentalLeaveBirths, parentalLeaves,
  signRequestRecipients, signRequests, teamMeetingParticipants,
  terminalUnlocks, timeDayNotes, timeRecordChanges, timeRecords, warningAcks, weekTemplateEntries, weekTemplates,
} from '../../server/db/schema'
import { applyToCells } from '../../server/services/entries'
import { listTemplates } from '../../server/services/formTemplates'
import { releaseMonth } from '../../server/services/release'
import { createTalk } from '../../server/services/staffTalks'
import { createTeamMeeting, teamMember } from '../../server/services/teamMeetings'
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
 * The same kinds of data for each of `employeeIds` in facility 1 (all of them participants of one team meeting), a row
 * for every column that references employees;
 * October 2026 released, then a draft change of each (change log). `helper` also helped out in `hort` in September,
 * which was released with their column. With `accidents` each also has an accident report about themselves, filled in by
 * themselves (the reports belong to the paid-overtime period, which the retention overview tests count without them).
 */
export function fillEmployeeData(
  db: Db, leitung: SessionUser, employeeIds: number[], helper: number, hort: number, options: { accidents?: boolean } = {},
): void {
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
    db.insert(offlineStamps).values({
      clientId: `offline-${id}`, employeeId: id, action: 'in', stampedAt: '2026-10-07T07:30:00+02:00', date: '2026-10-07', minutes: 450,
      status: 'rejected', reason: 'pin_invalid', receivedAt: now.toISOString(),
    }).run()
    db.insert(earlySickLeaves).values({ employeeId: id, date: '2026-10-07', createdAt: now.toISOString() }).run()
    db.insert(balanceAdjustments).values({ employeeId: id, date: '2026-01-01', minutes: 120, reason: 'Übertrag' }).run()
    db.insert(leaveEntitlements).values({ employeeId: id, year: 2026, days: 30 }).run()
    db.insert(leaveExtraDays).values({ employeeId: id, year: 2026, days: 1, reason: 'Dank für Sommerfest', createdAt: now.toISOString() }).run()
    db.insert(leaveForfeitReceipts).values({ employeeId: id, year: 2025, days: 2, text: 'Du hast noch 2 Tage Urlaub aus 2025.', readAt: now.toISOString() }).run()
    db.insert(leaveRequests).values({ employeeId: id, startDate: '2026-10-12', endDate: '2026-10-13', createdAt: now.toISOString() }).run()
    db.insert(notifications).values({ employeeId: id, year: 2026, month: 10, createdAt: now.toISOString(), changes: '[]' }).run()
    db.insert(employeeRequirements).values({ employeeId: id, typeId: requirementTypeId(db, 'first_aid'), date: '2026-03-01' }).run()
    db.insert(employeeTrainings).values({ employeeId: id, date: '2026-04-01', title: 'Sprachförderung' }).run()
    db.insert(employeeEmergencyContacts).values({ employeeId: id, name: 'Max Muster', relation: 'Ehemann', phone: '0171 1234567' }).run()
    db.insert(employeeEmergencyConsent).values({
      employeeId: id, consent: true, consentAt: now.toISOString(), consentDate: '2026-10-06', consentBy: 'self', source: 'self',
    }).run()
    db.insert(employeeEmergencyConsentLog).values({
      employeeId: id, granted: true, source: 'self', by: 'self', at: now.toISOString(), date: '2026-10-06',
    }).run()
    // A child of the employee (Kinderkrankentage), with a „Kind krank“ day linked to it.
    const ownChild = db.insert(employeeChildren).values({ employeeId: id, firstName: 'Lena', birthDate: '2020-05-04' })
      .returning({ id: employeeChildren.id }).get().id
    applyToCells(db, leitung, 1, [{ employeeId: id, date: '2026-10-09' }], 'replace', {
      kind: 'code', codeId: codeId(db, 'child_sick'), employeeChildId: ownChild,
    })
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
    // A BEM completed in May 2025, with a talk (BEM-Unterlagen: deletable from 04.05.2028 with the default 3 years).
    const bemId = db.insert(bemProcesses).values({
      employeeId: id, status: 'completed', invitedOn: '2025-04-01', answeredOn: '2025-04-08', completedOn: '2025-05-04',
      createdBy: 'Lea Leitung', createdAt: now.toISOString(), updatedAt: now.toISOString(),
    }).returning({ id: bemProcesses.id }).get().id
    db.insert(bemSteps).values({
      processId: bemId, kind: 'meeting', date: '2025-04-15', participants: 'Lea Leitung', text: 'Erstgespräch',
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
    }).run()
    // A Mutterschutz case ended on 04.03.2026 (Mutterschutz-Unterlagen: deletable from 04.03.2028 with the default 2 years).
    db.insert(maternityCases).values({
      employeeId: id, notifiedOn: '2025-06-02', expectedBirth: '2026-01-07', createdBy: 'Lea Leitung', createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }).run()
    // An Elternzeit long before the weekly hours (time data; it changes no target of the tests).
    db.insert(parentalLeaves).values({
      employeeId: id, childBirthDate: '2023-12-01', start: '2024-02-01', end: '2024-02-29', createdAt: now.toISOString(), updatedAt: now.toISOString(),
    }).run()
    db.insert(parentalLeaveBirths).values({ employeeId: id, childBirthDate: '2023-12-01', protectionUntil: '2024-01-25', updatedAt: now.toISOString() }).run()
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
    // An accident report about the person, filled in by themselves (Unfallanzeige).
    if (options.accidents) {
      const accidentId = db.insert(forms).values({
        facilityId: 1, kind: 'accident', title: 'Unfallanzeige', content: '{"sections":[]}', createdAt: at, updatedAt: at,
        employeeId: id, createdByEmployeeId: id, formDate: '2026-10-05',
      }).returning({ id: forms.id }).get().id
      db.insert(formAttachments).values({
        formId: accidentId, fileName: 'Foto.png', mimeType: 'image/png', size: 4, data: Buffer.from('%PNG'), uploadedAt: at,
        uploadedByName: 'am Tablet', uploadedByEmployeeId: id,
      }).run()
    }
    const tablet = addUser(db, `tablet-${id}`, 'terminal')
    db.insert(terminalUnlocks).values({ id: `unlock-${id}`, terminalUserId: tablet.id, facilityId: 1, employeeId: id, createdAt: at, lastActiveAt: at }).run()
    // „Gelesen und verstanden“ of an entry of „Wissen“.
    const entryId = db.insert(knowledgeEntries).values({
      facilityId: null, categoryName: 'Kinderschutz', kind: 'link', title: `Konzept ${id}`, url: 'https://example.de', needsConfirmation: true,
      versionAt: at, createdAt: at, updatedAt: at,
    }).returning({ id: knowledgeEntries.id }).get().id
    db.insert(knowledgeConfirmations).values({ entryId, employeeId: id, entryVersion: 1, confirmedAt: at, via: 'tablet' }).run()
    // A request to sign (Zum Unterschreiben senden), signed.
    const signRequestId = db.insert(signRequests).values({
      facilityId: 1, createdAt: at, title: 'Belehrung', sourceKind: 'template', fileData: Buffer.from('%PDF'), fileSize: 4, targetFolder: 'correspondence',
    }).returning({ id: signRequests.id }).get().id
    db.insert(signRequestRecipients).values({ requestId: signRequestId, employeeId: id, status: 'signed', signedAt: at, signedHash: 'abc' }).run()
    db.insert(childDevelopmentDocs).values({ childId, doneOn: '2026-10-01', doneByEmployeeId: id, doneByName: 'am Tablet', createdAt: at }).run()
    db.insert(childParentMeetings).values({
      childId, date: '2026-10-02', start: 600, kind: 'development', createdAt: at, createdByEmployeeId: id, createdByName: 'am Tablet',
    }).run()
    db.insert(childNotes).values({
      childId, date: '2026-10-02', text: 'Notiz', educatorEmployeeId: id, educatorName: 'am Tablet', createdAt: at,
      createdByEmployeeId: id, createdByName: 'am Tablet',
    }).run()
    db.insert(childAttendanceChanges).values({
      childId, date: '2026-10-02', field: 'arrived', before: '', after: '8:00', changedAt: at, changedByEmployeeId: id, changedByName: 'am Tablet',
    }).run()
    db.insert(groupBookChanges).values({
      groupId: group, field: 'day', date: '2026-10-02', before: '', after: 'Wald', changedAt: at, changedByEmployeeId: id, changedByName: 'am Tablet',
    }).run()
  }
  // Everyone took part in a team meeting (stored directly: some may have left already).
  const meetingId = createTeamMeeting(db, teamMember(db, leitung), {
    templateId: listTemplates(db, 1, 'team')[0]!.id, date: '2026-10-01', start: 840, groupId: null, participants: '', recorder: '',
    participantIds: [],
  }, now)
  employeeIds.forEach((employeeId, sortOrder) => {
    db.insert(teamMeetingParticipants).values({ meetingId, employeeId, name: `Teilnehmer ${employeeId}`, sortOrder }).run()
  })
  // October released, then a draft change of each (change log).
  releaseMonth(db, leitung, 1, 2026, 10, new Date('2026-09-25T10:00:00Z'))
  for (const id of employeeIds) shift(leitung, 1, id, '2026-10-07', 'S')
  // The helper helped out in the Hort in September, which was released with their column.
  const hortLeitung = addUser(db, 'hortleitung', 'admin', null, hort)
  addHelpOut(db, helper, hort, 2026, 9)
  shift(hortLeitung, hort, helper, '2026-09-16')
  releaseMonth(db, hortLeitung, hort, 2026, 9, new Date('2026-08-25T10:00:00Z'))
}
