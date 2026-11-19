import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm'
import { isValidIsoDate } from '../../shared/domain/dates'
import {
  IFSG_CATALOGUE, earliestReadmission, ifsgDateRule, ifsgDisease, ifsgKinds, type IfsgDisease, type IfsgKind,
} from '../../shared/domain/ifsg'
import { can } from '../../shared/domain/permissions'
import { nowInBerlin } from '../../shared/domain/timeRecords'
import type { IsoDate } from '../../shared/domain/types'
import type {
  AttendanceIfsgDto, IfsgCaseDto, IfsgCaseUpdateInput, IfsgNoticeDto, IfsgReadmitInput, IfsgRulesDto, IfsgSettingsDto,
  ReminderDto,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { childDocuments, childIfsgCases, children, documentTypes, facilities } from '../db/schema'
import { groupRightOf, type ChildViewer } from '../lib/childViewer'
import { ServiceError } from '../lib/errors'
import { checkedDocumentFile } from '../lib/fileSignature'
import { settleDocumentReview } from './documentReview'
import { listGroups } from './groups'

// Notifiable diseases of children (§ 34 IfSG): the facility's rules, the cases with their readmission, the block at
// „Kommt“, the Leitung's duty to notify the health office, the overview and the parents' notice. Health data: the
// disease is shown only to Leitung/Träger (children.manage) and to whoever keeps the attendance of the child's group;
// everybody else learns of the block only („Betretungsverbot (§ 34 IfSG)“). Creating a case books the absence as
// well and lives in ifsgCases.ts (the attendance service reads the block from here).

type CaseRow = typeof childIfsgCases.$inferSelect

/** The document type a readmission attest is stored under; created in the facility when it is missing. */
export const IFSG_ATTEST_TYPE = 'Ärztliches Attest'
/** The title of a stored readmission attest; it never names the disease. */
export const IFSG_ATTEST_TITLE = 'Wiederzulassung (§ 34 IfSG)'

/**
 * The facility's rules for notifiable diseases: today the RKI catalogue. Every reader of the rules goes through here,
 * so local rules of the health office can later take precedence.
 */
export function ifsgRulesFor(_db: Db, _facilityId: number): IfsgDisease[] {
  return [...IFSG_CATALOGUE]
}

/** The facility's setting (404 facility_not_found). */
export function getIfsgSettings(db: Db, facilityId: number): IfsgSettingsDto {
  const row = db.select({ requireAttest: facilities.ifsgRequireAttest }).from(facilities).where(eq(facilities.id, facilityId)).get()
  if (!row) throw new ServiceError(404, 'facility_not_found')
  return row
}

export function setIfsgSettings(db: Db, facilityId: number, input: IfsgSettingsDto): void {
  getIfsgSettings(db, facilityId)
  db.update(facilities).set({ ifsgRequireAttest: input.requireAttest }).where(eq(facilities.id, facilityId)).run()
}

/** The rules for the dialogs, with the facility's attest setting. */
export function ifsgRules(db: Db, viewer: ChildViewer): IfsgRulesDto {
  return { requireAttest: getIfsgSettings(db, viewer.facilityId).requireAttest, diseases: ifsgRulesFor(db, viewer.facilityId) }
}

/** Whether the viewer may know a case's disease and act on it: Leitung/Träger, or the attendance of the child's group. */
export function seesIfsgDisease(viewer: ChildViewer, groupId: number | null): boolean {
  if (can(viewer.permissions, 'children.manage')) return true
  return can(viewer.permissions, 'children.attendance') && groupRightOf(viewer, groupId, 'children.attendance') === 'write'
}

/** Not readmitted and not closed. */
const isOpen = (row: CaseRow) => row.readmittedOn === null && !row.ended

/** The case's earliest readmission under the facility's rules (null: no rule chosen, its date unknown, rule gone). */
function earliestOf(rules: IfsgDisease[], row: CaseRow): IsoDate | null {
  const disease = ifsgDisease(rules, row.disease)
  const rule = disease && row.ruleVariant !== null ? ifsgDateRule(disease, row.kind, row.ruleVariant) : null
  return earliestReadmission(rule, row.onsetDate, row.ruleDate)
}

/** The Leitung still has to notify the health office: a notifiable disease, neither notified nor reported by the physician, not closed. */
function notifyDue(rules: IfsgDisease[], row: CaseRow): boolean {
  const disease = ifsgDisease(rules, row.disease)
  return (disease?.notify ?? true) && row.healthOfficeNotifiedOn === null && !row.physicianReported && !row.ended
}

/**
 * The open case that blocks „Kommt“ on the date: entered on that day or before, neither readmitted nor closed; the
 * oldest of several. Days before the case was entered stay open for corrections.
 */
export function blockingIfsgCase(db: Db, childId: number, date: IsoDate): CaseRow | undefined {
  return db.select().from(childIfsgCases)
    .where(and(eq(childIfsgCases.childId, childId), lte(childIfsgCases.reportedOn, date), isNull(childIfsgCases.readmittedOn),
      eq(childIfsgCases.ended, false)))
    .orderBy(asc(childIfsgCases.reportedOn), asc(childIfsgCases.id)).get()
}

/**
 * The open cases of the day list's children, by child: everything for whoever may know the disease (see
 * `seesIfsgDisease`, judged by the child's current group), only the block for everybody else.
 */
export function attendanceIfsg(
  db: Db, viewer: ChildViewer, rows: { id: number; groupId: number | null }[], date: IsoDate,
): Map<number, AttendanceIfsgDto> {
  const result = new Map<number, AttendanceIfsgDto>()
  const ids = rows.map(row => row.id)
  if (ids.length === 0) return result
  const cases = db.select().from(childIfsgCases)
    .where(and(inArray(childIfsgCases.childId, ids), lte(childIfsgCases.reportedOn, date), isNull(childIfsgCases.readmittedOn),
      eq(childIfsgCases.ended, false)))
    .orderBy(asc(childIfsgCases.reportedOn), asc(childIfsgCases.id)).all()
  if (cases.length === 0) return result
  const rules = ifsgRulesFor(db, viewer.facilityId)
  const requireAttest = getIfsgSettings(db, viewer.facilityId).requireAttest
  const groupOf = new Map(rows.map(row => [row.id, row.groupId]))
  for (const row of cases) {
    if (result.has(row.childId)) continue
    const sees = seesIfsgDisease(viewer, groupOf.get(row.childId) ?? null)
    const disease = ifsgDisease(rules, row.disease)
    const kindRule = disease?.kinds[row.kind]
    const rule = disease && row.ruleVariant !== null ? ifsgDateRule(disease, row.kind, row.ruleVariant) : null
    result.set(row.childId, sees
      ? {
          caseId: row.id, disease: row.disease, diseaseName: disease?.name ?? row.disease, kind: row.kind,
          text: kindRule?.text ?? '', condition: rule?.condition ?? '', earliest: earliestOf(rules, row),
          proof: kindRule?.proof ?? 'medical_certificate', canReadmit: true, requireAttest,
        }
      : {
          caseId: row.id, disease: null, diseaseName: null, kind: null, text: null, condition: null, earliest: null, proof: null,
          canReadmit: false, requireAttest,
        })
  }
  return result
}

/** The disease, the kind it allows and the chosen date rule, checked against the facility's rules (400 otherwise). */
export function checkedCaseRule(
  rules: IfsgDisease[], diseaseKey: string, kind: IfsgKind, variant: string | null, dates: (IsoDate | null)[],
): IfsgDisease {
  const disease = ifsgDisease(rules, diseaseKey)
  if (!disease) throw new ServiceError(400, 'ifsg_disease_unknown')
  if (!ifsgKinds(disease).includes(kind)) throw new ServiceError(400, 'ifsg_kind_invalid')
  if (variant !== null && !ifsgDateRule(disease, kind, variant)) throw new ServiceError(400, 'ifsg_rule_invalid')
  if (dates.some(date => date !== null && !isValidIsoDate(date))) throw new ServiceError(400, 'invalid_date')
  return disease
}

/** The facility's case (404 ifsg_case_not_found otherwise) with the child's current group. */
function loadCase(db: Db, facilityId: number, id: number): { row: CaseRow; groupId: number | null } {
  const found = db.select({ row: childIfsgCases, groupId: children.groupId }).from(childIfsgCases)
    .innerJoin(children, eq(children.id, childIfsgCases.childId))
    .where(and(eq(childIfsgCases.id, id), eq(childIfsgCases.facilityId, facilityId), eq(children.facilityId, facilityId))).get()
  if (!found) throw new ServiceError(404, 'ifsg_case_not_found')
  return found
}

/** A case the viewer acts on: one whose disease they may know (403 group_read_only for another group's child). */
function loadOwnCase(db: Db, viewer: ChildViewer, id: number): CaseRow {
  const { row, groupId } = loadCase(db, viewer.facilityId, id)
  if (!seesIfsgDisease(viewer, groupId)) throw new ServiceError(403, 'group_read_only')
  return row
}

/**
 * Changes a case (left out = kept). The onset, the date rule and its date: Leitung/Träger and the child's own group,
 * checked like a new case. The health office's notification (a day or null), the physician's report and closing the
 * case without readmission: Leitung/Träger only (403 forbidden).
 */
export function updateIfsgCase(db: Db, viewer: ChildViewer, id: number, input: IfsgCaseUpdateInput): void {
  const row = loadOwnCase(db, viewer, id)
  const managing = input.healthOfficeNotifiedOn !== undefined || input.physicianReported !== undefined || input.ended !== undefined
  if (managing && !can(viewer.permissions, 'children.manage')) throw new ServiceError(403, 'forbidden')
  const next = {
    onsetDate: input.onsetDate ?? row.onsetDate,
    ruleVariant: input.ruleVariant === undefined ? row.ruleVariant : input.ruleVariant,
    ruleDate: input.ruleDate === undefined ? row.ruleDate : input.ruleDate,
    healthOfficeNotifiedOn: input.healthOfficeNotifiedOn === undefined ? row.healthOfficeNotifiedOn : input.healthOfficeNotifiedOn,
    physicianReported: input.physicianReported ?? row.physicianReported,
    ended: input.ended ?? row.ended,
  }
  checkedCaseRule(ifsgRulesFor(db, viewer.facilityId), row.disease, row.kind, next.ruleVariant,
    [next.onsetDate, next.ruleDate, next.healthOfficeNotifiedOn])
  db.update(childIfsgCases).set(next).where(eq(childIfsgCases.id, id)).run()
}

/** Deletes a case entered by mistake (Leitung/Träger; the route checks children.manage). Its stored attest stays a document. */
export function deleteIfsgCase(db: Db, viewer: ChildViewer, id: number): void {
  loadCase(db, viewer.facilityId, id)
  db.delete(childIfsgCases).where(eq(childIfsgCases.id, id)).run()
}

/** The facility's document type for attests, created (important, confidential by default) when missing. */
function attestType(db: Db, facilityId: number): number {
  const existing = db.select({ id: documentTypes.id, name: documentTypes.name }).from(documentTypes)
    .where(eq(documentTypes.facilityId, facilityId)).all()
    .find(type => type.name.localeCompare(IFSG_ATTEST_TYPE, 'de', { sensitivity: 'accent' }) === 0)
  if (existing) return existing.id
  return db.insert(documentTypes).values({ facilityId, name: IFSG_ATTEST_TYPE, confidentialDefault: true })
    .returning({ id: documentTypes.id }).get().id
}

/**
 * „Ärztliche Wiederzulassung liegt vor“: closes an open case (409 ifsg_case_closed otherwise) so the child can be
 * stamped in again. Leitung/Träger and the child's own group (403 group_read_only). The day is a real day, not ahead
 * and not before the onset (400 invalid_date). A day before the earliest readmission of the date rule needs
 * `confirmEarly` (409 ifsg_before_earliest with the earliest day). A medical judgement needs a written attest when the
 * facility asks for one (400 ifsg_attest_required); a given file (PDF/JPG/PNG, like every document) is stored as a
 * confidential child document of the type „Ärztliches Attest“ (created when missing), titled without the disease.
 */
export function readmitIfsgCase(
  db: Db, viewer: ChildViewer, id: number, input: IfsgReadmitInput, file: { data: Buffer } | null, now: Date = new Date(),
): void {
  const row = loadOwnCase(db, viewer, id)
  if (!isOpen(row)) throw new ServiceError(409, 'ifsg_case_closed')
  const today = nowInBerlin(now).date
  if (!isValidIsoDate(input.readmittedOn) || input.readmittedOn > today || input.readmittedOn < row.onsetDate) {
    throw new ServiceError(400, 'invalid_date')
  }
  const rules = ifsgRulesFor(db, viewer.facilityId)
  const earliest = earliestOf(rules, row)
  if (earliest !== null && input.readmittedOn < earliest && !input.confirmEarly) {
    throw new ServiceError(409, 'ifsg_before_earliest', { earliest })
  }
  const proof = ifsgDisease(rules, row.disease)?.kinds[row.kind]?.proof ?? 'medical_certificate'
  if (file === null && proof === 'medical_certificate' && getIfsgSettings(db, viewer.facilityId).requireAttest) {
    throw new ServiceError(400, 'ifsg_attest_required')
  }
  const mimeType = file === null ? null : checkedDocumentFile(file.data)
  db.transaction((tx) => {
    let attachmentId: number | null = null
    if (file !== null && mimeType !== null) {
      attachmentId = tx.insert(childDocuments).values({
        childId: row.childId, documentTypeId: attestType(tx, viewer.facilityId), title: IFSG_ATTEST_TITLE,
        documentDate: input.readmittedOn, confidential: true, mimeType, size: file.data.length, data: file.data,
        uploadedBy: viewer.id, uploadedAt: now.toISOString(),
      }).returning({ id: childDocuments.id }).get().id
      settleDocumentReview(tx, row.childId)
    }
    tx.update(childIfsgCases).set({
      readmittedOn: input.readmittedOn, readmissionNote: input.note.trim(), readmittedByName: viewer.name,
      readmissionAttachmentId: attachmentId,
    }).where(eq(childIfsgCases.id, id)).run()
  })
}

/** The cases as Leitung and Träger see them, with the child's name and current group. */
function toDtos(db: Db, facilityId: number, rows: { row: CaseRow; child: { firstName: string; lastName: string; groupId: number | null } }[]): IfsgCaseDto[] {
  const rules = ifsgRulesFor(db, facilityId)
  const groupNames = new Map(listGroups(db, facilityId).map(group => [group.id, group.name]))
  return rows.map(({ row, child }) => {
    const disease = ifsgDisease(rules, row.disease)
    return {
      id: row.id, childId: row.childId, childName: `${child.firstName} ${child.lastName}`.trim(),
      groupName: child.groupId === null ? '' : groupNames.get(child.groupId) ?? '',
      disease: row.disease, diseaseName: disease?.name ?? row.disease, kind: row.kind, reportedOn: row.reportedOn,
      onsetDate: row.onsetDate, ruleVariant: row.ruleVariant, ruleDate: row.ruleDate, earliest: earliestOf(rules, row),
      text: disease?.kinds[row.kind]?.text ?? '', proof: disease?.kinds[row.kind]?.proof ?? 'medical_certificate',
      createdByName: row.createdByName, createdAt: row.createdAt, readmittedOn: row.readmittedOn,
      readmissionNote: row.readmissionNote, readmittedByName: row.readmittedByName, attachmentId: row.readmissionAttachmentId,
      healthOfficeNotifiedOn: row.healthOfficeNotifiedOn, physicianReported: row.physicianReported, ended: row.ended,
      open: isOpen(row), notifyDue: notifyDue(rules, row),
    }
  })
}

const CHILD_COLUMNS = { firstName: children.firstName, lastName: children.lastName, groupId: children.groupId }

/** The facility's cases entered in the year (the route checks children.manage), the latest first. */
export function listIfsgCases(db: Db, viewer: ChildViewer, year: number): IfsgCaseDto[] {
  const rows = db.select({ row: childIfsgCases, child: CHILD_COLUMNS }).from(childIfsgCases)
    .innerJoin(children, eq(children.id, childIfsgCases.childId))
    .where(and(eq(childIfsgCases.facilityId, viewer.facilityId), eq(children.facilityId, viewer.facilityId),
      gte(childIfsgCases.reportedOn, `${year}-01-01`), lte(childIfsgCases.reportedOn, `${year}-12-31`)))
    .all()
    .sort((a, b) => b.row.reportedOn.localeCompare(a.row.reportedOn) || b.row.id - a.row.id)
  return toDtos(db, viewer.facilityId, rows)
}

/** One case of the facility (the route checks children.manage). */
export function getIfsgCase(db: Db, viewer: ChildViewer, id: number): IfsgCaseDto {
  loadCase(db, viewer.facilityId, id)
  const found = db.select({ row: childIfsgCases, child: CHILD_COLUMNS }).from(childIfsgCases)
    .innerJoin(children, eq(children.id, childIfsgCases.childId)).where(eq(childIfsgCases.id, id)).get()!
  return toDtos(db, viewer.facilityId, [found])[0]!
}

/** The parents' notice of a case: no names, only the group, the disease and its hint, the facility and the day. */
export function ifsgNotice(db: Db, viewer: ChildViewer, id: number): IfsgNoticeDto {
  const item = getIfsgCase(db, viewer, id)
  const facility = db.select({ name: facilities.name }).from(facilities).where(eq(facilities.id, viewer.facilityId)).get()
  const disease = ifsgDisease(ifsgRulesFor(db, viewer.facilityId), item.disease)
  return {
    caseId: item.id, facilityName: facility?.name ?? '', groupName: item.groupName, diseaseName: item.diseaseName,
    hint: disease?.hint ?? '', reportedOn: item.reportedOn,
  }
}

/**
 * Leitung and Träger (children.manage; at the office, not at the shared tablet): each case whose health office
 * notification is due (§ 34 Abs. 6: „unverzüglich“), overdue from the day after it was entered, until the day of the
 * notification is set or the physician's report is ticked.
 */
export function ifsgReminders(db: Db, viewer: ChildViewer, today: IsoDate): ReminderDto[] {
  if (!can(viewer.permissions, 'children.manage') || viewer.onTablet) return []
  const rules = ifsgRulesFor(db, viewer.facilityId)
  const rows = db.select({ row: childIfsgCases, child: CHILD_COLUMNS }).from(childIfsgCases)
    .innerJoin(children, eq(children.id, childIfsgCases.childId))
    .where(and(eq(childIfsgCases.facilityId, viewer.facilityId), eq(children.facilityId, viewer.facilityId),
      isNull(childIfsgCases.healthOfficeNotifiedOn), eq(childIfsgCases.physicianReported, false), eq(childIfsgCases.ended, false)))
    .all().filter(({ row }) => notifyDue(rules, row))
  return toDtos(db, viewer.facilityId, rows).map(item => ({
    kind: 'ifsg' as const, date: item.reportedOn, state: item.reportedOn < today ? 'overdue' as const : 'today' as const,
    name: item.childName, childId: item.childId, age: null, ownChild: false, canDone: false, time: null, meetingKind: null,
    count: null, ifsg: { caseId: item.id, diseaseName: item.diseaseName, groupName: item.groupName },
  }))
}
