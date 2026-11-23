import { and, asc, eq, gt, gte, inArray, isNull, lte, or } from 'drizzle-orm'
import { isValidIsoDate } from '../../shared/domain/dates'
import {
  IFSG_ANCHORS, earliestReadmission, ifsgDateRule, ifsgDisease, ifsgKinds, type IfsgAnchor, type IfsgDateRule, type IfsgDisease,
  type IfsgKind, type IfsgProof,
} from '../../shared/domain/ifsg'
import { ifsgClusters } from '../../shared/domain/ifsgLocal'
import { can } from '../../shared/domain/permissions'
import { nowInBerlin } from '../../shared/domain/timeRecords'
import type { IsoDate } from '../../shared/domain/types'
import type {
  AttendanceIfsgDto, IfsgCaseDto, IfsgCaseUpdateInput, IfsgDeclarationDto, IfsgNoticeDto, IfsgReadmitInput, IfsgRulesDto,
  IfsgSettingsDto, ReminderDto,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { childDocuments, childIfsgCases, children, documentTypes, facilities, ifsgClusterAcks } from '../db/schema'
import { groupRightOf, type ChildViewer } from '../lib/childViewer'
import { ServiceError } from '../lib/errors'
import { checkedDocumentFile } from '../lib/fileSignature'
import { fillableFile } from '../lib/pdfForm'
import { settleDocumentReview } from './documentReview'
import { listGroups } from './groups'
import { healthOfficeOf, mergedRulesOf } from './ifsgLocal'

// Notifiable diseases of children (§ 34 IfSG): the facility's rules, the cases with their readmission, the block at
// „Kommt“, the Leitung's duty to notify the health office, the overview and the parents' notice. Health data: the
// disease is shown only to Leitung/Träger (children.manage) and to whoever keeps the attendance of the child's group;
// everybody else learns of the block only („Betretungsverbot (§ 34 IfSG)“). Creating a case books the absence as
// well and lives in ifsgCases.ts (the attendance service reads the block from here).

type CaseRow = typeof childIfsgCases.$inferSelect

/** The document type a readmission attest is stored under; created in the facility when it is missing. */
export const IFSG_ATTEST_TYPE = 'Ärztliches Attest'
/** The document type of a parents' declaration (proof parent_declaration). */
export const IFSG_DECLARATION_TYPE = 'Elternerklärung'
/** The title of a stored readmission attest; it never names the disease. */
export const IFSG_ATTEST_TITLE = 'Wiederzulassung (§ 34 IfSG)'

/**
 * The facility's rules for notifiable diseases: the RKI catalogue with the local health office's rules over it, field
 * by field, and its local diseases (ifsgLocal.ts). Every reader of the rules goes through here.
 */
export function ifsgRulesFor(db: Db, facilityId: number): IfsgDisease[] {
  return mergedRulesOf(db, facilityId)
}

/** The facility's setting (404 facility_not_found). */
export function getIfsgSettings(db: Db, facilityId: number): IfsgSettingsDto {
  const row = db.select({
    requireAttest: facilities.ifsgRequireAttest, healthOfficeName: facilities.healthOfficeName, healthOfficePhone: facilities.healthOfficePhone,
  }).from(facilities).where(eq(facilities.id, facilityId)).get()
  if (!row) throw new ServiceError(404, 'facility_not_found')
  return row
}

/** Stores the setting; the health office's name and phone are trimmed. */
export function setIfsgSettings(db: Db, facilityId: number, input: IfsgSettingsDto): void {
  getIfsgSettings(db, facilityId)
  db.update(facilities).set({
    ifsgRequireAttest: input.requireAttest, healthOfficeName: input.healthOfficeName.trim(), healthOfficePhone: input.healthOfficePhone.trim(),
  }).where(eq(facilities.id, facilityId)).run()
}

/** The rules for the dialogs, with the facility's attest setting and its health office. */
export function ifsgRules(db: Db, viewer: ChildViewer): IfsgRulesDto {
  return {
    requireAttest: getIfsgSettings(db, viewer.facilityId).requireAttest, diseases: ifsgRulesFor(db, viewer.facilityId),
    healthOffice: healthOfficeOf(db, viewer.facilityId),
  }
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
  return earliestReadmission(caseRule(rules, row), row.onsetDate, row.ruleDate)
}

/**
 * The case's date rule: the snapshot taken when it was chosen (later changes of the facility's rules do not move the
 * earliest day); a case without a snapshot (entered before it existed) resolves its key in today's rules.
 */
function caseRule(rules: IfsgDisease[], row: CaseRow): IfsgDateRule | null {
  if (row.ruleVariant === null) return null
  if (row.ruleAnchor !== null && row.ruleDays !== null && (IFSG_ANCHORS as readonly string[]).includes(row.ruleAnchor)) {
    return { key: row.ruleVariant, anchor: row.ruleAnchor as IfsgAnchor, days: row.ruleDays, label: row.ruleLabel, condition: row.ruleCondition }
  }
  const disease = ifsgDisease(rules, row.disease)
  return disease ? ifsgDateRule(disease, row.kind, row.ruleVariant) : null
}

/** The case's date rule for the client (its snapshot, or the resolved rule of an older case). */
const ruleDto = (rule: IfsgDateRule | null) =>
  (rule === null ? null : { anchor: rule.anchor, days: rule.days, label: rule.label, condition: rule.condition })

/** The snapshot columns of a chosen date rule (all empty without one). */
export function ruleSnapshot(rule: IfsgDateRule | null) {
  return rule === null
    ? { ruleAnchor: null, ruleDays: null, ruleLabel: '', ruleCondition: '' }
    : { ruleAnchor: rule.anchor, ruleDays: rule.days, ruleLabel: rule.label, ruleCondition: rule.condition }
}

/** The Leitung still has to notify the health office: a notifiable disease, neither notified nor reported by the physician, not closed. */
function notifyDue(rules: IfsgDisease[], row: CaseRow): boolean {
  const disease = ifsgDisease(rules, row.disease)
  return (disease?.notify ?? true) && row.healthOfficeNotifiedOn === null && !row.physicianReported && !row.ended
}

/** The child's open cases entered on the date or before, the oldest first. */
/**
 * The cases of the date's ban period: entered on that day or before, not closed by the Leitung, and not readmitted
 * on or before it (a back-dated „Kommt“ inside a ban that is over by now counts as well).
 */
const inBanOn = (date: IsoDate) => and(lte(childIfsgCases.reportedOn, date),
  or(isNull(childIfsgCases.readmittedOn), gt(childIfsgCases.readmittedOn, date)), eq(childIfsgCases.ended, false))

/** The child's cases in their ban period on the date, the oldest first. */
function openCasesOn(db: Db, childId: number, date: IsoDate): CaseRow[] {
  return db.select().from(childIfsgCases).where(and(eq(childIfsgCases.childId, childId), inBanOn(date)))
    .orderBy(asc(childIfsgCases.reportedOn), asc(childIfsgCases.id)).all()
}

/** § 34 forbids the visit: every RKI disease and a notifiable local one (an unknown key counts as binding). */
const isBinding = (rules: IfsgDisease[], row: CaseRow) => ifsgDisease(rules, row.disease)?.binding ?? true

/**
 * The open case that blocks „Kommt“ on the date: entered on that day or before, neither readmitted nor closed, of a
 * binding disease (a local recommendation does not block); the oldest of several. Days before the case was entered
 * stay open for corrections.
 */
export function blockingIfsgCase(db: Db, facilityId: number, childId: number, date: IsoDate): CaseRow | undefined {
  const rules = ifsgRulesFor(db, facilityId)
  return openCasesOn(db, childId, date).find(row => isBinding(rules, row))
}

/**
 * „Kommt“ ends the open cases of local recommendations (no § 34 ban): they count as readmitted on that day by whoever
 * stamped the child in. Runs in the transaction of the stamping.
 */
export function closeRecommendationCases(db: Db, viewer: ChildViewer, childId: number, date: IsoDate): void {
  const rules = ifsgRulesFor(db, viewer.facilityId)
  for (const row of openCasesOn(db, childId, date).filter(entry => !isBinding(rules, entry) && entry.readmittedOn === null)) {
    db.update(childIfsgCases).set({ readmittedOn: date, readmittedByName: viewer.name }).where(eq(childIfsgCases.id, row.id)).run()
  }
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
  const cases = db.select().from(childIfsgCases).where(and(inArray(childIfsgCases.childId, ids), inBanOn(date)))
    .orderBy(asc(childIfsgCases.reportedOn), asc(childIfsgCases.id)).all()
  if (cases.length === 0) return result
  const rules = ifsgRulesFor(db, viewer.facilityId)
  const requireAttest = getIfsgSettings(db, viewer.facilityId).requireAttest
  const healthOffice = healthOfficeOf(db, viewer.facilityId)
  // A binding case shows before a recommendation of the same child.
  cases.sort((a, b) => Number(isBinding(rules, b)) - Number(isBinding(rules, a)))
  const groupOf = new Map(rows.map(row => [row.id, row.groupId]))
  for (const row of cases) {
    if (result.has(row.childId)) continue
    const sees = seesIfsgDisease(viewer, groupOf.get(row.childId) ?? null)
    const disease = ifsgDisease(rules, row.disease)
    const kindRule = disease?.kinds[row.kind]
    const rule = caseRule(rules, row)
    result.set(row.childId, sees
      ? {
          caseId: row.id, disease: row.disease, diseaseName: disease?.name ?? row.disease, kind: row.kind,
          text: kindRule?.text ?? '', condition: rule?.condition ?? '', earliest: earliestOf(rules, row),
          proof: kindRule?.proof ?? 'medical_certificate', canReadmit: isOpen(row), requireAttest, binding: isBinding(rules, row),
          source: kindRule?.source ?? 'rki', healthOffice, reportedOn: row.reportedOn, onsetDate: row.onsetDate,
          ruleVariant: row.ruleVariant, rule: ruleDto(rule), ruleDate: row.ruleDate, readmittedOn: row.readmittedOn,
        }
      : {
          caseId: row.id, disease: null, diseaseName: null, kind: null, text: null, condition: null, earliest: null, proof: null,
          canReadmit: false, requireAttest, binding: isBinding(rules, row), source: null, healthOffice, reportedOn: null, onsetDate: null,
          ruleVariant: null, rule: null, ruleDate: null, readmittedOn: null,
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
 * Changes a case (left out = kept). The onset, the date rule and its date: Leitung/Träger and the child's own group;
 * a new date rule is checked against today's rules and stored as a new snapshot, a rule left out stays as it was (also
 * when the facility's rules changed since). The health office's notification (a day or null), the physician's report
 * and closing the case without readmission: Leitung/Träger only (403 forbidden).
 */
export function updateIfsgCase(db: Db, viewer: ChildViewer, id: number, input: IfsgCaseUpdateInput): void {
  const row = loadOwnCase(db, viewer, id)
  const managing = input.healthOfficeNotifiedOn !== undefined || input.physicianReported !== undefined || input.ended !== undefined
  if (managing && !can(viewer.permissions, 'children.manage')) throw new ServiceError(403, 'forbidden')
  const next = {
    onsetDate: input.onsetDate ?? row.onsetDate,
    ruleDate: input.ruleDate === undefined ? row.ruleDate : input.ruleDate,
    healthOfficeNotifiedOn: input.healthOfficeNotifiedOn === undefined ? row.healthOfficeNotifiedOn : input.healthOfficeNotifiedOn,
    physicianReported: input.physicianReported ?? row.physicianReported,
    ended: input.ended ?? row.ended,
  }
  if ([next.onsetDate, next.ruleDate, next.healthOfficeNotifiedOn].some(date => date !== null && !isValidIsoDate(date))) {
    throw new ServiceError(400, 'invalid_date')
  }
  if (next.onsetDate > row.reportedOn) throw new ServiceError(400, 'invalid_date')
  let rule = {}
  if (input.ruleVariant !== undefined) {
    const disease = checkedCaseRule(ifsgRulesFor(db, viewer.facilityId), row.disease, row.kind, input.ruleVariant, [])
    rule = { ruleVariant: input.ruleVariant, ...ruleSnapshot(input.ruleVariant === null ? null : ifsgDateRule(disease, row.kind, input.ruleVariant)) }
  }
  db.update(childIfsgCases).set({ ...next, ...rule }).where(eq(childIfsgCases.id, id)).run()
}

/** Deletes a case entered by mistake (Leitung/Träger; the route checks children.manage). Its stored attest stays a document. */
export function deleteIfsgCase(db: Db, viewer: ChildViewer, id: number): void {
  loadCase(db, viewer.facilityId, id)
  db.delete(childIfsgCases).where(eq(childIfsgCases.id, id)).run()
}

/**
 * The facility's document type for the readmission's proof, created (confidential by default) when missing: „Elternerklärung“
 * for a parents' declaration, „Ärztliches Attest“ for everything else.
 */
function proofDocumentType(db: Db, facilityId: number, proof: IfsgProof): number {
  const name = proof === 'parent_declaration' ? IFSG_DECLARATION_TYPE : IFSG_ATTEST_TYPE
  const existing = db.select({ id: documentTypes.id, name: documentTypes.name }).from(documentTypes)
    .where(eq(documentTypes.facilityId, facilityId)).all()
    .find(type => type.name.localeCompare(name, 'de', { sensitivity: 'accent' }) === 0)
  if (existing) return existing.id
  return db.insert(documentTypes).values({ facilityId, name, confidentialDefault: true })
    .returning({ id: documentTypes.id }).get().id
}

/**
 * „Ärztliche Wiederzulassung liegt vor“: closes an open case (409 ifsg_case_closed otherwise) so the child can be
 * stamped in again. Leitung/Träger and the child's own group (403 group_read_only). The day is a real day, not ahead
 * and not before the onset (400 invalid_date). A day before the earliest readmission of the date rule needs
 * `confirmEarly` (409 ifsg_before_earliest with the earliest day). A medical judgement needs a written attest when the
 * facility asks for one (400 ifsg_attest_required); a readmission after consulting the health office needs a note who
 * was consulted and when (400 ifsg_note_required). A given file (PDF/JPG/PNG, like every document) is stored as a
 * confidential child document of the type „Ärztliches Attest“ (a parents' declaration: „Elternerklärung“; created when
 * missing), titled without the disease. The proof follows the facility's merged rules.
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
  if (proof === 'health_office' && input.note.trim() === '') throw new ServiceError(400, 'ifsg_note_required')
  const mimeType = file === null ? null : checkedDocumentFile(file.data)
  db.transaction((tx) => {
    let attachmentId: number | null = null
    if (file !== null && mimeType !== null) {
      attachmentId = tx.insert(childDocuments).values({
        childId: row.childId, documentTypeId: proofDocumentType(tx, viewer.facilityId, proof), title: IFSG_ATTEST_TITLE,
        documentDate: input.readmittedOn, confidential: true, mimeType, fillable: fillableFile(file.data, mimeType), size: file.data.length, data: file.data,
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
      open: isOpen(row), notifyDue: notifyDue(rules, row), rule: ruleDto(caseRule(rules, row)),
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
  const healthOffice = healthOfficeOf(db, viewer.facilityId)
  return toDtos(db, viewer.facilityId, rows).map(item => ({
    kind: 'ifsg' as const, date: item.reportedOn, state: item.reportedOn < today ? 'overdue' as const : 'today' as const,
    name: item.childName, childId: item.childId, age: null, ownChild: false, canDone: false, time: null, meetingKind: null,
    count: null, ifsg: { caseId: item.id, diseaseName: item.diseaseName, groupName: item.groupName, healthOffice },
  }))
}

/** The last case day each disease's acknowledged cluster covered. */
function acknowledgedUpTo(db: Db, facilityId: number): Map<string, IsoDate> {
  const result = new Map<string, IsoDate>()
  for (const ack of db.select({ disease: ifsgClusterAcks.disease, upTo: ifsgClusterAcks.upTo }).from(ifsgClusterAcks)
    .where(eq(ifsgClusterAcks.facilityId, facilityId)).all()) {
    if ((result.get(ack.disease) ?? '') < ack.upTo) result.set(ack.disease, ack.upTo)
  }
  return result
}

/**
 * The facility's clusters still to report: the cases of children who are ill or suspected (§ 34 Abs. 6 Satz 2 speaks of
 * „gleichartige Erkrankungen“; carriers and household contacts do not count), of every disease, local ones included.
 */
function openClusters(db: Db, facilityId: number) {
  const cases = db.select({ disease: childIfsgCases.disease, childId: childIfsgCases.childId, reportedOn: childIfsgCases.reportedOn })
    .from(childIfsgCases).innerJoin(children, eq(children.id, childIfsgCases.childId))
    .where(and(eq(childIfsgCases.facilityId, facilityId), eq(children.facilityId, facilityId), eq(childIfsgCases.kind, 'sick'))).all()
  return ifsgClusters(cases, acknowledgedUpTo(db, facilityId))
}

/**
 * Leitung and Träger (at the office): a cluster – two or more children of the facility with the same disease within
 * 14 days (§ 34 Abs. 6 Satz 2) – until the Leitung acknowledges that the health office was informed; overdue from the
 * day after its last case.
 */
export function ifsgClusterReminders(db: Db, viewer: ChildViewer, today: IsoDate): ReminderDto[] {
  if (!can(viewer.permissions, 'children.manage') || viewer.onTablet) return []
  const rules = ifsgRulesFor(db, viewer.facilityId)
  return openClusters(db, viewer.facilityId).map((cluster) => {
    const diseaseName = ifsgDisease(rules, cluster.disease)?.name ?? cluster.disease
    return {
      kind: 'ifsgCluster' as const, date: cluster.to, state: cluster.to < today ? 'overdue' as const : 'today' as const,
      name: diseaseName, childId: null, age: null, ownChild: false, canDone: false, time: null, meetingKind: null, count: cluster.count,
      ifsgCluster: { disease: cluster.disease, diseaseName, count: cluster.count, from: cluster.from, to: cluster.to },
    }
  })
}

/**
 * The Leitung informed the health office of the disease's cluster on `acknowledgedOn` (a day, not ahead: 400
 * invalid_date); it covers the cases up to the cluster's last day. Without an open cluster: 404 ifsg_cluster_not_found.
 */
export function acknowledgeIfsgCluster(db: Db, viewer: ChildViewer, disease: string, acknowledgedOn: IsoDate, now: Date = new Date()): void {
  if (!isValidIsoDate(acknowledgedOn) || acknowledgedOn > nowInBerlin(now).date) throw new ServiceError(400, 'invalid_date')
  const cluster = openClusters(db, viewer.facilityId).find(entry => entry.disease === disease)
  if (!cluster) throw new ServiceError(404, 'ifsg_cluster_not_found')
  db.insert(ifsgClusterAcks).values({
    facilityId: viewer.facilityId, disease, upTo: cluster.to, acknowledgedOn, acknowledgedByName: viewer.name, createdAt: now.toISOString(),
  }).run()
}

/**
 * The parents' declaration of a case to print (Leitung/Träger and the child's own group, 403 group_read_only): the
 * child's name, the disease and the facility.
 */
export function ifsgDeclaration(db: Db, viewer: ChildViewer, id: number): IfsgDeclarationDto {
  const row = loadOwnCase(db, viewer, id)
  const child = db.select({ firstName: children.firstName, lastName: children.lastName }).from(children).where(eq(children.id, row.childId)).get()
  const facility = db.select({ name: facilities.name }).from(facilities).where(eq(facilities.id, viewer.facilityId)).get()
  return {
    caseId: row.id, facilityName: facility?.name ?? '', childName: child ? `${child.firstName} ${child.lastName}`.trim() : '',
    diseaseName: ifsgDisease(ifsgRulesFor(db, viewer.facilityId), row.disease)?.name ?? row.disease,
    // Head lice: the parents confirm the treatment themselves (no physician's lines).
    form: row.disease === 'kopflaus' ? 'lice' : 'declaration',
  }
}
