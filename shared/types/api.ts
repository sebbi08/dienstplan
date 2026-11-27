import type { BemMeasureStatus, BemStatus, BemStepKind } from '../domain/bem'
import type { EventVisibility } from '../domain/calendarEvents'
import type { CashKind, CashSheetRow, YearMonth } from '../domain/cash'
import type { OverviewColumnRef } from '../domain/childConsents'
import type { AdmissionStatus, ChildStatus } from '../domain/children'
import type { DocumentScope } from '../domain/documentTargets'
import type { EveRule } from '../domain/eveRules'
import type { TemplateChoice } from '../domain/formCategories'
import type { ItemChange } from '../domain/formHistory'
import type { FormAnswers, FormContent, FormKind, FormSubject } from '../domain/forms'
import type { HolidayKey, HolidayRules } from '../domain/holidays'
import type { IfsgAnchor, IfsgDisease, IfsgKind, IfsgProof } from '../domain/ifsg'
import type { IfsgDifference, IfsgLocalDateRule, IfsgLocalRule } from '../domain/ifsgLocal'
import type { KnowledgeConfirmState, KnowledgeKind } from '../domain/knowledge'
import type { LeaveAccount, LeaveRange } from '../domain/leave'
import type { LongAbsenceReason, StoredLongAbsenceReason } from '../domain/longAbsence'
import type { EmploymentBanKind } from '../domain/maternity'
import type { DayMeal } from '../domain/meals'
import type { OfflineStampReason, OfflineTabletStatus } from '../domain/offlineStamps'
import type { DayHours, OpeningHours } from '../domain/openingHours'
import type { LevelShiftHint, ParentalLeaveError, ParentalLeaveHint } from '../domain/parentalLeave'
import type { BundleArea, BundleId, BundleScope, RightsRole } from '../domain/permissionBundles'
import type { PermissionKey } from '../domain/permissions'
import type { EmployeeDocumentFolder } from '../domain/personnel'
import type { DocSettings, ReminderKind } from '../domain/reminders'
import type { InspectionLogAction, RequiredAppliesTo, RequiredDocumentMode, RequiredDocumentState } from '../domain/requiredDocuments'
import type { RequirementState } from '../domain/requirements'
import type { DistrictLegendEntry, DistrictRow } from '../domain/schoolDistricts'
import type { BreakMode, StampChannel } from '../domain/stamping'
import type {
  Confidence, Qualification, QuotaLine, RequirementLine, StaffingMethod, StaffingRuleSet,
} from '../domain/staffing/types'
import type { GermanState } from '../domain/states'
import type { TimeWindow } from '../domain/tablet'
import type { TemplateVisibility } from '../domain/templateCategories'
import type { MarkSummary } from '../domain/timeMarks'
import type { JobKey, StoredPayGroup } from '../domain/tvoed'
import type { CodeKey, CreditMode, DomainEntry, EntryKind, IsoDate, Minutes } from '../domain/types'
import type { ApplicantKind, ApplicantStatus, InfoVisitStatus } from '../domain/visits'
import type { CoverageRule, DayHoursContext, Warning } from '../domain/warnings'

export const COLOR_KEYS = ['neutral', 'gray', 'green', 'yellow', 'blue', 'red', 'violet', 'orange'] as const
export type ColorKey = typeof COLOR_KEYS[number]

/**
 * The colours a group may have (palette keys, shown as light shades). Green, red, lime and blue tones are left out:
 * the year calendar uses them for vacation, sick days, special leave and training (Fortbildung).
 */
export const GROUP_COLORS = ['amber', 'orange', 'rose', 'fuchsia', 'violet', 'brown', 'teal', 'slate'] as const
export type GroupColor = typeof GROUP_COLORS[number]
export const isGroupColor = (value: string): value is GroupColor => (GROUP_COLORS as readonly string[]).includes(value)

/** An answer that may still be open: yes, no or not answered (null). */
export type TriState = boolean | null

/** The account roles: Träger, Leitung, Gruppenleitung, Mitarbeiter and the stamp tablet. */
export type Role = 'provider' | 'admin' | 'group_lead' | 'observer' | 'terminal'
export type ClosureMode = 'vacation' | 'closure_day'
export type NoteField = 'info1' | 'info2'
export type ChangeField = 'entry' | NoteField
export type ApplyMode = 'replace' | 'add' | 'clear'

/**
 * The answer to writing plan cells (POST /api/entries). `skippedAbsent`: „Krank melden“ without the sick days right left
 * days alone that were already „abwesend“ (which ones and why is not told; they look alike in the plan anyway).
 */
export interface ApplyEntriesResultDto {
  skippedAbsent: boolean
}

export interface SessionUser {
  id: number
  username: string
  role: Role
  employeeId: number | null
  mustChangePassword: boolean
  /**
   * The facility the user works in, resolved fresh on every request: Leitung and tablet their own, the Träger the
   * active selection, a Mitarbeiter that of the linked employee (null without one).
   */
  facilityId: number | null
  /**
   * What the account may do (shared/domain/permissions.ts), resolved on the server on every request together with the
   * facility. Never stored in the session cookie (see `SessionPayloadUser`); the browser gets it as an array beside the
   * user in the session answer only (`UserSession.permissions`, server/plugins/sessionCheck.ts).
   */
  permissions: ReadonlySet<PermissionKey>
  /**
   * The scope of every held child key of a scoped bundle ('group' = own group, 'facility'), resolved with `permissions`
   * from the same read of the rights; server only, like the permission set.
   */
  scopes: ReadonlyMap<PermissionKey, BundleScope>
}

/** The session user as the session cookie stores it and the browser gets it: without the permission set and scopes. */
export type SessionPayloadUser = Omit<SessionUser, 'permissions' | 'scopes'>

export interface FacilityDto {
  id: number
  name: string
  /** The state (Bundesland) whose public holidays apply. */
  state: GermanState
  /** Mariä Himmelfahrt is a holiday (effective only in Bavaria). */
  assumptionDay: boolean
  /** Höchstzahl Kinder in der Einrichtung (1–999; null = not set), set by the Träger only. */
  capacity: number | null
}

/** A group (Gruppe) of a facility. */
export interface GroupDto {
  id: number
  name: string
  sortOrder: number
  /** Number of places (null = not set). */
  capacity: number | null
  /** After-school care: a child in this group on its school start stays instead of leaving the day before. */
  forSchoolChildren: boolean
  /** Colour of the group's people in the year calendar and the leave planning (null = none). */
  color: GroupColor | null
  /** Group type (Gruppenart) of the staffing ratio, a key of the state's group types (null = not entered). */
  groupType: string | null
}

/**
 * A group for the child pages with the viewer's right in it: 'write' = own group (or no group access: every group),
 * 'read' = granted group. Groups the viewer may not see are not listed.
 */
export interface ChildGroupDto extends GroupDto { right: 'write' | 'read' }

/** A care type (Betreuungsart) of a facility: a booking time window, times in minutes since midnight. */
export interface CareTypeDto {
  id: number
  name: string
  start: Minutes
  end: Minutes
  sortOrder: number
  /** Care days per week (1–7): the child's weekly hours = (end − start) × days. */
  daysPerWeek: number
}

/** daysPerWeek left out: 5 for a new care type, unchanged on update. */
/** sortOrder is ignored (care types are listed by start, end and name). */
export type CareTypeInput = Omit<CareTypeDto, 'id' | 'daysPerWeek' | 'sortOrder'> & { daysPerWeek?: number, sortOrder?: number }

/** A document type (Dokumentart) of a facility; important/required drive the completeness view. */
export interface DocumentTypeDto {
  id: number
  name: string
  important: boolean
  required: boolean
  /** New documents of this type start out confidential. */
  confidentialDefault: boolean
  sortOrder: number
  /** The type of the care contract (Betreuungsvertrag); at most one type of a facility. */
  careContract: boolean
}

/**
 * `careContract: true` makes the type the facility's care contract type (the flag leaves the type that had it), false
 * takes the flag away; left out = unchanged (a new type does not get it).
 */
/** sortOrder is ignored (document types are listed alphabetically). */
export type DocumentTypeInput = Omit<DocumentTypeDto, 'id' | 'careContract' | 'sortOrder'> & { careContract?: boolean, sortOrder?: number }

/** Master data (Stammdaten) of a child; the dates are optional except the birth date. */
export interface ChildMasterInput {
  lastName: string
  firstName: string
  birthDate: IsoDate
  address: string
  groupId: number | null
  careTypeId: number | null
  entryDate: IsoDate | null
  plannedEntryDate: IsoDate | null
  /** 'waitlist' = Vormerkung: never active, no entry date (400 waitlist_has_entry). */
  admissionStatus: AdmissionStatus
  /** Day of the Vormerkung; stored only for waitlist children (null = today on a new one). */
  waitlistedOn: IsoDate | null
  infoMeetingDate: IsoDate | null
  schoolStartDate: IsoDate | null
  primarySchool: string
  schoolDistrict: string
  /** Bezugserzieher: an employee of the child's facility who has not left; null = nobody. */
  keyEducatorId: number | null
  note: string
  /**
   * „künftige Schule“: a contact of the address book in a category of schools (the facility's or for all facilities);
   * null = none. Left out when saving = the stored one stays (a new child: none).
   */
  futureSchoolContactId?: number | null
}

/** The master data as saved for an existing child. */
export interface ChildMasterUpdateInput extends Omit<ChildMasterInput, 'schoolStartDate'> {
  /** Left out = the stored one stays; only Träger and Leitung may send another one (403 school_start_managers_only). */
  schoolStartDate?: IsoDate | null
  /**
   * The group the form was loaded with. Only a `groupId` other than this one is a direct group change; with the same
   * one the stored group stays as it is, so a form that was open while a planned change was applied does not undo it.
   * The route requires it; left out (services called directly), the stored group is the base.
   */
  baseGroupId?: number | null
}

export interface ChildHealthInput {
  measlesProof: TriState
  measlesProofDate: IsoDate | null
  infectionBriefingDate: IsoDate | null
  allergies: string
}

/**
 * A consent question of the facility (Einwilligungen & Erlaubnisse, Einstellungen → Kinder): the full `text`, the
 * `short` column head of the overview and its free `area`. A hidden one is no longer asked; its answers stay.
 * `builtinKey`: one of the questions that were fixed fields before (shared/domain/childConsents.ts), else null.
 */
export interface ConsentQuestionDto {
  id: number
  text: string
  short: string
  area: string
  sortOrder: number
  hidden: boolean
  builtinKey: string | null
}

/** In the settings: with the number of children who answered it (a question with answers cannot be deleted). */
export interface ConsentQuestionSettingsDto extends ConsentQuestionDto {
  answerCount: number
}

/** A new or changed question; `hidden` left out = shown. */
export interface ConsentQuestionInput {
  text: string
  short: string
  area: string
  hidden?: boolean
}

/** A child's answers by question id: ja (true) or nein (false); a question without entry has keine Angabe. */
export type ConsentAnswers = Record<number, boolean>

/** One answer as saved from the record: null = keine Angabe. */
export interface ConsentAnswerInput {
  questionId: number
  value: TriState
}

/** A tab of the children overview with its columns in order (consent questions of the facility and fixed fields). */
export interface OverviewSheetDto {
  id: number
  name: string
  sortOrder: number
  columns: OverviewColumnRef[]
}

export interface OverviewSheetInput {
  name: string
  columns: OverviewColumnRef[]
}

/** A contact person (Bezugsperson) of a child. */
export interface ChildContactInput {
  name: string
  relation: string
  phoneHome: string
  phoneMobile: string
  phoneWork: string
  isGuardian: boolean
  mayPickUp: boolean
  /** Position in the emergency call order (1 = first); null = not an emergency contact. */
  emergencyRank: number | null
  contactBan: boolean
  contactBanNote: string
  note: string
}

export type ChildContactDto = ChildContactInput & { id: number }

/** The kinds of a parent meeting (Elterngespräch). */
export const MEETING_KINDS = ['development', 'settling_in', 'final', 'other'] as const
export type MeetingKind = typeof MEETING_KINDS[number]

/** A parent meeting as entered: `start` and `end` are minutes of the day; `note` only from Leitung and Träger. */
export interface ParentMeetingInput {
  date: IsoDate
  start: Minutes
  end: Minutes | null
  kind: MeetingKind
  participants: string
  /** Confidential; only Leitung and Träger send it. Left out on a change, the stored note stays. */
  note?: string
}

/** A parent meeting in a child's record. */
export interface ParentMeetingDto {
  id: number
  date: IsoDate
  start: Minutes
  end: Minutes | null
  kind: MeetingKind
  participants: string
  /** Confidential: only Leitung and Träger get the field; for everyone else it is absent. */
  note?: string
  /** It lies ahead: a later day (Berlin), or today with a start later than now. */
  planned: boolean
  createdByName: string
  createdAt: string
  updatedByName: string | null
  updatedAt: string | null
  /** The observation form filled for this meeting (at most one), null = none yet. */
  formId: number | null
}

/** A note in a child's record as entered or changed (the text is trimmed by the server, 1–2000 characters). */
export interface ChildNoteInput {
  date: IsoDate
  text: string
  /**
   * The educator (an active employee of the facility); null = none; 'keep' (on a change only) = the stored educator as
   * it is, with the saved name: for a note whose educator was deleted, so a change of the text keeps the name.
   */
  educatorEmployeeId: number | 'keep' | null
}

/** A note in a child's record (section „Notizen“). */
export interface ChildNoteDto {
  id: number
  date: IsoDate
  text: string
  educatorEmployeeId: number | null
  /** The educator's name: the employee's current one, the name saved with the note once the employee is deleted. */
  educatorName: string
  createdByName: string
  createdAt: string
  updatedByName: string | null
  updatedAt: string | null
  /**
   * Whether the viewer may change and delete it: its author, Leitung and Träger, where they write notes (as the
   * attendance: not in a group they only read, not in an archived record).
   */
  canEdit: boolean
}

/** Who changed a section of the record last and when (ISO timestamp); both null while untouched. */
export interface SectionStamp {
  updatedAt: string | null
  updatedBy: string | null
}

export interface ChildListItemDto {
  id: number
  lastName: string
  firstName: string
  birthDate: IsoDate
  age: { years: number; months: number }
  groupId: number | null
  careTypeName: string | null
  keyEducatorId: number | null
  keyEducatorName: string | null
  entryDate: IsoDate | null
  plannedEntryDate: IsoDate | null
  hasAllergies: boolean
  contactBans: { name: string; note: string }[]
}

/** A child on the waitlist or with a contract that has not started yet. */
export interface PlannedChildDto {
  id: number
  lastName: string
  firstName: string
  birthDate: IsoDate
  /** Entry date, else planned entry date. */
  plannedStart: IsoDate | null
  groupId: number | null
  careTypeName: string | null
  /** The first contact's mobile, else home, else work number; '' when there is none. */
  phone: string
  note: string
  waitlistedOn: IsoDate | null
}

export interface PlannedChildrenDto {
  waitlist: PlannedChildDto[]
  contracted: PlannedChildDto[]
}

/**
 * The school cutoff of a facility: the last birthday that still belongs to the school year. A child born on or before
 * `cutoffDay`.`cutoffMonth`, `ageYears` years before, starts school on the next 1 September (schoolStart.ts).
 */
export interface SchoolSettingsDto {
  cutoffMonth: number
  cutoffDay: number
  ageYears: number
  /**
   * The daily run deregisters the facility's school children to the day before their school start. Switched off again
   * by the server when the cutoff or a group's flag "for school children" changes.
   */
  autoLeave: boolean
  /** The cutoff the school law of the facility's state names (a suggestion; the stored cutoff may differ). */
  stateCutoff: SchoolCutoffInput
}

/** The cutoff alone, as the Träger stores it. */
export type SchoolCutoffInput = { cutoffMonth: number; cutoffDay: number; ageYears: number }

/** A facility's tablet settings: when it locks the child records again and what it shows staff and helpers beyond the current children. */
export interface TabletSettingsDto {
  /** Whole minutes without use until the tablet locks again (1–30). */
  lockMinutes: number
  /** Show waitlisted children (Vormerkungen) at the tablet. */
  showWaitlist: boolean
  /** Show children whose contract has not started yet at the tablet. */
  showFutureContracts: boolean
  /** Time windows „Keine automatische Sperre“ (at most 6, by start; on every day the facility is open). */
  noLockWindows: TimeWindow[]
}

/** How a facility's time tracking marks late arrivals and early leaving for the Leitung (never shown to staff). */
export interface TimeMarkSettingsDto {
  /** "Kulanz": only a delay / early leaving of more than this many whole minutes is marked (0–60). */
  toleranceMinutes: number
  /** Whether leaving earlier than planned is marked at all (late arrivals always are). */
  markEarlyLeave: boolean
}

/** The facility's reminder settings: documentation for children without group, lead times, and each group's documentation. */
export interface ReminderSettingsDto {
  noGroupDoc: DocSettings
  /**
   * „gilt seit“ of `noGroupDoc`: the day it was switched on or its mode last changed (null while off), or in interval
   * mode the start („Beginn“) the Leitung set; without a done date the due day is counted from no earlier than this day.
   */
  noGroupDocSince: IsoDate | null
  /** Days before a child's birthday (0–30). */
  birthdayLeadDays: number
  /** Days before a staff birthday (0–30). */
  staffBirthdayLeadDays: number
  /** Weeks before a child leaves (0–12). */
  leavingLeadWeeks: number
  /** The facility's groups in their order, each with its „gilt seit“ (as `noGroupDocSince`). */
  groups: { groupId: number; name: string; doc: DocSettings; docSince: IsoDate | null }[]
}

/**
 * A documentation setting as sent: in interval mode an optional start („Beginn“, any valid day) stored as „gilt seit“;
 * without it (and in birthday mode) the server sets „gilt seit“ itself.
 */
export type DocSettingsInput = DocSettings & { docSince?: IsoDate }

/** What the Leitung or Träger sets for the facility (the groups are set one by one). */
export type ReminderSettingsInput = Omit<ReminderSettingsDto, 'groups' | 'noGroupDocSince' | 'noGroupDoc'> & { noGroupDoc: DocSettingsInput }

/** An entry of the box „Erinnerungen“ on the children page. */
export interface ReminderDto {
  kind: ReminderKind
  /** The day it is about: the documentation's due day, the birthday, the last day before leaving; retention: today. */
  date: IsoDate
  /** Overdue only for a documentation. */
  state: 'upcoming' | 'today' | 'overdue'
  /** The child's first and last name, or the employee's name; empty for retention. */
  name: string
  /** null for a staff birthday and for retention. */
  childId: number | null
  /** For a child's birthday: the age the child turns; null otherwise. */
  age: number | null
  /** The child's key educator is the person looking at the box. */
  ownChild: boolean
  /** The documentation can be marked done (always true for a listed documentation, false for the other kinds). */
  canDone: boolean
  /** For a parent meeting: its start (minutes of the day); null otherwise. */
  time: Minutes | null
  /** For a parent meeting: its kind; null otherwise. */
  meetingKind: MeetingKind | null
  /** For retention (Träger only): how many entries of the page „Löschfristen“ may be deleted now, all facilities; null otherwise. */
  count: number | null
  /** For a Mutterschutz case (Leitung/Träger with employees.sickness): the employee, the case and what is still to do. */
  maternity?: { employeeId: number; caseId: number; task: MaternityTask }
  /** For a § 34 IfSG case whose health office notification is due: the case, the disease's name and the child's group. */
  ifsg?: { caseId: number; diseaseName: string; groupName: string; healthOffice: { name: string; phone: string } }
  /** For an offline stamp on the review list (Leitung/Träger): the entry, the person, Kommt/Geht and why. */
  offlineStamp?: { id: number; employeeId: number; action: StampAction; reason: OfflineStampReason }
  /** For a cluster (§ 34 Abs. 6 Satz 2): the disease, how many children and the days of the window. */
  ifsgCluster?: { disease: string; diseaseName: string; count: number; from: IsoDate; to: IsoDate }
  /** For a BEM to offer (Leitung/Träger with employees.sickness): the employee, the sick working days and the limit. */
  bem?: {
    employeeId: number; days: number; limit: number
    /** `offer`: a BEM to offer; `notSent`: started 7 days ago, invitation not sent yet; `answerDue`: the answer date has passed. */
    stage: 'offer' | 'notSent' | 'answerDue'
  }
  /** For a Probezeit ending soon (whoever sees the contract data): the employee; `date` is the last day of the probation. */
  probation?: { employeeId: number }
  /** For a return from Elternzeit (whoever sees the contract data): the employee; `date` is the first working day after it. */
  parentalLeave?: { employeeId: number; toPartTime: boolean }
  /** For a return from a long absence (employees.sickness): the employee; `date` is the first working day after it (no reason). */
  longAbsence?: { employeeId: number }
}

/** The record's „Entwicklungsdokumentation“. */
export interface DevelopmentDocDto {
  /** The latest „Erledigt“, with the stored name of whoever marked it. */
  lastDone: { id: number; date: IsoDate; name: string } | null
  /** When it is due next under the setting of the child's group today; null with the setting off or for a child not active. */
  nextDue: IsoDate | null
  /** The viewer may take the latest „Erledigt“ back: Leitung/Träger any time, others on its day in their own group. */
  canUndo: boolean
  /** The viewer may mark it done: an active child of a group they may write in. */
  canDone: boolean
}

/** A child the automatic leaving deregisters (when it is switched on, and in its daily run): its leaving day is the day before its school start. */
export interface SchoolLeaverDto {
  id: number
  name: string
  schoolStart: IsoDate
  leftOn: IsoDate
  /** The day from which the record may be deleted once the child is deregistered: the leaving day plus the retention period. */
  purgeOn: IsoDate
}

/** A child of the list "Schulkinder zum 1.9.": its school start is the coming 1 September, or reached without a leaving day. */
export interface UpcomingSchoolChildDto {
  id: number
  name: string
  /** The group the child is in today. */
  groupId: number | null
  schoolStart: IsoDate
  /**
   * The group for school children that makes the child stay: the one it is in on its school start, else the first one
   * it changes into afterwards (planned or applied); null = none, so its stay ends the day before the school start.
   */
  pendingSchoolGroup: string | null
  /** The „künftige Schule“ from the child's record (organisation and city), null = none chosen. */
  futureSchool: string | null
  /** That school no longer is for the facility (its „Gilt für“ changed): it stays, with a hint. */
  futureSchoolOutOfScope: boolean
  /** The school district by the facility's street list (null: no list, or no address). */
  schoolDistrict: SchoolDistrictMatchDto | null
}

/** A child named in an occupancy cell, with the borders of the stay counted there (to null = open). */
export interface OccupancyNameDto {
  id: number
  name: string
  from: IsoDate
  to: IsoDate | null
}

export interface OccupancyCellDto {
  /** Children who were already there before the month. */
  present: OccupancyNameDto[]
  /** Children whose stay starts in the month (shown in brackets). */
  fresh: OccupancyNameDto[]
  red: boolean
  /** Number of children above the capacity (0 = at or below it). */
  over: number
  /** The group's age limits exceeded in the month, in the rules' order (always empty for the total and „ohne Gruppe“). */
  ageViolations: AgeLimitCountDto[]
}

/** An age limit of a group: „von `fromYears` bis unter `toYears` Jahren: höchstens `maxChildren` Kinder“. */
export interface AgeLimitRuleDto {
  fromYears: number
  toYears: number
  maxChildren: number
}

/** An age limit with the children of its range in a month (`count`, more than `maxChildren` when exceeded). */
export interface AgeLimitCountDto extends AgeLimitRuleDto {
  count: number
}

/**
 * An age limit of a group exceeded from `year`/`month` on (the first such month of the coming twelve), with the
 * children in its range then: the hint on the Kinder page and after a save (the save happened anyway).
 */
export interface AgeLimitWarningDto extends AgeLimitCountDto {
  groupId: number
  groupName: string
  year: number
  month: number
}

export interface OccupancyRowDto {
  /** null = the row for children without a group (the client labels it; its name is empty). */
  groupId: number | null
  name: string
  capacity: number | null
  /** One cell per month of `months`. */
  cells: OccupancyCellDto[]
}

/**
 * A hint after a save that put a child into a group or the facility: from `year`/`month` on (the first month over) the
 * group or the facility has more children than its Höchstzahl Kinder, at most `count`. The save happened anyway.
 */
export interface CapacityWarningDto {
  kind: 'group' | 'facility'
  /** The group's or the facility's name. */
  name: string
  count: number
  capacity: number
  year: number
  month: number
}

/** The occupancy of a Kita year (September to August) by group and month. */
export interface OccupancyDto {
  year: number
  label: string
  months: { year: number; month: number }[]
  rows: OccupancyRowDto[]
  /**
   * The facility's Höchstzahl Kinder when the Träger set one (`fromFacility`), else the places of the groups together,
   * which are null unless every group has some.
   */
  total: { capacity: number | null; fromFacility: boolean; cells: OccupancyCellDto[] }
  /** Contract children without a start date; they are not counted. */
  undated: { id: number; name: string }[]
  /**
   * Contract children whose stay ends before it starts (left or school start before the contract start); not counted.
   * A child that a group for school children makes stay has an open stay and is not one of them.
   */
  inconsistent: { id: number; name: string }[]
}

/** The sections of a child's record a group change can leave unconfirmed: one "keep" choice each. */
export const KEEP_SECTIONS = ['contacts', 'health', 'consents', 'documents', 'careType', 'keyEducator'] as const
export type KeepSection = (typeof KEEP_SECTIONS)[number]

/**
 * Everything of a child's record that can be marked "not confirmed" after a group change: the sections that were not
 * kept and, only after a change into a group for school children, the further care contract.
 */
export const REVIEW_SECTIONS = [...KEEP_SECTIONS, 'contract'] as const
export type ReviewSection = (typeof REVIEW_SECTIONS)[number]

/** A group change of a child from `date` on; `keep[section] === false` = the section must be confirmed again after it. */
export interface GroupChangeInput {
  groupId: number
  date: IsoDate
  keep: Record<KeepSection, boolean>
  /**
   * "A further care contract has been concluded": required (true) for a change into a group for school children, whose
   * day is the start of that contract; without a meaning for every other group.
   */
  newContract?: boolean
}

/** A planned group change that is not applied yet. */
export interface GroupChangeDto {
  id: number
  groupId: number
  groupName: string
  date: IsoDate
  keep: Record<KeepSection, boolean>
  /** The change was planned into a group for school children, with the further care contract confirmed. */
  newContract: boolean
}

/** An active child with sections to confirm after a group change (the "Offen" list). */
export interface OpenChildDto {
  id: number
  name: string
  groupId: number | null
  sections: ReviewSection[]
}

export interface ChildRecordDto {
  id: number
  status: ChildStatus
  master: ChildMasterInput
  /** The planned group change that is not applied yet (at most one per child). */
  pendingGroupChange: GroupChangeDto | null
  /** The sections to confirm again after a group change, with the day since which they are (only the open ones). */
  reviews: Partial<Record<ReviewSection, IsoDate>>
  /** The school start the facility's cutoff yields from the birth date (the manual master.schoolStartDate wins over it). */
  computedSchoolStart: IsoDate
  /** Name of master.keyEducatorId (null together with it). */
  keyEducatorName: string | null
  /** The „künftige Schule“ as shown (organisation and city; null together with master.futureSchoolContactId). */
  futureSchoolName: string | null
  /** The „künftige Schule“ no longer is for the child's facility (its „Gilt für“ changed): it stays, with a hint. */
  futureSchoolOutOfScope: boolean
  /** The school district by the facility's street list, computed from the address (null: no list, or no address). */
  districtMatch: SchoolDistrictMatchDto | null
  health: ChildHealthInput
  /**
   * The facility's questions the record shows: the visible ones and the hidden ones this child has an answer to (shown
   * read-only), in their order.
   */
  consentQuestions: ConsentQuestionDto[]
  consents: ConsentAnswers
  contacts: ChildContactDto[]
  stamps: Record<'master' | 'contacts' | 'health' | 'consents', SectionStamp>
  leftOn: IsoDate | null
  /** Day the archived record is deleted automatically; null while the child has not left. */
  purgeOn: IsoDate | null
  canEdit: boolean
  documents: ChildDocumentDto[]
  developmentDoc: DevelopmentDocDto
  /** The parent meetings, newest first (by date and start). */
  meetings: ParentMeetingDto[]
  /** Whether the viewer may enter, change and delete parent meetings (the record's write rules). */
  canEditMeetings: boolean
  /** The notes, newest date first (then the newest entered). */
  notes: ChildNoteDto[]
  /**
   * Whether the viewer may add a note: whoever writes the child's attendance (children.attendance in its group, not
   * only read access), while the child has not left.
   */
  canAddNotes: boolean
  /** The educator a new note starts with: the acting person's employee when among the facility's staff, else null. */
  noteEducatorId: number | null
}

/** A document in a child's record; the file itself is fetched separately. */
export interface ChildDocumentDto {
  id: number
  typeId: number
  typeName: string
  title: string
  documentDate: IsoDate
  confidential: boolean
  mimeType: string
  size: number
  /** Username of the uploader; null if the account is gone. */
  uploadedBy: string | null
  uploadedAt: string
  /** False for a confidential document the viewer may not open (the file route answers 404). */
  canOpen: boolean
  /** A PDF that still has form fields („Weiter ausfüllen“); false when the viewer may not open it. */
  fillable: boolean
}

/**
 * A child the viewer may add documents to (not archived, not hidden from them, a group they may write in): the
 * targets of „Ausfüllen“ → „für ein Kind“.
 */
export interface ChildDocumentTargetDto {
  id: number
  firstName: string
  lastName: string
  groupName: string | null
  /** Waitlist or a contract that has not started yet. */
  planned: boolean
}

/** What the user enters about a document (the file comes with the upload). */
export interface ChildDocumentMeta {
  typeId: number
  title: string
  documentDate: IsoDate
  confidential: boolean
}

/**
 * Where a print template applies (shared/domain/documentTargets.ts): the facility the uploader works in, every facility,
 * or the facilities chosen (both the Träger's only).
 */
export type PrintTemplateScope = DocumentScope

/** The groups an item is limited to in one facility (at least one; a facility not named: all groups). */
export interface DocumentGroupTarget {
  facilityId: number
  groupIds: number[]
}

/**
 * „Gilt für“ as entered: the scope, for 'selected' the facilities (at least one), and the facilities limited to groups.
 * Changing an item: without `scope` its „Gilt für“ stays as it is.
 */
export interface DocumentTargetsInput {
  scope?: DocumentScope
  facilityIds?: number[]
  groupTargets?: DocumentGroupTarget[]
}

/** „Gilt für“ of an item for those who maintain it (and the hints in the lists for Leitung and Träger). */
export interface DocumentTargetsDto {
  scope: DocumentScope
  /** 'selected': the facilities chosen; 'facility': the own facility; 'all': none. */
  facilityIds: number[]
  facilityNames: string[]
  groupTargets: DocumentGroupTarget[]
  /** In the viewer's facility: the names of the groups it is limited to (null = all groups; [] = none left). */
  groupNames: string[] | null
}

/**
 * Saving an item of the Träger for several or all facilities (shared/domain/documentTargets.ts `spansFacilities`): also
 * create its category – and its subcategory – in the facilities of its „Gilt für“ that lack them (only the Träger, else
 * 403). Left out: it shows under „Vom Träger“ there, as before.
 */
export interface CategoryAdoptInput {
  createCategories?: boolean
}

/** Asked before saving: which facilities of the item's „Gilt für“ lack its category name (or the subcategory name). */
export interface MissingCategoriesInput {
  scope: DocumentScope
  facilityIds?: number[]
  categoryName: string
  subcategoryName?: string | null
}

/** The facilities that lack the category (or subcategory), in the usual order of the facilities. */
export interface MissingCategoriesDto {
  facilities: { id: number; name: string }[]
}

/** What „Gilt für“ offers the editor: the Träger every facility with its groups, everyone else the own facility. */
export interface DocumentTargetOptionsDto {
  /** The editor's (active) facility: a facility's own item is for it. */
  facilityId: number
  facilities: { id: number; name: string; groups: { id: number; name: string }[] }[]
}

/**
 * What the user enters about a print template (the file comes with the upload). A facility's template: one of the
 * facility's categories or subcategories they see (`categoryId`). A template for all or the chosen facilities (Träger):
 * the name of the category it shows in (each facility's own of that name, else „Vom Träger“), optionally the name of a
 * subcategory there (else directly in the category). Both: who sees it at least (`visibility`) and „Gilt für“.
 */
export interface PrintTemplateMeta extends DocumentTargetsInput, CategoryAdoptInput {
  title: string
  categoryId?: number | null
  categoryName?: string | null
  subcategoryName?: string | null
  visibility?: TemplateVisibility | null
}

/**
 * A category or subcategory of print templates of the facility as the viewer sees it (only those of their visibility
 * level, a subcategory only with its category), each category followed by its subcategories, in their order.
 */
export interface TemplateCategoryDto {
  id: number
  /** The category of a subcategory; null for a category. */
  parentId: number | null
  name: string
  visibility: TemplateVisibility
  /** The facility's own PDF templates filed directly in it; while there are any it cannot be deleted. */
  templateCount: number
  /**
   * The Bögen (form templates, also stopped ones) filed directly in it, for whoever maintains the categories
   * (printTemplates.edit or formTemplates.manage; 0 for everyone else); while there are any it cannot be deleted either.
   */
  formCount: number
  /**
   * The Träger's templates for all facilities shown directly in it (by its name) that the viewer sees: they move to „Vom
   * Träger“ (from a subcategory: into its category) when it is deleted or renamed (the confirmations name them).
   */
  globalCount: number
  /**
   * The subcategories of a category the viewer does not see (e.g. the Träger's alone): while there are any, the viewer
   * cannot delete the category (0 for a subcategory).
   */
  hiddenSubcategories: number
}

/** What Leitung or Träger enter about a category; `parentId` (only when creating) makes it a subcategory of that category. */
export interface TemplateCategoryInput {
  name: string
  visibility: TemplateVisibility
  parentId?: number | null
  /** The editor confirmed that Bögen in it would no longer be seen by some who fill them in (else 409 template_category_hides_forms). */
  confirmHidingForms?: boolean
}

/** A category name the facilities use (or items for all facilities carry) with the subcategory names under it. */
export interface CategoryNameDto {
  name: string
  subcategories: string[]
}

/** A blank PDF form to open and print (the file itself is served separately). */
export interface PrintTemplateDto {
  id: number
  title: string
  /**
   * The facility's category it shows in; null for a template for all facilities whose category name the facility has no
   * category of („Vom Träger“).
   */
  categoryId: number | null
  /** The name of that category (for „Vom Träger“ the name the Träger chose). */
  category: string
  /** The subcategory it shows in; null when directly in the category („Allgemein“) or under „Vom Träger“. */
  subcategoryId: number | null
  /** The name of that subcategory ('' for none; under „Vom Träger“ the name the Träger chose). */
  subcategory: string
  /** Of the Träger (for all or the chosen facilities, only the Träger changes it). */
  global: boolean
  /** For all facilities, also later ones (the Träger's; otherwise for its own facility or the facilities chosen). */
  allFacilities: boolean
  /**
   * A template for all facilities: the category name, the subcategory name ('' for none) and the visibility the Träger
   * chose (null for a facility's own).
   */
  globalCategoryName: string | null
  globalSubcategoryName: string | null
  globalVisibility: TemplateVisibility | null
  /** Who sees it at least (its own setting; its category's applies on top, the stricter one wins). */
  visibility: TemplateVisibility
  size: number
  uploadedAt: string
  updatedAt: string
  /** Whether the viewer may rename, replace and delete it. */
  canEdit: boolean
  /** A PDF form with fields to fill in the app („Ausfüllen“). */
  fillable: boolean
  /**
   * Its place in its list of the facility, numbered together with the Bögen there (shared/domain/templateEntries.ts);
   * null for a template of before that was never ordered (after the placed ones, by title).
   */
  place: number | null
  /** „Gilt für“, for Leitung, Träger and whoever may change it (null for everyone else). */
  targets: DocumentTargetsDto | null
}

/** Completeness view: active children against the important document types. */
export interface DocumentOverviewDto {
  /** The important types in the facility's order. */
  types: DocumentTypeDto[]
  rows: {
    childId: number
    name: string
    groupId: number | null
    /**
     * Per important type id: the newest document, or null while there is none. `stale`: no document of the type was
     * uploaded since the group change after which it has to be handed in again - a required type while the child's
     * documents are to be confirmed, the care contract type while its further care contract is.
     */
    cells: Record<number, { documentId: number; documentDate: IsoDate; canOpen: boolean; stale: boolean } | null>
    /** A required type has no document yet, or only a stale one. */
    missingRequired: boolean
  }[]
}

export interface BirthdayDto {
  childId: number
  name: string
  birthDate: IsoDate
  groupId: number | null
  /** The next birthday on or after today. */
  date: IsoDate
  /** The age turned on that day. */
  turns: number
}

/** A contact person in the children overview (without the internal note). */
export interface OverviewContactDto {
  name: string
  relation: string
  phoneHome: string
  phoneMobile: string
  phoneWork: string
  isGuardian: boolean
  mayPickUp: boolean
  contactBan: boolean
  contactBanNote: string
  emergencyRank: number | null
}

/** One child in the Excel-like overview tables. */
export interface ChildrenOverviewRowDto {
  id: number
  lastName: string
  firstName: string
  groupId: number | null
  birthDate: IsoDate
  address: string
  /** The „künftige Schule“ as shown in the record ('' without one). */
  school: string
  /** The answers to every question of the facility (hidden ones included: a tab may still show them). */
  consents: ConsentAnswers
  measlesProof: boolean | null
  measlesProofDate: IsoDate | null
  infectionBriefingDate: IsoDate | null
  allergies: string
  /** In the record's order. */
  contacts: OverviewContactDto[]
  /** The child's parent meetings, newest first (as in the record), without the confidential note. */
  meetings: OverviewMeetingDto[]
}

/** A parent meeting in the children overview: never with participants or the note. */
export interface OverviewMeetingDto {
  date: IsoDate
  start: Minutes
  kind: MeetingKind
  /** It lies ahead: a later day (Berlin), or today with a start later than now. */
  planned: boolean
}

export interface ChildrenOverviewDto {
  /** The listed children's groups in the groups' order; children without group last as `{ id: null, name: '' }`. */
  groups: { id: number | null; name: string }[]
  /** In the order of the child list. */
  children: ChildrenOverviewRowDto[]
  /** The facility's tabs in their order (none: the page says where to add them). */
  sheets: OverviewSheetDto[]
  /** Every question of the facility, hidden ones included, in their order. */
  questions: ConsentQuestionDto[]
}

/** An archived child in the archive list; the record may be deleted from `purgeOn` on (by the Träger, by hand). */
export interface ArchivedChildDto {
  id: number
  name: string
  leftOn: IsoDate
  purgeOn: IsoDate
  /**
   * Accident reports still to be kept today (5 years after the accident, DGUV Vorschrift 1 § 24 Abs. 6): how many, and
   * until when the newest; null without one. „Sofort löschen“ warns about them.
   */
  accidentHold: { reports: number; until: IsoDate } | null
}

/** What an item of the Träger's retention overview deletes of a left employee: a category, or the employee row itself. */
export type RetentionItemCategory = 'immediate' | 'payroll' | 'time' | 'assessment' | 'bem' | 'maternity' | 'paidOvertime' | 'inspection' | 'record'

/**
 * An item of the Träger's retention overview (spec Löschübersicht §2), across every facility. `key` names it for the
 * delete routes: `employee:<id>:<category>`, `child:<id>`, `cash:<id>`. `deletableFrom` is null only for an employee
 * `record` (due once the person's other categories hold no data) and for a cash box without entries or history (due).
 * `employee:<id>:bem` („BEM-Unterlagen“) is listed also for employees still there: from the end of their earliest ended BEM.
 */
export interface RetentionItemDto {
  key: string
  kind: 'employee' | 'child' | 'cash' | 'signRequest' | 'infoVisit' | 'applicant'
  /** Only for an employee; null for a child record, a cash box and a request to sign. */
  category: RetentionItemCategory | null
  facilityId: number
  facilityName: string
  /** The employee's name, the child's first and last name, the cash box's name, the request's title. */
  name: string
  deletableFrom: IsoDate | null
  /**
   * Only for „BEM-Unterlagen“: the end of the BEM the date counts from (for a running BEM of someone who left: the
   * leaving day) and whether the person is still employed (not left before today), for the label.
   */
  bem?: { endedOn: IsoDate; employed: boolean }
  /** The same for „Mutterschutz-Unterlagen“: the end of the case the date counts from. */
  maternity?: { endedOn: IsoDate; employed: boolean }
  /** Only for a child record kept longer for an accident report (5 years after the accident, DGUV Vorschrift 1 § 24 Abs. 6). */
  accidentHold?: true
  /**
   * Only for an applicant: 'declined' (counted from the refusal) or 'open' („ohne Abschluss“: no activity for
   * `quietMonths`, the facility's setting, listed as due from then on). Info visits and applicants name the family or
   * person.
   */
  applicantState?: 'declined' | 'open'
  /** Only for an open applicant: the months without activity after which it is listed. */
  quietMonths?: number
  /**
   * Only for an inspection record (§ 72a Abs. 5 SGB VIII): the last day it may be kept – the leaving day + 3 months;
   * null = at once (the activity was not taken up) – and whether that has passed (shown in red, listed first, reminded).
   */
  inspection?: { deleteBy: IsoDate | null; overdue: boolean }
  /** May be deleted today. */
  due: boolean
}

/** „Alle fälligen löschen“: how many of the items were deleted, and the keys skipped (not due, gone or invalid). */
export interface RetentionDeleteResult {
  deleted: number
  skipped: string[]
}

/** Whole years (1-10) a child's record is kept after the leaving day; set by the Träger for all facilities. */
export interface ChildRetentionDto {
  years: number
}

export interface FacilitiesDto {
  facilities: FacilityDto[]
  /** The facility the viewer currently works in. */
  activeId: number | null
}

export interface CellRef {
  employeeId: number
  date: IsoDate
}

export interface EntryInput {
  kind: EntryKind
  templateId?: number | null
  codeId?: number | null
  start?: Minutes | null
  end?: Minutes | null
  breakStart?: Minutes | null
  breakEnd?: Minutes | null
  note?: string | null
  /** The group this duty counts for when it is not the home group (null or missing = the home group). */
  groupId?: number | null
  /**
   * „Homeoffice – zählt ohne Stempeln“ (missing = false): only on entries with working time (shift, special shift, timed
   * code such as Büro or VZ), also on a timed code without times (the whole day, „Homeoffice (ganzer Tag)“); otherwise
   * 400 home_office_not_allowed.
   */
  homeOffice?: boolean
  /** „Kind krank“: which of the employee's children (optional; only with that code, else ignored). */
  employeeChildId?: number | null
  /** „Sonderurlaub“: a key of SPECIAL_LEAVE_REASONS and a free text (only with that code, else ignored). */
  specialLeaveReason?: string | null
  specialLeaveText?: string | null
}

/** New times of one entry clicked in the plan; homeOffice only when it changes (missing = kept). */
export interface EntryTimesInput {
  start: Minutes
  end: Minutes
  breakStart: Minutes | null
  breakEnd: Minutes | null
  homeOffice?: boolean
}

export interface EntryDto extends DomainEntry {
  id: number
  templateId: number | null
  codeId: number | null
  note: string | null
  label: string
  shortLabel: string | null
  color: ColorKey
  /** The facility whose plan this help-out entry belongs to; null for a normal entry of the home facility. */
  helpFacilityId: number | null
  /** The group of the plan's facility this single duty counts for; null = the employee's home group. */
  groupId: number | null
  /** „Homeoffice – zählt ohne Stempeln“: the time counts in the time tracking as if stamped. */
  homeOffice: boolean
}

/** An employee of another facility helping out in this facility's plan for a month (a helper column). */
export interface HelperDto {
  helpOutId: number
  employeeId: number
  name: string
  shortName: string
  fromFacilityId: number
  fromFacility: string
  /**
   * Help-outs between the helper's home facility and this one are allowed (the Träger's pair, server/services/helpoutPairs.ts):
   * without it the column stays (its duties count) but is marked „nicht freigegeben“ and takes no new duties.
   */
  paired: boolean
}

/**
 * The Träger's mutual permissions for help-outs between facilities (Einstellungen → Einrichtung): the pairs the viewer may
 * see (the Träger all, the Leitung those of her facility), each [smaller id, larger id].
 */
export interface HelpoutPairsDto {
  pairs: [number, number][]
  /** The names of the facilities in those pairs (the Leitung knows no other facility otherwise). */
  names: Record<number, string>
  /** For the Träger: facilities with help-outs planned between them but no pair (they give no visibility until it is set). */
  unpaired: { facilityIds: [number, number]; names: [string, string]; entries: number }[]
}

/** A help-out planned between two facilities (shown before the Träger ends their pair). */
export interface PairedHelpOutDto {
  date: IsoDate
  employee: string
  /** The facility whose plan it is in. */
  inFacility: string
  /** The helper's home facility. */
  fromFacility: string
}

/** Someone of another facility who could be added as a helper (only names are shown). */
export interface HelpCandidateDto {
  employeeId: number
  name: string
  shortName: string
  facilityName: string
}

export interface TemplateDto {
  id: number
  shortLabel: string
  label: string
  start: Minutes
  end: Minutes
  breakStart: Minutes | null
  breakEnd: Minutes | null
  countsAsStaff: boolean
  pairsWithPrepTime: boolean
  /** Entries made with this button are home office (only new entries; existing ones keep theirs). */
  homeOffice: boolean
  sortOrder: number
}

export interface CodeDto {
  id: number
  key: CodeKey
  label: string
  color: ColorKey
  creditMode: CreditMode
  requiresTimes: boolean
  sortOrder: number
}

export interface CoverageRuleDto {
  id: number
  label: string
  start: Minutes
  end: Minutes | null
  minCount: number
  active: boolean
  /** The group the rule applies to (null = the whole facility). */
  groupId: number | null
  /** Weekdays the rule is checked on (mask Mo = 1 … Fr = 16; 31 = all). */
  weekdays: number
}

export interface DayRowDto {
  date: IsoDate
  weekday: number
  isWeekend: boolean
  holidayKey: HolidayKey | null
  closureLabel: string | null
  info1: string
  info2: string
  /**
   * The facility's automatic, anonymous events of the day (Eingewöhnung, Elterngespräch, Kindergeburtstag, staff
   * birthday), shown after the Info texts; computed when read, never part of a release (none = []).
   */
  autoEvents: string[]
  /**
   * The facility's appointments on that day the viewer may see (shared/domain/calendarEvents.ts), shown after the Info
   * texts and before the automatic events; read as they are now, never part of a release (none = []).
   */
  events: CalendarEventDto[]
}

/** A day of the facility's plan: with the opening hours entered for it (null = none entered). */
export interface PlanDayDto extends DayRowDto {
  /** The facility's hours of the day. */
  opening: DayHours | null
  /** The own hours of the groups that have some entered for the day, by group id. */
  groupOpening: Record<number, DayHours>
}

/** The facility's opening hours and those of each group (null = no own hours). */
export interface OpeningHoursDto {
  facility: OpeningHours | null
  groups: { groupId: number; groupName: string; hours: OpeningHours | null }[]
}

export interface ChangeDto {
  field: ChangeField
  employeeId: number | null
  date: IsoDate
  before: string
  after: string
  changedAt: string
  changedBy: string
}

export interface ReleaseDto {
  releasedAt: string | null
  releasedBy: string | null
  /** Cells/info fields changed between releases (released changes). */
  changeCount: number
  /** Admin only: cells/info fields whose draft differs from the newest release. */
  pendingCount: number
}

export interface PendingChangeDto {
  before: string
  after: string
}

export interface EmployeeColumnDto {
  id: number
  name: string
  shortName: string
  /** For a helper column: the name of the helper's home facility ("Aushilfe aus …"); null for own staff (missing in old snapshots). */
  helpFrom?: string | null
  /** The home group in the plan's facility (null = Springer, a helper, or no groups; missing in old snapshots). */
  groupId?: number | null
}

export interface SnapshotDayDto {
  date: IsoDate
  info1: string
  info2: string
  closureLabel: string | null
}

/** What observers see of a month, frozen at release time. */
export interface SnapshotData {
  /** In blocks: the members of each group (groups in their order), then Springer, then helpers. */
  employees: EmployeeColumnDto[]
  entries: EntryDto[]
  days: SnapshotDayDto[]
  /** The facility's groups at release time, in their order (missing in old snapshots: no blocks). */
  groups?: GroupDto[]
}

/** A week template applied to a plan week: its name then, when (ISO time) and by whom (username). */
export interface WeekTemplateUseDto {
  templateName: string
  appliedAt: string
  appliedBy: string
}

export interface WeekSummaryDto {
  weekStart: IsoDate
  weekEnd: IsoDate
  weekNumber: number
  /** Name of the facility's week template this week was saved as or filled from (null = none). */
  templateName: string | null
  /** Template names of the week keyed '0' (the whole facility, as templateName) or by group id; none = {}. */
  templateNames: Record<string, string>
  /** Each time a week template filled this week, the latest first (none = []); only in the editors' plan data. */
  templateUses: WeekTemplateUseDto[]
  /** Something of the week's plan was entered, changed or deleted after the latest of templateUses (not by the apply). */
  templateChangedSince: boolean
  totals: { employeeId: number; target: number; credit: number; delta: number }[]
}

export interface BalanceDto {
  employeeId: number
  name: string
  weeklyMinutes: number | null
  today: number
  monthEnd: number
  /** Balance at the last day of the previous month (carry-over incl. bookings). */
  previousMonthEnd: number
}

export interface ActualCellDto {
  /** Recorded minutes of the day (closed records). */
  minutes: number
  open: boolean
  /** More than 15 minutes away from the planned credit. */
  deviates: boolean
}

export interface MonthPlanAdminDto {
  warnings: Warning[]
  weeks: WeekSummaryDto[]
  balances: BalanceDto[]
  /** Recorded time per cell (past days with time tracking), keyed by cellKey. */
  actuals: Record<string, ActualCellDto>
  /** Draft changes not yet released, keyed by cellKey / noteKey. */
  pendingChanges: Record<string, PendingChangeDto>
  /** The people in the newest release (empty before the first), to name a change of someone no longer in the plan. */
  releasedEmployees: EmployeeColumnDto[]
  /** The month's helpers of other facilities (their columns come after the own staff). */
  helpers: HelperDto[]
  /** Per helper (employee id): the days of the month that belong to another plan ("belegt", not writable here). */
  helperBusy: Record<number, IsoDate[]>
  /** "Im Dienst erkrankt" markers of the own staff's days in this month, keyed by cellKey (never part of a release). */
  sickLeaves: Record<string, SickLeaveMarkDto>
  /** Warnings of this month marked „Zur Kenntnis genommen“ (see shared/domain/warningList.ts). */
  warningAcks: WarningAckDto[]
}

/** A warning marked „Zur Kenntnis genommen“: its key and its values then, by whom and when (ISO timestamp). */
export interface WarningAckDto {
  key: string
  signature: string
  byName: string
  at: string
}

export interface MonthPlanDto {
  year: number
  month: number
  /** Name of the plan's facility when there are several (null with only one, so single-facility printouts stay as they were). */
  facilityName: string | null
  /** The facility whose plan this is. */
  facilityId: number
  /** Names of this facility and of the facilities its entries were planned in (for the "Aushilfe in …" markers). */
  facilityNames: Record<number, string>
  release: ReleaseDto
  days: PlanDayDto[]
  employees: EmployeeColumnDto[]
  entries: EntryDto[]
  /** The groups of the shown plan (the draft for managers, the release for others), in their order; none = []. */
  groups: GroupDto[]
  /**
   * Per group id and day of the month: the persons working in that group (duties with working time whose effective group
   * it is, helpers included, help-elsewhere markers never). No groups = {}.
   */
  attendance: Record<string, Record<IsoDate, number>>
  /** Keyed by cellKey(employeeId, date) or noteKey(field, date). */
  changes: Record<string, ChangeDto[]>
  templates: TemplateDto[]
  codes: CodeDto[]
  /**
   * „Krank melden“: the id of the Krank code for a plan editor without employees.sickness (whose `codes` leave out the
   * private ones); afterwards the day shows „abwesend“ to her. Null for everybody else.
   */
  reportSickCodeId: number | null
  admin: MonthPlanAdminDto | null
  /**
   * The cells (cellKey) of the staff's working days in a full Elternzeit (no stored entry; server/services/parentalLeave.ts),
   * with the text to show: „Elternzeit“ for viewers with employees.view (not at the tablet) or when the facility shows it to
   * all, else „abwesend“.
   */
  parentalLeave: { cells: string[]; label: 'parental_leave' | 'absent' }
  /** „Längere Abwesenheit“ (server/services/longAbsence.ts): who is out of the plan and the line below it. */
  longAbsence: LongAbsencePlanDto
}

/**
 * The long absences of a month's plan, as they are now (also in a released month). The reason (`null` = „abwesend“)
 * only for viewers who may see it: Langzeitkrank, Kur/Reha, Sonstiges and Mutterschutz with employees.sickness (never at
 * the tablet), Elternzeit as the plan shows it (seesParentalLeave).
 */
export interface LongAbsencePlanDto {
  /**
   * The line „Längere Abwesenheit: N Personen“: each period reaching into the month, per person (staff order), periods
   * with the same shown reason that follow each other joined. `to` null = „bis auf Weiteres“.
   */
  people: {
    employeeId: number; name: string; from: IsoDate; to: IsoDate | null; reason: LongAbsenceReason | null
    /** The person's home group (null = Springer or no groups): the line follows the group chosen above the plan. */
    groupId: number | null
  }[]
  /**
   * The staff taken out of this plan: away on every working day of the month, nothing planned for them to work or as
   * leave. A plan editor (plan.edit) still gets their columns, entries and hints, hidden until „im Plan zeigen“; for
   * everybody else they are not sent.
   */
  hidden: number[]
  /**
   * Cells (cellKey) of an entered long absence holding a duty: it does not count (day overview, coverage). Only for a
   * plan editor who may see the reason (employees.sickness); empty for everybody else, who see the duty as it is.
   */
  dutyCells: string[]
  /**
   * Shown persons' working days in a long absence without any entry, keyed by cellKey: the reason to show (null =
   * „abwesend“). Not the days of a full Elternzeit (`parentalLeave` marks them).
   */
  cells: Record<string, LongAbsenceReason | null>
}

/** An entry in "Mein Dienstplan"; a help-out duty carries the name of the facility it is in. */
export interface MyPlanEntryDto extends EntryDto {
  helpFacilityName?: string
}

export interface MyPlanDayDto extends DayRowDto {
  entries: MyPlanEntryDto[]
  changes: ChangeDto[]
  /** A working day of the person's own full Elternzeit („Elternzeit“; no stored entry). */
  parentalLeave?: boolean
  /** A working day of the person's own long absence without an entry („Längere Abwesenheit“; no reason). */
  longAbsence?: boolean
}

export interface MyPlanDto {
  year: number
  month: number
  employee: EmployeeColumnDto
  release: ReleaseDto
  days: MyPlanDayDto[]
}

export interface LeaveAccountDto {
  employeeId: number
  name: string
  year: number
  account: LeaveAccount
  /** The year whose entitlement was carried into this one (null: recorded for this year, or none). */
  inheritedFrom: number | null
  /** Whether an entitlement is recorded for this year or before (false: the account is all zero). */
  hasEntitlement: boolean
  /** Whether the carry-over is computed from the year before (false: entered by hand for the first year, or none). */
  carriedAutomatically: boolean
  ranges: LeaveRange[]
  /**
   * The person's own leave entries of the year (Urlaub, Sonderurlaub, Überstundenfrei) as periods, by start date: without
   * the leave booked by closures (that shows in `closures` and is not removed period by period).
   */
  entryRanges: LeaveEntryRange[]
  /** The closures (as leave) with what each took from the person's leave in the year, by start date. */
  closures: ClosureLeaveDto[]
  /**
   * The one-off extra days of the year („Zusatztag nur für dieses Jahr“) with their reasons, in the order added (summed in
   * `account.extraDays`); empty without an entitlement, since the account then counts none.
   */
  extraDays: LeaveExtraDaySummary[]
  /** Days the year's entitlement (`account.entitlement`, already cut) was cut for Elternzeit (§ 17 Abs. 1 BEEG); 0 = none. */
  parentalLeaveCut: number
  /**
   * The remaining leave of the year does not lapse on the forfeiture day because of an Elternzeit (§ 17 Abs. 2 BEEG): the
   * last day it can still be taken; null = the forfeiture day applies as usual.
   */
  parentalLeaveProtectedUntil: IsoDate | null
}

/** One „Zusatztag nur für dieses Jahr“ entry as the leave account shows it: the days and the reason. */
export interface LeaveExtraDaySummary {
  days: number
  reason: string
}

/** One „Zusatztag nur für dieses Jahr“ entry on the employee page, with who added it and when (ISO timestamp). */
export interface LeaveExtraDayDto extends LeaveExtraDaySummary {
  id: number
  year: number
  createdBy: string
  createdAt: string
}

/** What one closure took from a person's leave in a year. */
export interface ClosureLeaveDto {
  closureId: number
  label: string
  startDate: IsoDate
  endDate: IsoDate
  /** Leave days it used in the year (weighted like the leave account); days changed in the plan are not counted. */
  days: number
  /** Working days it covered in the year without using leave (a joiner without leave left). */
  closureDays: number
}

/**
 * One year of the closure leave preview (creating an employee, employee page „Urlaub & Zeiten“): what the facility's
 * closures as leave take in the year, computed as the booking would (closurePreview.ts). Writes nothing.
 */
export interface ClosurePreviewYearDto {
  year: number
  /** The first day counted for the person: „gültig ab“, the first weekly hours or move-in day, else 1 January. */
  from: IsoDate
  /** A closure of the facility as leave (vacation mode) touches the year. */
  hasClosures: boolean
  /** The closures as leave in the year for a 5-day week, without weekends and public holidays (the closures page). */
  facilityDays: number
  /** Leave days they take from the person (from `from` on, only on the person's working days, joiner limit applied). */
  personDays: number
  /** The person's closure days entered without leave (joiner limit). */
  closureDaysWithoutLeave: number
  /** The entitlement days of the year with its one-off extra days (null = none recorded or entered). */
  entitlementDays: number | null
  /** Resturlaub of the year (the first block only; 0 otherwise). */
  carriedOverDays: number
}

export interface EmployeeListItemDto {
  id: number
  name: string
  shortName: string
  sortOrder: number
  leftOn: IsoDate | null
  currentWeeklyMinutes: number | null
  /** Working days bitmask valid today (bit 0 = Monday). */
  currentWorkdays: number
  /** Where the employee may clock in and out, and whether breaks are clocked or deducted automatically. */
  stampVia: StampChannel
  breakMode: BreakMode
  /** The home group in the facility (null = Springer, or the facility has no groups). */
  groupId: number | null
  /** Birthday as MM-DD without a year (null = not given). */
  birthday: string | null
  /** Qualification for the staffing ratio (null = not entered yet). */
  qualification: Qualification | null
  /** Counting share in percent, 0–100 (null = the state's default for the qualification). */
  staffingShare: number | null
  /** Whether a stamp PIN is set (without one the person is not on the tablet; the list shows „PIN fehlt“). */
  hasPin: boolean
  /** Whether the PIN cannot be used right now (a running timed lock or one lasting until „PIN freischalten“). */
  pinLocked: boolean
  /** Contract data; only sent to the Träger, and to the Leitung when the Träger allows it. */
  contract?: EmployeeContractDto
  /**
   * Only for someone with a leaving day: whether data of the 10-year category is left — balance adjustments marked
   * „ausgezahlt“ or personnel file documents in the folders contract and salary (the archive names its deletion date only
   * then; without it the entry goes with the assessments).
   */
  hasPaidOut?: boolean
}

export interface EmployeeDetailDto extends EmployeeListItemDto {
  hours: { id: number; weeklyMinutes: number; validFrom: IsoDate; workdays: number }[]
  /** `paidOut`: „ausgezahlt“, kept for the longer retention period after leaving. */
  adjustments: { id: number; date: IsoDate; minutes: number; reason: string; paidOut: boolean }[]
  /** carriedOverDays is the carry-over that counts; carriedAutomatically when it is the rest of the year before. */
  entitlements: { id: number; year: number; days: number; carriedOverDays: number; carriedAutomatically: boolean }[]
  /** „Zusatztag nur für dieses Jahr“: the one-off extra leave days of every year, by year and then in the order added. */
  leaveExtraDays: LeaveExtraDayDto[]
  /**
   * „Stundenkonto ab“ (ISO date): the hours account counts only from the later of this day and the first weekly hours
   * (null = from the first weekly hours).
   */
  balanceFrom: IsoDate | null
  /**
   * First day „Schließzeiten nachtragen“ books: the first weekly hours, or the day the person moved into the facility
   * when later (null without weekly hours).
   */
  closuresFrom: IsoDate | null
  /** End of a running timed PIN lock (15 or 30 minutes; null = none). */
  pinLockedUntil: string | null
  /** The PIN stays locked until the Leitung or the Träger unlocks it („PIN freischalten“). */
  pinLockedPermanently: boolean
  /** Locks since the last right PIN (0 = none; stays after a timed lock has run out, until a right PIN or the unlock). */
  pinLockLevel: number
  /** Anschrift, Kontakt, Geburtsjahr; only with employees.personal (otherwise the key is absent). */
  personal?: EmployeePersonalDto
  /** Staatsangehörigkeit, Schwerbehinderung; only with employees.sensitive (otherwise the key is absent). */
  sensitive?: EmployeeSensitiveDto
}

/** What employees.personal maintains (Personalakte §2); empty texts are null. */
export interface EmployeePersonalInput {
  /** With the birthday (MM-DD) it forms the full birth date. */
  birthYear: number | null
  street: string | null
  postalCode: string | null
  city: string | null
  phone: string | null
  email: string | null
}

export interface EmployeePersonalDto extends EmployeePersonalInput {
  /** The full birth date from birthYear and birthday; null unless both are set (and form a real date). */
  birthDate: IsoDate | null
}

/** What employees.sensitive sees and maintains (Personalakte §2). */
export interface EmployeeSensitiveDto {
  nationality: string | null
  /** Schwerbehinderung ja/nein, Grad der Behinderung (20–100 in steps of 10), „gleichgestellt“, gültig bis. */
  disability: boolean
  disabilityDegree: number | null
  disabilityEqual: boolean
  disabilityUntil: IsoDate | null
}

/** Lohn und Steuer (employees.payroll only), full values; the page masks them until „anzeigen“. Empty = null. */
export interface EmployeePayrollDto {
  /** Steuer-ID, 11 digits. */
  taxId: string | null
  /** Steuerklasse 1–6. */
  taxClass: number | null
  /** Sozialversicherungsnummer, 12 characters. */
  svNumber: string | null
  healthInsurer: string | null
  iban: string | null
  accountHolder: string | null
  /** Konfession (Kirchensteuer). */
  denomination: string | null
}

/** „Lohn und Steuer“ as the page reads it: the stored values and what follows from the children (read-only). */
export interface EmployeePayrollViewDto extends EmployeePayrollDto {
  /** For the Pflegeversicherung, as of today: „Elterneigenschaft“ (any child) and the children under 25. */
  parentStatus: { parent: boolean; childrenUnder25: number }
}

/** A child of an employee (personal data, employees.personal). */
export interface EmployeeChildInput {
  /** Optional, only to tell the children apart (empty = null). */
  firstName: string | null
  birthDate: IsoDate
  /** „Kind mit Behinderung, auf Hilfe angewiesen“. */
  disabledDependent: boolean
}

export interface EmployeeChildDto extends EmployeeChildInput {
  id: number
}

/** The section „Kinder“ of the personnel file: „alleinerziehend“ and the children, by birth date. */
export interface EmployeeChildrenDto {
  singleParent: boolean
  children: EmployeeChildDto[]
}

/** The section saved at once: children with an id are changed, without one added, missing ones removed. */
export interface EmployeeChildrenInput {
  singleParent: boolean
  children: (EmployeeChildInput & { id?: number | null })[]
}

/** The four values of the Kinderkrankentage (§ 45 SGB V), as the Träger enters them. */
export interface ChildSickSettingsInput {
  perChild: number
  maxPerYear: number
  singleParentPerChild: number
  singleParentMax: number
}

/**
 * The Kinderkrankentage settings (for all facilities) as of today: the values of the current year (the Träger's own,
 * which count for every year, or the legal ones of the year), whether they are the Träger's own, the legal values of the
 * year, and whether own values hold a raised value of 2026 (which applies by law only up to 2026).
 */
export interface ChildSickSettingsDto extends ChildSickSettingsInput {
  custom: boolean
  year: number
  legal: ChildSickSettingsInput
  outdated: boolean
}

/** Kinderkrankentage of an employee in a year: working days with „Kind krank“ and the entitlement. */
export interface ChildSickYearDto {
  year: number
  taken: number
  entitlement: number
  /** Children counting in the year (under 12 on a day of it, or disabled and dependent on help). */
  eligibleChildren: number
}

/** What the user enters about a personnel file document (the file comes with the upload). */
export interface EmployeeDocumentMeta {
  folder: EmployeeDocumentFolder
  title: string
  documentDate: IsoDate
  /** Free note, may be empty. */
  note: string
}

/** A document of the personnel file; the file itself is fetched separately. */
export interface EmployeeDocumentDto extends EmployeeDocumentMeta {
  id: number
  mimeType: string
  size: number
  /** Username of the uploader; null if the account is gone. */
  uploadedBy: string | null
  uploadedAt: string
  /** A PDF that still has form fields („Weiter ausfüllen“). */
  fillable: boolean
  /** The Pflichtdokument it is filed as (null = none). */
  requiredTypeId: number | null
  /**
   * A file that must not be kept (a Pflichtdokument „nur Einsicht vermerken“, the Führungszeugnis): only open, move or
   * delete it – no „Bearbeiten“, no request to sign.
   */
  inspectionFile?: true
}

/** A Pflichtdokument of the facility as entered (Einstellungen → Mitarbeitende → Pflichtdokumente). */
export interface RequiredDocumentTypeInput {
  name: string
  /** The folder of the personnel file it is filed in; its key decides who sees and files it. */
  folder: EmployeeDocumentFolder
  appliesTo: RequiredAppliesTo
  /** Valid for this many months from the document's date (null = no end). */
  validityMonths: number | null
  /** A print template to fill it from („Ausfüllen“); null = none (always for 'inspection'). */
  templateId: number | null
  active: boolean
  /** 'file': a document of the personnel file; 'inspection': „nur Einsicht vermerken“, no file (§ 72a Abs. 5 SGB VIII). */
  mode: RequiredDocumentMode
  /**
   * „§ 72a SGB VIII (Führungszeugnis)“: the law's texts and deadline for its records. Only the Träger changes it (403
   * required_type_certificate_provider); left out: unchanged (a new type: not set).
   */
  certificate?: boolean
  /**
   * Taking „§ 72a“ away moves the type's existing records to the usual 3 years: refused until confirmed (409
   * required_type_certificate_unset with `details.records`, the number of records), then sent again with true.
   */
  confirmCertificateUnset?: boolean
}

/** A Pflichtdokument of the facility, in its order (only those in folders the viewer may use). */
export interface RequiredDocumentTypeDto extends RequiredDocumentTypeInput {
  id: number
  certificate: boolean
  /** The template's title (null without one, or when the viewer does not see it). */
  templateTitle: string | null
}

/** The status of one Pflichtdokument for an employee (Nachweise → Pflichtdokumente). */
export interface EmployeeRequiredDocumentDto {
  typeId: number
  name: string
  folder: EmployeeDocumentFolder
  validityMonths: number | null
  templateId: number | null
  state: RequiredDocumentState
  /** The date of the newest linked document (null = missing). */
  date: IsoDate | null
  /** The end of validity of that document (null without a validity or a document). */
  expiresOn: IsoDate | null
  documentId: number | null
  mode: RequiredDocumentMode
  /** The type is „§ 72a SGB VIII (Führungszeugnis)“: the texts name the law. */
  certificate: boolean
  /**
   * The recorded inspection (null = none); recordedBy the name of the account, null once it is deleted. Also for a type
   * switched back to 'file': then read only, until „Vermerk löschen“.
   */
  inspection: {
    certificateDate: IsoDate; inspectedOn: IsoDate | null; noRelevantEntry: boolean; recordedBy: string | null; recordedAt: string
  } | null
  /** Files kept for it that must not be (to be deleted, § 72a Abs. 5 SGB VIII), in folders the viewer may use. */
  storedFiles: { id: number; title: string; documentDate: IsoDate }[]
  /** Who recorded, changed or deleted the inspection record and when (newest first; nothing of the content). */
  history: { action: InspectionLogAction; by: string; at: string }[]
  /**
   * null: a type the box asks for. Else only a record kept for a type that no longer does – 'inactive' (switched off) or
   * 'notApplicable' (not for the person's qualification any more): read only, with its result, until „Vermerk löschen“.
   */
  retired: RetiredInspectionReason | null
}

/** Why a record's type no longer asks for it: switched off, or not for the person's qualification any more. */
export type RetiredInspectionReason = 'inactive' | 'notApplicable'

/**
 * A record of a type that no longer asks for it (RetiredInspectionReason), for Datenschutz & Löschen: still shown read
 * only at the person (with „Vermerk löschen“); only in folders the viewer may use – who may see the result, too.
 */
export interface RetiredInspectionDto {
  employeeId: number
  employeeName: string
  facilityId: number
  facilityName: string
  typeId: number
  typeName: string
  certificate: boolean
  reason: RetiredInspectionReason
  certificateDate: IsoDate
  noRelevantEntry: boolean
}

/**
 * „Einsicht vermerken“: the certificate's date (required), the day of inspection (optional) and whether there is no
 * relevant conviction (§ 72a Abs. 1 SGB VIII) – what § 72a Abs. 5 lets the Träger store. `noRelevantEntry` is always
 * chosen explicitly (left out: 400 inspection_choice_required – never read as an entry).
 */
export interface RequiredInspectionInput {
  certificateDate: IsoDate
  inspectedOn: IsoDate | null
  noRelevantEntry: boolean
}

/** A note still kept on an entry of the Pflichttermin „Erweitertes Führungszeugnis“ (Datenschutz & Löschen: to delete). */
export interface CriminalRecordNoteDto {
  /** The entry (employee_requirements) whose note „Notiz löschen“ removes. */
  id: number
  employeeId: number
  employeeName: string
  facilityId: number
  facilityName: string
  /** The entry's day. */
  date: IsoDate
}

/** What Datenschutz & Löschen lists for deletion by hand beside the retention items (§ 72a Abs. 5 SGB VIII). */
export interface InspectionCleanupDto {
  files: RequiredInspectionFileDto[]
  notes: CriminalRecordNoteDto[]
  /** The audit lines left without their type (it was deleted, or the record was removed on a move). */
  history: InspectionHistoryDto[]
  /** Records of a type that no longer asks for them (inactive, or not for the person any more). */
  records: RetiredInspectionDto[]
}

/**
 * Who recorded, changed or deleted a person's inspection record and when, for a type that is gone (deleted, or the
 * record removed on a move to another facility): kept until the person's retention deletes it, only in folders the
 * viewer may use.
 */
export interface InspectionHistoryDto {
  employeeId: number
  employeeName: string
  facilityId: number
  facilityName: string
  /** The type's name at the time ('' if unknown). */
  typeName: string
  /** It was „§ 72a SGB VIII (Führungszeugnis)“. */
  certificate: boolean
  /** Newest first. */
  lines: { action: InspectionLogAction; by: string; at: string }[]
}

/**
 * The move of an employee to another facility: the inspection records that could not go along (the new facility has no
 * active type „nur Einsicht“ for them, so they were removed), as far as the mover may use their folder – who may then
 * also see the result (`entry`: it held a relevant entry).
 */
export interface EmployeeMoveResultDto {
  ok: true
  inspectionsRemoved: { typeName: string; certificate: boolean; entry: boolean }[]
}

/** A file kept for a type „nur Einsicht vermerken“ that must not be (Datenschutz & Löschen: to be deleted). */
export interface RequiredInspectionFileDto {
  documentId: number
  employeeId: number
  employeeName: string
  facilityId: number
  facilityName: string
  /** The type it was kept for; '' once that type is deleted or the viewer may not use its folder. */
  typeName: string
  /** Kept for a type „§ 72a SGB VIII (Führungszeugnis)“ (also once it is deleted): the texts name the law. */
  certificate: boolean
  title: string
  documentDate: IsoDate
}

/**
 * The documents per folder, newest document date first: only the folders the viewer may use (see, upload, delete),
 * in the page's order; a folder without the right is absent.
 */
export type EmployeeDocumentsDto = Partial<Record<EmployeeDocumentFolder, EmployeeDocumentDto[]>>

export interface UserDto {
  id: number
  username: string
  role: Role
  employeeId: number | null
  employeeName: string | null
  active: boolean
  mustChangePassword: boolean
  lockedUntil: string | null
}

// --- rights and roles (Rechte und Rollen Teil 2) ----------------------------------------------------------------

/** A switch of the rights page with its relations (spec Teil 2 §2, §3). */
export interface RightsBundleDto {
  id: BundleId
  area: BundleArea
  label: string
  /** Children bundles: with a scope 'group' (own group) or 'facility'. */
  scoped: boolean
  /** „braucht: …“: switching on brings these (and what they need) along. */
  requires: BundleId[]
  /** Included bundles: switching on brings them along; the page shows them as „enthalten in: …“. */
  includes: BundleId[]
}

/** One switch of a role: as set, and as the Grundeinstellung has it. */
export interface RoleBundleStateDto {
  id: BundleId
  enabled: boolean
  /** Only for a scoped bundle that is on; null otherwise. */
  scope: BundleScope | null
  defaultEnabled: boolean
  defaultScope: BundleScope | null
}

export interface RoleRightsDto {
  role: RightsRole
  /** Every bundle, in page order. */
  bundles: RoleBundleStateDto[]
  /** Nothing differs from the Grundeinstellung. */
  isDefault: boolean
}

/** The answer of saving rights: what the server pulled in as requirement and what it dropped as dependent. */
export interface RightsChangeDto {
  pulledIn: BundleId[]
  dropped: BundleId[]
}

/** GET /api/rights: the catalog of switches, the Träger-only rights and the settings of Leitung and Mitarbeiter. */
export interface RightsDto {
  areas: { id: BundleArea; label: string }[]
  bundles: RightsBundleDto[]
  /** Fixed at the Träger, never grantable (shown greyed out „nur Träger“). */
  providerOnly: { key: PermissionKey; label: string }[]
  roles: RoleRightsDto[]
}

/** PUT /api/rights/roles/[role]: the switches of the role (a bundle left out keeps its state). */
export interface RoleRightsInput {
  bundles: { id: string; enabled: boolean; scope?: BundleScope | null }[]
}

/** One switch of a person: the role's state, the exception and what applies. */
export interface UserBundleStateDto {
  id: BundleId
  role: { enabled: boolean; scope: BundleScope | null }
  override: { effect: 'grant' | 'revoke'; scope: BundleScope | null } | null
  effective: { enabled: boolean; scope: BundleScope | null }
}

/** GET /api/users/[id]/rights. */
export interface UserRightsDto {
  userId: number
  username: string
  role: RightsRole
  bundles: UserBundleStateDto[]
  /** The bundles whose exception the viewer may change: all for the Träger, only childrenEdit for the Leitung. */
  editable: BundleId[]
}

/** GET /api/employees/rights-exceptions: one employee's exceptions from the role (column „Sonderrechte“). */
export interface RightsExceptionsDto {
  employeeId: number
  /** In the order of the switches; a grant with the scope it applies with (null: the switch has none). */
  overrides: { bundle: BundleId; effect: 'grant' | 'revoke'; scope: BundleScope | null }[]
}

/** PUT /api/users/[id]/rights: the person's exceptions, all of them (an exception left out is removed). */
export interface UserRightsInput {
  overrides: { bundle: string; effect: 'grant' | 'revoke'; scope?: BundleScope | null }[]
}

export interface ClosureDto {
  id: number
  startDate: IsoDate
  endDate: IsoDate
  label: string
  mode: ClosureMode
}

/** A closure in the closures list, with the leave days it uses for staff working Monday to Friday. */
export interface ClosureListItemDto extends ClosureDto {
  /** Without weekends and public holidays, 24 and 31 December by the facility setting; null in closure-day mode. */
  leaveDays: number | null
}

export interface SettingsDto {
  templates: TemplateDto[]
  codes: CodeDto[]
  coverageRules: CoverageRuleDto[]
}

export interface EmployeeContractDto {
  personnelNumber: string | null
  employedSince: IsoDate | null
  jobKey: JobKey | null
  /** Free job title, only with jobKey 'other'. */
  jobOther: string | null
  /** One of the table, or an old one still stored (S 10: shown as „nicht mehr in der Tabelle“). */
  payGroup: StoredPayGroup | null
  payLevel: number | null
  /** „befristet bis“: last day of a fixed-term contract (null = unbefristet). */
  fixedTermUntil: IsoDate | null
  /** „Probezeit bis“: last day of the probation period (null = none entered). */
  probationUntil: IsoDate | null
  /** „Ausbildung/Studium hier bis“ (null = none): the level years start after it (see levelStart). */
  trainingUntil: IsoDate | null
  /** „Anerkennungsjahr zählt als Stufe 1“ (always false without trainingUntil). */
  recognitionYearCounts: boolean
}

/** A contract change; fixedTermUntil, probationUntil, trainingUntil and recognitionYearCounts left out = unchanged. */
export type EmployeeContractInput
  = Omit<EmployeeContractDto, 'payGroup' | 'fixedTermUntil' | 'probationUntil' | 'trainingUntil' | 'recognitionYearCounts'>
    & {
      /** Checked by the service: one of PAY_GROUPS, or the old one stored (400 invalid_pay_group). */
      payGroup: string | null
      fixedTermUntil?: IsoDate | null; probationUntil?: string | null; trainingUntil?: IsoDate | null; recognitionYearCounts?: boolean
    }

export interface AppSettingsDto {
  timeTrackingFrom: IsoDate | null
}

export interface TerminalPersonDto { employeeId: number; name: string; clockedIn: boolean }

/** Which children beyond the current ones a viewer without manager rights sees (the facility's tablet switches). */
export interface ChildVisibility { waitlist: boolean; futureContracts: boolean }

/** The groups a tablet person with a group of their own works with: the own one (write) and the granted ones (read only). */
export interface GroupAccess { own: number; readable: number[] }

/** What the person at the child records may do and see. */
export interface ChildRightsDto {
  canEdit: boolean
  isManager: boolean
  /** Moving a child to another facility (Träger only; never at the tablet). */
  canMoveFacility: boolean
  showWaitlist: boolean
  showFutureContracts: boolean
}

/** Whether the tablet shows child records, and for whom (name and rights of the person who unlocked it). */
export type TabletUnlockStatusDto =
  | { unlocked: false }
  | {
    unlocked: true; employeeId: number; name: string; rights: ChildRightsDto; lockMinutes: number
    /**
     * „Nur Kinderzahlen“: the person has no child rights at all and sees only „Kinder heute“ (names-free numbers,
     * /children/today); every other child page sends there.
     */
    countsOnly: boolean
    /**
     * The facility's windows without the automatic lock on the day of the last use and today (open days only, cut to the
     * opening hours; ISO moments, touching ones of a day joined): the tablet times its lock with them by
     * shared/domain/tablet.ts unlockDeadline, as the server does.
     */
    noLockPeriods: NoLockPeriodDto[]
    /**
     * „Dienstplan bearbeiten“: null when the person may not edit this facility's plan at the tablet (no active account of
     * their own in this facility, or no plan.edit there); otherwise whether they edit it now, and what their account
     * may do beyond plan.edit. While they edit, the windows without the automatic lock do not apply (noLockPeriods empty)
     * and lockMinutes is at most PLAN_EDIT_MAX_LOCK_MINUTES.
     */
    planEdit: TabletPlanEditDto | null
  }

/** What the person editing the plan at the tablet may do, from their own account's permissions (see TabletUnlockStatusDto). */
export interface TabletPlanEditDto {
  /** Editing has started with this unlock (the plan pages show the editor). */
  active: boolean
  /** plan.release: „Freigeben“ and „Änderungen verwerfen“. */
  canRelease: boolean
  /** employees.personal: „Kind krank“ asks which child. */
  seesPersonal: boolean
  /** employees.sickness: the health codes as they are and „Im Dienst erkrankt“. */
  seesSickness: boolean
  /** While editing: when it ends at the latest, however much it is used (ISO, PLAN_EDIT_MAX_MINUTES after the start). */
  endsAt: string | null
}

/** A stretch without the automatic lock as ISO moments (`until` excluded). */
export interface NoLockPeriodDto { from: string; until: string }

/**
 * One line of „Kinder heute“ (the whole facility or one group): the numbers of the attendance list's summary line, by
 * the same rules (shared/domain/childAttendance.ts dayStatus, countsForMeal). Numbers only.
 */
export interface ChildCountsLineDto {
  present: number
  notYet: number
  /** krank, Urlaub, entschuldigt, unentschuldigt. */
  absent: number
  /** Abgeholt. */
  gone: number
  /** Children counted for each meal of the day, in the order of `ChildCountsDto.meals`. */
  meals: number[]
}

/**
 * „Kinder heute“ at the tablet for a person with „Nur Kinderzahlen“ (GET /api/terminal/children/counts): today's numbers
 * of the facility without names, ids or anything else about a child.
 */
export interface ChildCountsDto {
  date: IsoDate
  /** False on weekends, holidays and closure days (the attendance list's hint). */
  isCareDay: boolean
  /** The meals of the day with the name and time valid today (minutes after midnight), by time. */
  meals: { name: string; time: number }[]
  total: ChildCountsLineDto
  /**
   * Per group, only when the facility has more than one group: the groups of today's children in the groups' order,
   * `name` null for the children without group (last). Empty otherwise.
   */
  groups: (ChildCountsLineDto & { name: string | null })[]
}

/**
 * „Nur Kinderzahlen“ of an employee as the tab „Zugang“ shows it (GET /api/employees/[id]/counts-only): `offered` false
 * for a person with a Leitung or Träger account and for a viewer who may not set child rights (the block is hidden);
 * `editable` false while offered only for a Gruppenleitung, whose child rights the Träger sets (the Leitung sees it).
 */
export interface CountsOnlyStateDto {
  countsOnly: boolean
  offered: boolean
  editable: boolean
}

export type StampAction = 'in' | 'out'
export type TimeRecordSource = 'self' | 'terminal' | 'admin'

export interface TimeRecordDto {
  id: number
  employeeId: number
  date: IsoDate
  start: Minutes
  end: Minutes | null
  source: TimeRecordSource
  /** Created or changed by the admin. */
  edited: boolean
  editedBy: string | null
  editedAt: string | null
  /** Kommt or Geht came from the tablet's offline queue („offline erfasst“). */
  offline: boolean
  /**
   * How far the tablet's clock was off when it sent the offline stamp („Uhrzeit des Tablets wich ab“), in minutes;
   * null within 5 minutes, and always null on the employee's own time page.
   */
  clockSkewMinutes: number | null
}

/** One stamp of the tablet's offline queue as sent (POST /api/terminal/offline-stamps). */
export interface OfflineStampInputDto {
  /** Random id the tablet gave the stamp: a stamp sent twice is taken once. */
  clientId: string
  employeeId: number
  pin: string
  action: StampAction
  /** The tablet's clock at the tap, ISO with offset. */
  stampedAt: string
}

/**
 * The tablet's answer per stamp: done or rejected, no reason. Every stamp named here leaves the tablet's queue; one
 * not named (PIN checks of the request used up, or it could not be stored) stays for the next request.
 */
export interface OfflineStampResultDto {
  clientId: string
  status: OfflineTabletStatus
}

/** An offline stamp not taken over, on the review list of the time page until checked. */
export interface OfflineStampHintDto {
  id: number
  employeeId: number
  name: string
  action: StampAction
  date: IsoDate
  minutes: Minutes
  reason: OfflineStampReason
  clockSkewMinutes: number | null
  receivedAt: string
}

export interface OpenRecordDto {
  id: number
  employeeId: number
  name: string
  date: IsoDate
  start: Minutes
}

export interface TimeRecordChangeDto {
  before: string
  after: string
  actor: string | null
  at: string
}

export interface TimeDayDto {
  date: IsoDate
  weekday: number
  isWeekend: boolean
  holidayKey: HolidayKey | null
  /** Plan of the day as text (live draft). */
  plan: string
  /** Credit the plan alone would give. */
  plannedMinutes: number
  target: number
  records: TimeRecordDto[]
  /**
   * The day's home-office entries („Homeoffice (laut Plan)“): counted as if stamped, not editable as records. Only on
   * days of the tracking range (usesRecords); empty on other days, which show the plan.
   */
  homeOffice: { start: Minutes; end: Minutes; away?: true }[]
  /** „Ist“: the closed records plus, on days of the tracking range, the home-office minutes outside them (without their planned breaks). */
  recordedMinutes: number
  /** What the balance counts for this day. */
  counted: number
  /**
   * The day counts in the hours account (from the first weekly hours, or „Stundenkonto ab“ when later): only these
   * days add up to the sheet's Soll, Angerechnet and Differenz.
   */
  inBalance: boolean
  usesRecords: boolean
  /** One of the four absences of the time page (Urlaub, Krank, Fortbildung, Schule) is planned. */
  absence: boolean
  /** The plan has entries other than those absences (shifts, Feiertag, Schließtag …) that an absence would replace. */
  otherEntries: boolean
  /**
   * A daily-target code (Urlaub … Feiertag, Schließtag) or a whole Büro/VZ day without times is planned: the day counts
   * its target, records do not count.
   */
  targetCredit: boolean
  /** A whole Büro/VZ day without times (as home office: „Homeoffice (ganzer Tag)“), shown with its credited target. */
  fullDay: FullDayDto | null
  warnings: Warning[]
  /** Admin's free-text reason for this day (not shown to the employee). */
  note: string
  changes: TimeRecordChangeDto[]
  /** The day has planned working time and no full-day absence: it can be marked "Im Dienst erkrankt". */
  plannedDuty: boolean
  /** "Im Dienst erkrankt": the planned time is credited whatever was stamped, and the day has no time hints. */
  sickLeave: SickLeaveMarkDto | null
  /**
   * Stamped, but the plan counts („zählt nach Plan“): „Im Dienst erkrankt“ or a whole Büro/home-office day. The same
   * neutral note for both, for viewers who may not see the marker.
   */
  planCounted: boolean
  /**
   * Minutes the first stamped arrival came after the first planned work start, when more than the facility's tolerance
   * (null = not marked). Leitung and Träger only, like the whole time page; never in the staff's own time view.
   */
  lateMinutes: number | null
  /** Minutes the last departure lay before the last planned work end, when more than the tolerance and switched on. */
  earlyMinutes: number | null
}

/** A whole working day without times on the time page: „Büro (ganzer Tag): 7:48 (Tagessoll)“. */
export interface FullDayDto {
  /** The entry's label, e.g. „Büro (ganzer Tag)“. */
  label: string
  /** Worked from home: shown as „Homeoffice (ganzer Tag)“. */
  homeOffice: boolean
  /** The credited minutes: the day's target. */
  minutes: Minutes
}

export interface MyTimeDto {
  enabled: boolean
  today: IsoDate
  /** Where this employee may clock in and out (the stamp button is hidden for "tablet only"). */
  stampVia: StampChannel
  breakMode: BreakMode
  /** Start of today's open record, null when clocked out. */
  clockedInSince: Minutes | null
  todayRecords: TimeRecordDto[]
  /** Earlier days with a forgotten clock-out. */
  openEarlier: IsoDate[]
  balanceToday: number
  balanceMonthEnd: number
  /** All own records of the requested month. */
  records: TimeRecordDto[]
  /**
   * „Erfasst“ per day of the month with records or with home office counting as recorded (days of the tracking range
   * only), computed as on the admin time page.
   */
  recordedDays: Record<IsoDate, RecordedDayDto>
}

/** „Erfasst“ of one day: the home-office spans counting as stamped and the clocked minutes plus those. */
export interface RecordedDayDto {
  /** Home-office spans, and Arzt spans (`away`): both count as stamped. */
  homeOffice: { start: Minutes; end: Minutes; away?: true }[]
  recordedMinutes: Minutes
}

export interface TimeMonthDto {
  employee: { id: number; name: string }
  trackingFrom: IsoDate | null
  /** Buttons for absences entered from the time page (written to the plan). */
  absenceCodes: CodeDto[]
  days: TimeDayDto[]
  /** The month's late arrivals and early leaving (how often, minutes in total) under the facility's settings. */
  marks: MarkSummary & TimeMarkSettingsDto
}

/** A day the facility closed earlier (admin-only record). */
export interface EarlyClosureDto {
  id: number
  date: IsoDate
  /** Closing time that day, minutes since midnight. */
  closedFrom: Minutes
  reason: string
}

/** Sick periods of one employee in one year (workdays, weekends bridged). */
export interface SickYearRowDto {
  employeeId: number
  name: string
  total: number
  ranges: LeaveRange[]
}

/**
 * "Im Dienst erkrankt": the employee fell ill during the duty of a day and left early. Only for Leitung and Träger of
 * the employee's home facility.
 */
export interface SickLeaveMarkDto {
  id: number
  /** When the person left: the entered time, otherwise the end of the day's last closed time record, otherwise null. */
  leftAt: Minutes | null
  /** leftAt comes from the time record, not from an entered time. */
  leftAtFromRecord: boolean
  note: string | null
}

export interface EarlySickLeaveRowDto extends SickLeaveMarkDto {
  employeeId: number
  employeeName: string
  date: IsoDate
  /** The planned duty of the day as text, e.g. "F2 7:30–15:45" (a help-out elsewhere: its times only). */
  duty: string
}

/** The year's list of the sick-days page: who left early because of illness, and how often. */
export interface EarlySickLeavesDto {
  /** Newest first. */
  rows: EarlySickLeaveRowDto[]
  /** Only employees with at least one row, in the staff order. */
  totals: { employeeId: number; employeeName: string; count: number }[]
}

export interface EarlySickLeaveInput {
  employeeId: number
  date: IsoDate
  /** Time of leaving (minutes of the day); null = not entered. */
  leftAt: Minutes | null
  note?: string | null
}

/** Colour group of a day in the year calendar. */
export type CalendarKind = 'sick' | 'maternity' | 'absent' | 'vacation' | 'overtime_off' | 'special_leave' | 'training' | 'closed' | 'requested'
  /** A working day of a full Elternzeit (no stored entry; „abwesend“ for viewers who see it masked). */
  | 'parental_leave'

/**
 * The facility's own appointment, in the year calendar and on its days in the plan (shared/domain/calendarEvents.ts).
 * `endDate`: the last day of a longer appointment (null = one day); `start` is then the time on the first day, `end`
 * the time on the last.
 */
export interface CalendarEventDto {
  id: number
  date: IsoDate
  endDate: IsoDate | null
  start: Minutes | null
  end: Minutes | null
  title: string
  /** „Wer sieht den Termin?“ */
  visibility: EventVisibility
  /** The chosen groups / employees: only for whoever manages the calendar (empty for everybody else). */
  groupIds: number[]
  employeeIds: number[]
  /** Only on a „Pflichttermin“: the kind its participants (the people „Wer sieht den Termin?“ names) keep by attending. */
  requirement?: CalendarEventRequirementDto
}

export interface CalendarEventRequirementDto {
  typeId: number
  typeName: string
  /** When the attendance was last confirmed (null = not yet; always null for whoever does not see every appointment). */
  confirmedAt: string | null
}

/**
 * An appointment as the dialog saves it (POST/PUT /api/calendar-events); the lists only count for their choice.
 * `requirementTypeId`: „Pflichttermin“ of that kind (null = none; left out = unchanged on a change, none when new).
 */
export type CalendarEventSaveDto = Omit<CalendarEventDto, 'id' | 'requirement'> & { requirementTypeId?: number | null }

/**
 * „Teilnahme bestätigen“ of a Pflichttermin appointment (whoever enters Pflichttermine, employees.edit): the
 * people it is meant for, resolved now (`visibility`: everyone / the home groups / the chosen people; not those who left
 * before its first day or start after its last), plus anyone an earlier confirmation recorded.
 */
export interface EventAttendanceDto {
  eventId: number
  title: string
  date: IsoDate
  endDate: IsoDate | null
  typeName: string
  /** The day the entries get: the appointment's last day. */
  recordDate: IsoDate
  /** From the (last) day of the appointment on. */
  canConfirm: boolean
  confirmedAt: string | null
  /**
   * People meant for it (or recorded by it before) who left so long ago that their Pflichttermine may be deleted
   * (Löschfristen): not listed, and the confirmation neither adds nor removes anything for them.
   */
  retentionSkipped: number
  people: EventAttendancePersonDto[]
}

export interface EventAttendancePersonDto {
  employeeId: number
  name: string
  groupName: string | null
  /** Ticked: never confirmed → everyone; confirmed → those with an entry from this appointment. */
  attended: boolean
  /** An entry of the kind on that day was entered by hand: it stays as it is, the confirmation adds none. */
  handEntered: boolean
}

/** What the appointment dialog offers for „Bestimmte Gruppen“ / „Bestimmte Personen“: the facility's groups and staff. */
export interface CalendarEventAudienceDto {
  groups: { id: number; name: string }[]
  employees: { id: number; name: string; groupId: number | null }[]
  /** People on the changed appointment's list who cannot be chosen any more (left): „ausgeschieden“, dropped on saving. */
  former: { id: number; name: string }[]
}

export interface YearCalendarDto {
  year: number
  /** The public-holiday rules the calendar's staff follow (their home facility's state). */
  holidays: HolidayRules
  /**
   * The rows, sorted by home group (in the groups' order, people without a group last; the usual order within), with
   * the home group and its colour (null = no group, or a group without colour).
   */
  employees: { id: number; name: string; groupId: number | null; color: GroupColor | null }[]
  /** The groups that have people in the calendar, in their order, for the legend. */
  groups: { id: number; name: string; color: GroupColor | null }[]
  /** Per employee id: the calendar kind of each day that has one. */
  days: Record<number, Record<IsoDate, CalendarKind>>
  /** Per employee id: dates with plan entries other than the four absences (an absence would replace them). */
  otherEntries: Record<number, IsoDate[]>
  /** Per employee id: weekdays (Mon–Fri, no holiday) that are not working days of their contract. */
  freeDays: Record<number, IsoDate[]>
  /** Urlaub, Krank, Fortbildung, Schule — entered by clicking a day. */
  absenceCodes: CodeDto[]
  events: CalendarEventDto[]
  /** The facility's automatic, anonymous events per day of the year (only days that have some), after the appointments. */
  autoEvents: Record<IsoDate, string[]>
  /**
   * The open leave requests (Mehr → Kalender): only for the Leitung, the Träger and the leave planners while leave
   * requests are on; missing or null for everyone else (the staff calendar never has them).
   */
  requests?: CalendarRequestsDto | null
}

/** An open leave request in the year calendar, drawn hatched on its days. */
export interface CalendarLeaveRequestDto {
  id: number
  employeeId: number
  kind: LeaveRequestKind
  startDate: IsoDate
  endDate: IsoDate
  /** Days the request uses, as LeaveRequestDto.workdays. */
  workdays: number
  /** When it was made (ISO timestamp). */
  createdAt: string
  /** Its days in the year: the person's working days outside closures. */
  dates: IsoDate[]
}

export interface CalendarRequestsDto {
  requests: CalendarLeaveRequestDto[]
  /** „Höchstzahl gleichzeitig im Urlaub“ (null = no limit). */
  maxConcurrent: number | null
  /** Days of the year with more people on leave (planned leave and open requests) than allowed, with their number. */
  overLimit: Record<IsoDate, number>
  /** The viewer plans leave there (leave.plan): only then the calendar links to „Urlaubsplanung“ (else it has no requests). */
  canPlan: boolean
}

/** A saved plan week; `rows` previews it per employee with one text per day Monday–Sunday ('' = empty). */
export interface WeekTemplateDto {
  id: number
  name: string
  /** The group the template is for (null = the whole facility). */
  groupId: number | null
  updatedAt: string
  rows: { employeeId: number; name: string; days: string[] }[]
}

/**
 * One entry of a week template written in its editor: what the plan takes for a cell (without a group: a template's
 * duties count for the home group) on a weekday, 0 = Monday … 6 = Sunday.
 */
export type WeekTemplateEntryInput = Omit<EntryInput, 'groupId'> & {
  employeeId: number
  weekday: number
  /**
   * Whether a shift or special shift counts as staff (missing = as the plan resolves it: the service's mark, a special
   * shift counts); ignored for breaks and codes. The editor sends what it opened, so saving keeps every entry's mark.
   */
  countsAsStaff?: boolean
}

/** A whole week template from its editor (create, or replace name, scope and entries). */
export interface WeekTemplateInput {
  name: string
  /** The group the template is for (null = the whole facility). */
  groupId: number | null
  entries: WeekTemplateEntryInput[]
  /** Info 1 / Info 2 per weekday (left out: none for a new template, unchanged when replacing one). */
  infos?: WeekTemplateInfo[]
}

/** The plan's Info 1 / Info 2 of a template weekday (0 = Monday … 6 = Sunday); '' = empty. */
export interface WeekTemplateInfo {
  weekday: number
  info1: string
  info2: string
}

/**
 * An entry of a week template as its editor shows it, like a plan entry: no date (''), no group, no help-out. A shift
 * whose service (Dienst) has other times by now comes as a special shift with its saved times, as filling a week writes it.
 */
export interface WeekTemplateEntryDto extends EntryDto {
  /** 0 = Monday … 6 = Sunday. */
  weekday: number
}

/** A week template with its entries, for its editor. */
export interface WeekTemplateDetailDto {
  id: number
  name: string
  groupId: number | null
  updatedAt: string
  entries: WeekTemplateEntryDto[]
  /** Info 1 / Info 2 of the weekdays that have any, by weekday. */
  infos: WeekTemplateInfo[]
  /** Everyone with entries in it, also people who left or are no longer in its scope (to name them in the editor). */
  people: { id: number; name: string }[]
}

/** Someone a week template can plan: the facility's own staff who have not left, with their current contract. */
export interface WeekTemplateStaffDto {
  id: number
  name: string
  shortName: string
  /** Home group (null = Springer or no groups). */
  groupId: number | null
  /** Contract hours per week in minutes (the first contract when it starts later); null without any. */
  weeklyMinutes: number | null
  /** Working days of that contract (bitmask, bit 0 = Monday). */
  workdays: number
}

/**
 * What the week template editor checks a template against, as the plan's warnings do: the active Pflichtdienste (a
 * group rule with its group's name) and the opening hours (the facility's, and those of groups with own hours).
 */
export interface WeekTemplateCoverageDto {
  rules: CoverageRule[]
  hours: DayHoursContext
}

export interface WeekTemplateApplyResult {
  /** Employee days filled from the template. */
  filled: number
  /** Template days left out: cell not empty, or no working day for that employee (holiday, closure, day off, left). */
  skipped: number
  /** Days whose Info 1 or Info 2 already held another text, kept instead of the template's (by date). */
  infosKept: IsoDate[]
}

export interface ShiftChangeResult {
  template: TemplateDto
  /** Plan entries from applyFrom on that got the new times. */
  updated: number
  /** Plan entries left with the old times because the new ones would clash with other entries of that day. */
  skipped: number
  /** Template (Vorlage) entries that got the new times. */
  inTemplates: number
}

/** What the employee list shows beside each person beyond the basic list (one request, rights filtered on the server). */
export interface EmployeeListExtrasDto {
  employeeId: number
  /**
   * „Nächste Stufe“: only with employees.contractView (otherwise the key is absent). null = no level or no start of
   * employment entered; `final`: the top level is reached; else the next level and its day, with the state (`soon`: within
   * 30 days, `overdue`: the day has passed and the level is not entered yet).
   */
  level?: { final: true } | {
    final: false; fromLevel: number; level: number; on: IsoDate; state: 'later' | 'soon' | 'overdue'
    /** Days the step moved because Elternzeit does not count towards the level years (0 = none; § 17 Abs. 3 TVöD). */
    shiftDays: number
  } | null
  /** „in Probezeit bis …“: only with employees.contractView (otherwise absent); the last day while it runs, else null. */
  probationUntil?: IsoDate | null
  /** Mandatory appointments that are overdue, missing or due soon (empty = nothing open). */
  requirements: { typeId: number; typeName: string; state: DueRequirementDto['state']; dueOn: IsoDate | null }[]
  /** The Pflichttermin appointments ahead the person is meant for, one per kind („geplant am …“; absent without any). */
  plannedRequirements?: (PlannedRequirementDto & { typeId: number; typeName: string })[]
  /**
   * The Pflichtdokumente missing or expired (only types in folders the viewer may use; absent without any folder right;
   * empty = nothing missing).
   */
  requiredDocuments?: { typeId: number; name: string; state: 'missing' | 'expired' | 'entry'; certificate: boolean }[]
  /**
   * The notice on remaining leave: only with leave.overview (otherwise the key is absent); null outside the notice
   * window (1 October until the forfeiture date) or when the person has no leave left. `year` is the year whose
   * leave the notice is about. `open` also covers a notice that has to be read again.
   */
  forfeit?: {
    year: number; status: 'read' | 'open' | 'no_account'; readAt: string | null
    /** The date an Elternzeit moved the forfeiture to (§ 17 Abs. 2 BEEG; the notice of that leave); null = the usual notice. */
    protectedUntil: IsoDate | null
  } | null
}

/** One changed cell of an employee between two releases (texts as shown in the plan). */
export interface DutyChangeDto {
  date: IsoDate
  before: string
  after: string
}

/** Message to an employee that their released duties changed. */
export interface NotificationDto {
  id: number
  year: number
  month: number
  createdAt: string
  readAt: string | null
  changes: DutyChangeDto[]
}

/** Who was told about the changes of the latest release of a month, and who has read it. */
export interface ReleaseNotificationStatusDto {
  employeeId: number
  name: string
  readAt: string | null
  /** False when no user account is linked to the employee (nobody can read the message). */
  hasAccount: boolean
}

export type LeaveRequestStatus = 'open' | 'approved' | 'rejected' | 'withdrawn'
/** 'vacation' = Urlaub (uses leave days), 'overtime_off' = Überstundenfrei (taken from the balance). */
export type LeaveRequestKind = 'vacation' | 'overtime_off'

/** What „Urlaub eintragen“ writes into the plan: Urlaub, Sonderurlaub or Überstundenfrei (ÜF). */
export type LeaveEntryKind = 'vacation' | 'special_leave' | 'overtime_off'

/** A period of one kind of leave entries (days: leave days for Urlaub, 24/31 December maybe half; else working days). */
export interface LeaveEntryRange extends LeaveRange {
  kind: LeaveEntryKind
  /**
   * Sonderurlaub only, and only for Leitung/Träger (employees.sickness) or the employee themselves: the reason of the
   * period (a key of SPECIAL_LEAVE_REASONS or null, and the free text); missing otherwise.
   */
  reason?: { key: string | null; text: string | null }
}

/** „Urlaub eintragen“: the days written, and the days kept because another absence (Krank, Fortbildung …) holds them. */
export interface LeaveEntryResultDto {
  booked: number
  keptAbsences: number
  /** Sonderurlaub entered again with a reason: the days that already held it and got the new reason (missing = none). */
  reasonUpdated?: number
}

/** A removed leave period: the days removed, and the days of the period booked by a closure (they stay). */
export interface LeaveRemovalResultDto {
  removed: number
  keptClosureDays: number
}

export interface LeaveRequestDto {
  id: number
  employeeId: number
  name: string
  startDate: IsoDate
  endDate: IsoDate
  note: string
  status: LeaveRequestStatus
  kind: LeaveRequestKind
  createdAt: string
  decidedAt: string | null
  decidedBy: string | null
  decisionNote: string
  /**
   * Leave days the range uses: the employee's working days in it (without holidays, closures and days off), 24 and 31
   * December as half a day where the home facility counts them so (can be x.5). Überstundenfrei: the working days.
   */
  workdays: number
  /** Days of the range on which more people than allowed would be on leave (open requests only). */
  overLimitDates: IsoDate[]
}

/** 24 and 31 December: a whole leave day, half a leave day, or paid free (no leave, like a public holiday for the staff). */
export const EVE_LEAVE_OPTIONS = ['whole', 'half', 'paid'] as const
export type EveLeave = (typeof EVE_LEAVE_OPTIONS)[number]

/** How the facility counts leave (Einstellungen → Dienstplan; the Träger changes it, the Leitung reads it). */
export interface LeaveCountingDto {
  /** „Wir arbeiten nach TVöD SuE“: 24 and 31 December are paid free (TVöD § 6 Abs. 3), whatever eveLeave says. */
  tvoedSue: boolean
  /** The facility's own choice for 24 and 31 December, effective while tvoedSue is off (kept while it is on). */
  eveLeave: EveLeave
  /**
   * The first year a change saved today applies to: this year until 23 December, then the next (shared/domain/eveRules.ts
   * effectiveEveYear). Set by the server (ignored in a PUT).
   */
  effectiveYear: number
  /** How 24 and 31 December count per year (the history, oldest first; ignored in a PUT). */
  rules: EveRule[]
}

/** The facility's notice on remaining leave (Einstellungen → Dienstplan; Leitung and Träger change it). */
export interface LeaveForfeitSettingsDto {
  /** Remaining leave lapses on this day of the year after (January to September). */
  day: number
  month: number
  /** The notice text with ‹Tage›, ‹Jahr›, ‹Verfall› (the default text while the facility has none of its own). */
  text: string
  isDefaultText: boolean
}

/** The notice on remaining leave an employee sees (from 1 October until the forfeiture date), placeholders filled. */
export interface LeaveForfeitNoticeDto {
  /** The year the remaining leave comes from. */
  year: number
  days: number
  forfeitDate: IsoDate
  text: string
}

export interface MyLeaveForfeitDto {
  /** Null: nothing to show (outside the window, no days left, already read for the year, no employee). */
  notice: LeaveForfeitNoticeDto | null
}

/** One person in „Hinweis auf Resturlaub ‹Jahr›“ („Urlaubsplanung“). */
export interface LeaveForfeitRowDto {
  employeeId: number
  name: string
  /** The days left as of today (after the forfeiture date: as of that day, i.e. what lapsed). */
  days: number
  /** The person's own forfeiture date when an Elternzeit moved it (§ 17 Abs. 2 BEEG); null = the facility's. */
  protectedUntil: IsoDate | null
  /**
   * read: „Gelesen“ clicked (the latest receipt still covers the notice); reopened: read, but now more days or another
   * forfeiture date/text, so it shows again; open: has an account, not read yet; no_account: no active account, tell in
   * writing.
   */
  status: 'read' | 'reopened' | 'open' | 'no_account'
  /** When „Gelesen“ was last clicked (ISO timestamp) and the days the notice named then. */
  readAt: string | null
  readDays: number | null
}

export interface LeaveForfeitListDto {
  year: number
  /** The first day the employees see the notice (1 October of the year) and the forfeiture date in the year after. */
  noticeFrom: IsoDate
  forfeitDate: IsoDate
  /** False before the window of the year (today before noticeFrom): nobody is listed yet. */
  started: boolean
  rows: LeaveForfeitRowDto[]
}

/** Module state as far as the viewer may know it. */
export interface LeaveSettingsDto {
  enabled: boolean
  maxConcurrent: number | null
  /** Accounts responsible for leave planning (only sent to managers). */
  plannerIds: number[]
  /** The viewer may see the planning page and decide requests. */
  isPlanner: boolean
  /** Open requests for the menu badge: for the chosen planners (the Träger only while nobody is chosen), else 0. */
  openCount: number
}

/** What a request would mean, shown before sending. */
export interface LeaveRequestPreviewDto {
  /** Leave days the request uses (as LeaveRequestDto.workdays). */
  workdays: number
  /** Leave days left in the start year after this request (null: no entitlement recorded, or Überstundenfrei). */
  availableAfter: number | null
  overLimitDates: IsoDate[]
  /** Überstundenfrei only: the minutes the request takes from the balance (the daily targets of its days). */
  minutesTaken?: number
  /**
   * Überstundenfrei only: the balance as of today minus this request, the person's other open Überstundenfrei requests
   * and Überstundenfrei already planned after today.
   */
  balanceAfter?: number
}

/** The planning page: year calendar of leave and open requests, people per day and the open requests. */
export interface LeavePlanningDto {
  calendar: YearCalendarDto
  /** People on leave (planned + open requests) per day. */
  counts: Record<IsoDate, number>
  maxConcurrent: number | null
  openRequests: LeaveRequestDto[]
}

/** „Alle Anträge und Urlaube“: a request status, or 'direct' = leave entered directly („direkt eingetragen“, no request). */
export type LeaveYearStatus = LeaveRequestStatus | 'direct'

/** The filters of „Alle Anträge und Urlaube“ (missing or null = all). */
export interface LeaveYearListFilter {
  employeeId?: number | null
  kind?: LeaveEntryKind | null
  status?: LeaveYearStatus | null
}

/** A request in „Alle Anträge und Urlaube“. */
export interface LeaveYearRequestDto extends LeaveRequestDto {
  /** The viewer may approve or reject it there: open, and not the own request (the Träger decides their own too). */
  canDecide: boolean
}

/**
 * One leave period of a person in „Alle Anträge und Urlaube“ and where it comes from: an approved request („Antrag
 * genehmigt am …“), entered directly in the plan or the year calendar („direkt eingetragen“), or a closure as leave.
 * Days: as the leave account counts them (closures: the leave days the closure took).
 */
export interface LeaveYearRangeDto extends LeaveEntryRange {
  origin: 'request' | 'direct' | 'closure'
  /** origin 'request': the approved request and when it was decided (ISO timestamp). */
  requestId: number | null
  decidedAt: string | null
  /** origin 'closure': the closure's name. */
  closureLabel: string | null
}

export interface LeaveYearPersonDto {
  employeeId: number
  name: string
  /** The leave account of the year (Anspruch, genommen, verplant, frei verfügbar), as „Urlaubsübersicht“ shows it. */
  account: LeaveAccount
  hasEntitlement: boolean
  /** The one-off extra days of the year with their reasons (see LeaveAccountDto.extraDays). */
  extraDays: LeaveExtraDaySummary[]
  ranges: LeaveYearRangeDto[]
}

/**
 * „Urlaubsplanung“ → „Alle Anträge und Urlaube“: the facility's requests touching the year and every person's leave
 * periods of the year, filtered on the server (see LeaveYearListFilter).
 */
export interface LeaveYearListDto {
  year: number
  /** The staff of the year, for the person filter (unfiltered). */
  employees: { id: number; name: string }[]
  requests: LeaveYearRequestDto[]
  /** With a kind or status filter only the people with periods left; without, everyone of the year. */
  people: LeaveYearPersonDto[]
}

/** A kind of mandatory appointment or proof (Pflichttermin) of a facility. */
export interface RequirementTypeDto {
  id: number
  name: string
  /** Due again every this many months (null = needed once). */
  intervalMonths: number | null
  /** The second record is due this many months after the first (null = after intervalMonths; Betriebsarzt: 12). */
  firstIntervalMonths: number | null
  /** The key of a built-in kind (BUILTIN_REQUIREMENTS, e.g. 'company_doctor'), null for the facility's own. */
  builtinKey: string | null
  sortOrder: number
}

/** One appointment kept or proof shown: the day, and an optional note. */
export interface RequirementRecordDto {
  id: number
  date: IsoDate
  note: string | null
}

export interface TrainingDto {
  id: number
  date: IsoDate
  title: string
  note: string | null
}

/** An employee's emergency contact as entered (Leitung and Träger only); name and phone are required. */
export interface EmergencyContactInput {
  name: string
  relation: string
  phone: string
  phone2: string
  note: string
}

export type EmergencyContactDto = EmergencyContactInput & { id: number }

/** One active employee with their emergency contacts in call order (print list „Notfallkontakte aller Mitarbeiter“). */
export interface EmergencyContactListRowDto {
  employeeId: number
  name: string
  contacts: EmergencyContactDto[]
}

/**
 * Whether an employee agreed that colleagues see their emergency contacts at the facility tablet. `source` says who
 * gave it ('self': in the app, 'written': the Leitung recorded a written declaration); `date` is its day. `selfOnly`:
 * the employee gave it themselves, so only they withdraw it. `earliestWrittenDate`: after a withdrawal by the employee a
 * written consent counts only with a later date (null without such a withdrawal).
 */
export interface EmergencyConsentDto {
  consent: boolean
  source: 'self' | 'written' | null
  date: IsoDate | null
  hasAccount: boolean
  selfOnly: boolean
  earliestWrittenDate: IsoDate | null
}

/** Recording a written consent needs its day (not in the future); withdrawing needs none. */
export interface EmergencyConsentInput {
  consent: boolean
  date?: IsoDate
}

/** An employee with consent and their contacts for the tablet: no note, nothing else. */
export interface TabletStaffEmergencyDto {
  employeeId: number
  name: string
  contacts: Array<{ name: string; relation: string; phone: string; phone2: string }>
}

/** A kind as it stands for one employee: the newest record counts. */
export interface EmployeeRequirementKindDto {
  type: RequirementTypeDto
  state: RequirementState
  /** Date of the newest record (null = none). */
  lastDate: IsoDate | null
  /** When the next one is due (null without a record or for a kind needed once). */
  dueOn: IsoDate | null
  /** The history, newest first. */
  records: RequirementRecordDto[]
  /**
   * Only on the follow-up examination (§ 33 JArbSchG) while its employment ban applies today (§ 33 Abs. 3: 14 months
   * after the start, under 18, no record): the ban's first day.
   */
  employmentBanFrom?: IsoDate
  /** The next Pflichttermin appointment of this kind the employee is meant for („geplant am …“; absent without one). */
  planned?: PlannedRequirementDto
}

/** A Pflichttermin appointment not yet over (its last day today or later) and not confirmed: „geplant am …“. */
export interface PlannedRequirementDto {
  eventId: number
  date: IsoDate
  endDate: IsoDate | null
}

/** Mandatory appointments (every kind of the employee's facility) and trainings (newest first) of one employee. */
export interface EmployeeRequirementsDto {
  kinds: EmployeeRequirementKindDto[]
  trainings: TrainingDto[]
}

/**
 * An employee's own view (read-only): per kind of their facility the newest date and when the next is due, and their
 * trainings, newest first. Deliberately no state (the warning is for Leitung and Träger only), no history and none of
 * the notes the Leitung typed.
 */
export interface MyRequirementsDto {
  kinds: {
    type: Pick<RequirementTypeDto, 'id' | 'name' | 'intervalMonths' | 'firstIntervalMonths'>
    lastDate: IsoDate | null
    dueOn: IsoDate | null
  }[]
  trainings: Pick<TrainingDto, 'id' | 'date' | 'title'>[]
}

/** A row of the notice for Leitung and Träger: a kind that is overdue, missing or due soon for an employee. */
export interface DueRequirementDto {
  employeeId: number
  employeeName: string
  typeId: number
  typeName: string
  state: Exclude<RequirementState, 'ok'>
  dueOn: IsoDate | null
}

/** Why a child is away on a day (child attendance). */
export type AbsenceKind = 'sick' | 'vacation' | 'excused'

/** A child's status on a day: not here yet, here, picked up, away with a kind, or unexcused (past care day, nothing entered). */
export type AttendanceStatus = 'not_yet' | 'present' | 'gone' | AbsenceKind | 'unexcused'

/** One cell of the month table: present (here or picked up), an absence kind, unexcused, or empty. */
export type MonthCell = 'present' | AbsenceKind | 'unexcused' | 'none'

/** A registered person picking a child up: one of its contacts allowed to, or a person announced for that day. */
export interface AttendanceRegisteredPickup {
  kind: 'contact' | 'announcement'
  id: number
}

/** A person neither registered nor announced, typed by hand ("Andere Person"), with whom it was agreed ("Rücksprache mit"). */
export interface AttendanceOtherPickup {
  kind: 'other'
  name: string
  confirmedWith?: string
}

/** The person picking a child up. */
export type AttendancePickupChoice = AttendanceRegisteredPickup | AttendanceOtherPickup

/** A person the "Geht" dialog offers (never one with a contact ban). */
export interface AttendancePickupOption extends AttendanceRegisteredPickup {
  name: string
}

/**
 * One stay of a child on a day; `left` null while the child is here, `pickedUpBy` the name as it was. `pickedUpOther`:
 * the person was typed by hand ("nicht hinterlegt"), `pickedUpConfirmedWith` its "Rücksprache mit" ('' = none).
 */
export interface AttendanceStayDto {
  id: number
  arrived: Minutes
  left: Minutes | null
  pickedUpBy: string | null
  pickedUpOther: boolean
  pickedUpConfirmedWith: string
}

export interface AttendanceAnnouncementDto {
  id: number
  name: string
  announcedBy: string
}

/** A row of the day list: an active child of the facility on the day. */
export interface AttendanceChildDto {
  childId: number
  /** "Nachname, Vorname". */
  name: string
  /** The name parts, for the search field of the day list. */
  firstName: string
  lastName: string
  /** The child's group on the day (null = none). */
  groupId: number | null
  /**
   * The viewer may write all of the child's day: its group on the day is the viewer's own group (or the viewer has no
   * group access). Otherwise only coming, going and announcing a pickup person are possible.
   */
  own: boolean
  /** The viewer may open the child's record (its current group is visible to the viewer); the name links to it. */
  recordReadable: boolean
  status: AttendanceStatus
  stays: AttendanceStayDto[]
  plannedPickup: Minutes | null
  broughtBy: string
  absence: AbsenceKind | null
  /** "Was ist heute passiert". */
  note: string
  /** From the record, for the info column. */
  allergies: string
  /**
   * Per meal of the day (`AttendanceDayDto.meals`, by `mealId`): counted for it (automatically or by hand); `manual` = set
   * by hand for the day.
   */
  meals: Record<number, { counted: boolean; manual: boolean }>
  /** From the record's consent "Darf mit Insektenschutz eingesprüht werden" (null = open). */
  insectRepellent: boolean | null
  announcements: AttendanceAnnouncementDto[]
  pickupOptions: AttendancePickupOption[]
  /** The end of the child's care type (the suggested planned pickup when it arrives); null without a care type. */
  careEnd: Minutes | null
  /** The names of the child's contacts without a contact ban (offered for "Bringperson"). */
  bringOptions: string[]
  /** The names of the child's contacts without "darf abholen" and without a contact ban (a hint when typed as "Andere Person"). */
  noPickupContacts: string[]
  /** The child has a contact with a contact ban; the notes are for the "Geht" dialog only, never the info column. */
  hasContactBan: boolean
  contactBanNotes: string[]
  pickupOverdue: boolean
  /** An entry of the day was changed or removed after it was made (see the history). */
  changed: boolean
  /** An open § 34 IfSG case since this day or earlier: „Kommt“ is blocked until the readmission (null = none). */
  ifsg: AttendanceIfsgDto | null
}

/**
 * The open § 34 IfSG case of a child in the day list. Whoever may not know the disease (another group's staff, readers
 * without the attendance right) gets only the block: disease, kind, texts, the earliest day and the proof are null.
 */
export interface AttendanceIfsgDto {
  caseId: number
  disease: string | null
  diseaseName: string | null
  kind: IfsgKind | null
  /** The readmission text of the kind, and the condition besides the earliest day („und symptomfrei“). */
  text: string | null
  condition: string | null
  /** The earliest readmission by the date rule (null: no rule, its date not known, or hidden). */
  earliest: IsoDate | null
  proof: IfsgProof | null
  /** The viewer may confirm the readmission (Leitung/Träger, the child's own group). */
  canReadmit: boolean
  /** The facility asks for a written attest with a medical judgement („Schriftliches Attest verlangen“). */
  requireAttest: boolean
  /**
   * § 34 forbids the visit (false: a local disease that is only a recommendation – no block, a yellow hint; the
   * disease's name is shown then as well). Always true when the disease is hidden.
   */
  binding: boolean
  /** Where the readmission comes from (null when hidden): the RKI or the local health office. */
  source: 'rki' | 'local' | null
  /** The facility's health office (name and phone, empty when not set), for the readmission rules and „Rücksprache“. */
  healthOffice: { name: string; phone: string }
  /** The case data to correct it (null when hidden): the day it was entered, onset, chosen date rule and its date. */
  reportedOn: IsoDate | null
  onsetDate: IsoDate | null
  ruleVariant: string | null
  /** The chosen date rule as the case stores it (its snapshot; it may no longer be among today's rules). */
  rule: IfsgCaseRuleDto | null
  ruleDate: IsoDate | null
  /** The day of the readmission when the shown day lies inside a ban that is over by now (a correction of an earlier day). */
  readmittedOn: IsoDate | null
}

/** A case's date rule as stored: readmission at the earliest `days` after the anchor day. */
export interface IfsgCaseRuleDto {
  anchor: IfsgAnchor
  days: number
  label: string
  condition: string
}

/** The facility's § 34 IfSG rules for the dialogs (`ifsgRulesFor`), the attest setting and the health office. */
export interface IfsgRulesDto {
  requireAttest: boolean
  diseases: IfsgDisease[]
  healthOffice: { name: string; phone: string }
}

/** The facility's § 34 IfSG setting (Leitung/Träger): the written attest and the local health office. */
export interface IfsgSettingsDto {
  requireAttest: boolean
  healthOfficeName: string
  healthOfficePhone: string
}

/**
 * A local rule as sent (Leitung/Träger): every field optional, null or left out = the RKI value; empty texts count as
 * none. `name`/`notifiable` only for a local disease.
 */
export interface IfsgLocalRuleInput {
  name?: string | null
  notifiable?: boolean | null
  text?: string | null
  rules?: IfsgLocalDateRule[] | null
  proof?: IfsgProof | null
  notify?: boolean | null
  householdText?: string | null
  householdExclusion?: boolean | null
  note?: string | null
  hint?: string | null
}

/** „Wiederzulassung (Gesundheitsamt)“: the health office and per disease the RKI, local and merged rule. */
export interface IfsgLocalRulesDto {
  healthOffice: { name: string; phone: string }
  rows: {
    key: string
    /** null for a local disease. */
    rki: IfsgDisease | null
    local: IfsgLocalRule | null
    merged: IfsgDisease
    /** What the merged rule changes against the RKI („abweichend vom RKI“); null when nothing. */
    difference: IfsgDifference | null
    /** A case of the facility uses the disease (a local disease cannot be removed then). */
    used: boolean
  }[]
}

/** A document of the local health office (the file is fetched apart, in the app only at the tablet). */
export interface IfsgDocumentDto {
  id: number
  title: string
  mimeType: string
  size: number
  uploadedAt: string
}

/** The parents' declaration („Elternerklärung“) of a case, printed by the facility. */
export interface IfsgDeclarationDto {
  caseId: number
  facilityName: string
  childName: string
  diseaseName: string
  /** 'lice': head lice – the parents confirm the treatment themselves; 'declaration': the § 34 form with the physician. */
  form: 'declaration' | 'lice'
}

/**
 * A new § 34 IfSG case of a child, entered on an attendance day (`date`, not ahead): the disease of the facility's
 * rules, a kind it allows, the onset, and optionally the date rule with the date it counts from.
 */
export interface IfsgCaseInput {
  childId: number
  date: IsoDate
  disease: string
  kind: IfsgKind
  onsetDate: IsoDate
  ruleVariant: string | null
  ruleDate: IsoDate | null
}

/**
 * A change of a case; left out = kept. The dates and the rule: Leitung/Träger and the child's own group; the
 * notification of the health office, the physician's report and closing: Leitung/Träger only.
 */
export interface IfsgCaseUpdateInput {
  onsetDate?: IsoDate
  ruleVariant?: string | null
  ruleDate?: IsoDate | null
  healthOfficeNotifiedOn?: IsoDate | null
  physicianReported?: boolean
  ended?: boolean
}

/** The readmission: its day (not ahead), a note, and the confirmation that it lies before the earliest day. */
export interface IfsgReadmitInput {
  readmittedOn: IsoDate
  note: string
  confirmEarly: boolean
}

/** A § 34 IfSG case as Leitung and Träger see it (overview, notice). */
export interface IfsgCaseDto {
  id: number
  childId: number
  /** „Vorname Nachname“. */
  childName: string
  groupName: string
  disease: string
  diseaseName: string
  kind: IfsgKind
  reportedOn: IsoDate
  onsetDate: IsoDate
  ruleVariant: string | null
  ruleDate: IsoDate | null
  earliest: IsoDate | null
  text: string
  proof: IfsgProof
  createdByName: string
  createdAt: string
  readmittedOn: IsoDate | null
  readmissionNote: string
  readmittedByName: string
  /** The attest stored as a child document (null = none, or deleted since). */
  attachmentId: number | null
  healthOfficeNotifiedOn: IsoDate | null
  physicianReported: boolean
  ended: boolean
  /** Not readmitted and not closed: „Kommt“ is blocked. */
  open: boolean
  /** The Leitung still has to notify the health office (§ 34 Abs. 6). */
  notifyDue: boolean
  /** The chosen date rule as the case stores it (see AttendanceIfsgDto.rule). */
  rule: IfsgCaseRuleDto | null
}

/** The parent notice („Aushang“) of a case: no names, the group, the disease, a short hint, the facility and the day. */
export interface IfsgNoticeDto {
  caseId: number
  facilityName: string
  groupName: string
  diseaseName: string
  hint: string
  reportedOn: IsoDate
}

export interface AttendanceCountsDto {
  present: number
  gone: number
  /** Sick, vacation, excused and unexcused. */
  absent: number
  notYet: number
  /** Per meal of the day (by `mealId`): the children counted for it. */
  meals: Record<number, number>
}

/** A row of the meal summary: one group of the day list. */
export interface AttendanceSummaryRowDto {
  /** As in `AttendanceDayDto.groups` (null = the children without group, with an empty name). */
  groupId: number | null
  name: string
  /** Children here or already gone today (status `present` or `gone`). */
  here: number
  /** Per meal of the day (by `mealId`): the group's children counted for it. */
  meals: Record<number, number>
}

export interface AttendanceDayDto {
  date: IsoDate
  /** A weekday that is no public holiday of the facility and no closure day. */
  isCareDay: boolean
  /** The meals on this date, with the name and time valid then (by time, then name); empty without meals. */
  meals: DayMeal[]
  recordBroughtBy: boolean
  counts: AttendanceCountsDto
  /** The groups of the listed children in the groups' order; `id: null` (children without group) last, with an empty name. */
  groups: { id: number | null; name: string }[]
  /** The children here and the meal counts per group, one row per entry of `groups`, in that order. */
  summary: AttendanceSummaryRowDto[]
  children: AttendanceChildDto[]
  /** Stays of the 14 days before that were never closed ("nicht ausgestempelt"). */
  openStays: { date: IsoDate; childId: number; name: string }[]
  /** Every group of the facility in the groups' order (to choose from for „Gruppen zusammenlegen“). */
  facilityGroups: { id: number; name: string }[]
  /** The groups merged right now; only for today (Berlin), empty for any other day. */
  merges: GroupMergeDto[]
  /** The viewer may write attendance (children.attendance): stamp, merge groups and end a merge. */
  canAttend: boolean
}

/** Groups merged at the edge times („Gruppen zusammenlegen“): the list shows one section of their children here now. */
export interface GroupMergeDto {
  id: number
  /** Two or more groups of the facility, in the groups' order. */
  groupIds: number[]
  /** Every listed child whose group of the day is one of them, in the facility's child order (see `mergedPresent`). */
  childIds: number[]
  createdByName: string
  createdAt: string
}

export interface GroupMergeInput {
  /** Today (Berlin); any other day is refused. */
  date: IsoDate
  groupIds: number[]
}

/** One entry of a day's history: one field, its value before and after (text, '' = empty), who and when. */
export interface AttendanceChangeDto {
  id: number
  field: string
  before: string
  after: string
  changedAt: string
  changedByName: string
}

export interface AttendanceArriveInput {
  childId: number
  date: IsoDate
  time: Minutes
  /** Required by the service (400 planned_pickup_required when missing). */
  plannedPickup?: Minutes | null
  broughtBy?: string
}

export interface AttendanceLeaveInput {
  childId: number
  date: IsoDate
  time: Minutes
  /** Required by the service (400 pickup_person_required when missing). */
  pickup?: AttendancePickupChoice | null
}

export interface AttendanceAnnouncementInput {
  childId: number
  date: IsoDate
  name: string
  announcedBy: string
}

/** An absence for every care day from `from` to `to` without a stay; `kind: null` clears it. */
export interface AttendanceAbsenceInput {
  childId: number
  from: IsoDate
  to: IsoDate
  kind: AbsenceKind | null
}

/**
 * The fields of a day to change; left out = unchanged. `meals`: ticks by `mealId` of meals on that day (400
 * meal_not_on_day otherwise), null = back to automatic; a meal left out keeps its tick.
 */
export interface AttendanceDayInput {
  childId: number
  date: IsoDate
  plannedPickup?: Minutes
  broughtBy?: string
  note?: string
  meals?: Record<number, boolean | null>
}

/** A corrected stay; a new pickup person may be given, closing an open stay needs one. */
export interface AttendanceStayInput {
  arrived: Minutes
  left: Minutes | null
  pickup?: AttendancePickupChoice
}

/** One child's row in one group of the month table; `cells` has an entry for each day of the month the child was active in that group. */
export interface AttendanceMonthChildDto {
  childId: number
  /** "Nachname, Vorname". */
  name: string
  cells: Record<IsoDate, MonthCell>
  sums: Record<Exclude<MonthCell, 'none'>, number>
  /** The free text of the child for this month ("Bemerkung"). */
  remark: string
  /** The viewer may change the remark: one of the child's groups on an active day of the month is the viewer's own. */
  remarkEditable: boolean
  /** The viewer may open the child's record (its current group is visible to the viewer); the name links to it. */
  recordReadable: boolean
}

/** The month table (spec §4): one table per group in the groups' order, children without a group last (`id: null`, empty name). */
export interface AttendanceMonthDto {
  year: number
  month: number
  /** Every day of the month; `grey` = weekend, public holiday of the facility or closure day. */
  days: { date: IsoDate; grey: boolean }[]
  groups: { id: number | null; name: string; children: AttendanceMonthChildDto[] }[]
}

export interface AttendanceMonthRemarkInput {
  childId: number
  /** YYYY-MM. */
  month: string
  remark: string
}

/** The attendance settings of a facility (spec §6); the meals are set apart (MealSettingsDto). */
export interface AttendanceSettingsDto {
  recordBroughtBy: boolean
  /** Attendance is recorded from this day on ("Anwesenheit erfasst ab"; null = not yet): only from then on is a day unexcused. */
  attendanceSince: IsoDate | null
}

/** A change of a meal that starts today or later (a new name or time, a new meal, or `removed` = gone from then on). */
export interface PlannedMealDto {
  versionId: number
  mealId: number
  validFrom: IsoDate
  name: string
  time: Minutes
  removed: boolean
  /**
   * Taking this change back leaves the meal away on `validFrom` (a new meal, or one brought back after a removal): for
   * a change of today, today's ticks of the meal are lost.
   */
  cancelRemovesMeal: boolean
}

/** The facility's meals: those of today (by time, then name) and the changes from today on (by date, then time). */
export interface MealSettingsDto {
  current: DayMeal[]
  planned: PlannedMealDto[]
}

// ---- Group book: weekly overview (Wochenübersicht) ----

/** A free text of the weekly overview with who changed it last; empty and without a person while nothing was entered. */
export interface GroupBookNoteDto {
  text: string
  updatedAt: string | null
  updatedByName: string | null
}

/** Why a day of the weekly overview is greyed: a public holiday of the facility's state (the client names it) or a closure day. */
export type GroupDayLabel = { kind: 'holiday'; key: HolidayKey } | { kind: 'closure'; label: string }

/** A group of the weekly overview's group choice with what the viewer may do there. */
export interface GroupBookGroupDto { id: number; name: string; right: 'write' | 'read' }

/** One week (Monday to Friday) of a group's weekly overview. */
export interface GroupWeekDto {
  groupId: number
  groupName: string
  facilityName: string
  /** The week's Monday. */
  weekStart: IsoDate
  weekNumber: number
  /** "Wochenthema / geplant". */
  theme: GroupBookNoteDto
  /** Monday to Friday: the day's label (holiday or closure, null on an ordinary day) and the "Was haben wir gemacht" text. */
  days: { date: IsoDate; label: GroupDayLabel | null; note: GroupBookNoteDto }[]
  canWrite: boolean
  /** The groups the viewer may see, in the facility's order. */
  groups: GroupBookGroupDto[]
}

export interface GroupBookWeekInput { groupId: number; weekStart: IsoDate; text: string }
export interface GroupBookDayInput { groupId: number; date: IsoDate; text: string }

/** One change of a weekly overview field: what it was and what it is now, who and when. */
export interface GroupBookChangeDto {
  id: number
  before: string
  after: string
  changedAt: string
  changedByName: string
}

/** One value of the staffing preset the Träger may change (see shared/domain/staffing/overrides.ts). */
export interface StaffingValueDto {
  path: string
  /** The state's value in the version valid today. */
  preset: number
  /** The value that counts: the Träger's override, else the preset. */
  value: number
  overridden: boolean
}

/** A stored override: the Träger's value and the preset value it replaced. */
export interface StaffingStoredOverrideDto {
  path: string
  value: number
  preset: number
}

/** The answer of a reset: `droppedOthers` = what was left did not fit together any more, so every override went. */
export interface StaffingResetDto extends StaffingSettingsDto {
  droppedOthers: boolean
}

/** Einstellungen → Personalschlüssel: the state's preset valid today, the Träger's overrides and the result. */
export interface StaffingSettingsDto {
  land: GermanState
  validFrom: IsoDate
  source: string
  confidence: Confidence
  note: string | null
  method: StaffingMethod
  /** false = presence rules only (HB): no monthly Soll/Ist. */
  periodCheck: boolean
  preset: StaffingRuleSet
  /** The preset with the overrides that apply to it. */
  effective: StaffingRuleSet
  /** Every value the Träger may change, in the order of the rule set. */
  values: StaffingValueDto[]
  /**
   * The overrides that apply today, by path – what PUT takes back. Stored overrides that do not apply today are only in
   * `ignored`; PUT keeps them (they may still count for earlier months) until DELETE ?path= removes them.
   */
  overrides: Record<string, number>
  /** Stored overrides the version valid today has no place for, or whose preset value the law changed since. */
  ignored: StaffingStoredOverrideDto[]
  /** Overrides that apply today but lapse with a later version of the law (to warn in advance). */
  upcomingIgnored: (StaffingStoredOverrideDto & { validFrom: IsoDate })[]
  /** Every version of the state's preset (oldest first), to show upcoming changes. */
  versions: { validFrom: IsoDate; source: string; confidence: Confidence }[]
  /** Only the Träger changes the values; the Leitung reads them. */
  canEdit: boolean
}

/** The figures of one row of the Personalschlüssel tab (a group, the row without a group, or the facility total). */
export interface StaffingFiguresDto {
  /** Contract children counted in the month as the Belegung counts them; `u3` = under 3 on the month's first day. */
  children: { total: number; u3: number }
  /** Soll: required full-time positions (sum of the counting lines) with every line, shown-only ones (Leitung) included. */
  required: { fte: number; demandFte: number; fachkraftFte: number; lines: RequirementLine[] }
  /**
   * Ist: planned full-time positions of the month (planned working hours on care days × counting share); all null in a
   * presence-only state (HB), where there is nothing to compare.
   */
  planned: { fte: number | null; fachkraftFte: number | null; unqualifiedFte: number | null }
  /** Ist − Soll; null in a presence-only state. */
  diff: number | null
  /** Ist reaches Soll (tie-safe); null = nothing to check (presence-only state, or no care day in the month). */
  ok: boolean | null
  quotas: QuotaLine[]
  /** Children no demand row matched (e.g. the group type is missing). */
  unmatchedChildren: number
  /** Names of the planned staff without a qualification (counted at their share, never as Fachkraft), sorted. */
  staffWithoutQualification: string[]
  /** Children without a care type: they do not count for the Soll. */
  childrenWithoutCareType: number
}

export interface StaffingRowDto extends StaffingFiguresDto {
  /** null = the children and duties without a group (only listed when there are some). */
  groupId: number | null
  /** The group's name; empty for the row without a group (the client labels it). */
  name: string
  groupType: string | null
}

/** The Personalschlüssel tab of a month: per group, the facility total and the state's rules that applied. */
export interface StaffingMonthDto {
  year: number
  month: number
  groups: StaffingRowDto[]
  total: StaffingFiguresDto
  meta: {
    land: GermanState
    /** The version of the state's preset valid on the month's first day. */
    validFrom: IsoDate
    source: string
    confidence: Confidence
    note: string | null
    /** false = presence rules only (HB): no Soll/Ist. */
    periodCheck: boolean
    fteHoursPerWeek: number
    /** Care days of the month (weekdays without public holidays and closures); weeks = careDays ÷ 5. */
    careDays: number
    weeks: number
    /**
     * None of the facility's employees has a qualification entered: the plan shows no staffing warnings yet and the tab
     * asks „Bitte Qualifikationen eintragen“.
     */
    qualificationsMissing: boolean
  }
}

/** Why no staffing estimate can be computed for a group (see server/services/staffingEstimate.ts). */
export type StaffingEstimateReason = 'no_group_type' | 'unknown_group_type' | 'no_capacity' | 'no_opening_hours'

/** A presence rule of the state that applies to the group type, as plain data for the sentence in the settings. */
export interface StaffingEstimatePresenceDto {
  window: 'haupt' | 'rand' | 'always'
  minStaff: number | null
  minFachkraft: number | null
  /** Only from this many children present (null = from the first child). */
  minChildren: number | null
  /** Per started block of `children` children: `staff` staff, of them `fachkraft` Fachkräfte. */
  perChildren: { children: number; staff: number; fachkraft: number | null } | null
}

/** What the estimate at full occupancy assumed (to state it under the figures). */
export interface StaffingEstimateAssumptionsDto {
  /** Assumed children = the places. */
  children: number
  /**
   * Of them under 3: all in a group type for under-3s; in a group with children under 3 now one (group methods) or as many
   * as now (per-child methods, at most the places).
   */
  u3: number
  /** Of them school children (a group for school children or a Hort group type). */
  school: number
  /** Weekly hours per place: average opening per day × 5 (null = not needed and not known). */
  weeklyHoursPerChild: number | null
  /** Where the hours come from: the entered opening hours, the state's reference hours of the group type, or none. */
  hoursSource: 'opening' | 'reference' | 'none'
}

/** The Personalschlüssel of one group if all its places were taken (planning help). */
export interface StaffingEstimateDto {
  groupType: string | null
  /** The state's name of the group type (null without one, or a type the state does not know). */
  groupTypeLabel: string | null
  capacity: number | null
  /** Why nothing could be computed; null = computed (or a presence-only state, see periodCheck). */
  reason: StaffingEstimateReason | null
  /** false = the state has presence rules only (HB): no FTE, only the presence rules. */
  periodCheck: boolean
  /** Required full-time positions (counting lines); null when not computed. */
  fte: number | null
  /** fte × the state's weekly hours of a full-time position. */
  hoursPerWeek: number | null
  /** Fachkraft FTE demanded by the state's rows (NW); 0 if none. */
  fachkraftFte: number
  /** Every line (Grundbedarf, surcharges; shown-only ones such as Leitungszeit with counts false). */
  lines: RequirementLine[]
  /** FTE if one of the children were under 3, when that changes the result and none was assumed (BW „mit U3“). */
  withU3Fte: number | null
  /** Assumed children no row of the state matched (e.g. school children where the state has no values). */
  unmatchedChildren: number
  assumptions: StaffingEstimateAssumptionsDto | null
  presence: StaffingEstimatePresenceDto[]
}

/** The figures of the current month's Personalschlüssel tab (Soll from the enrolled children). */
export interface StaffingEstimateCurrentDto {
  children: number
  u3: number
  fte: number
}

export interface StaffingEstimateGroupDto extends StaffingEstimateDto {
  /** null = a group not created yet (the preview). */
  groupId: number | null
  name: string
  /** This month's Soll of the group; null in a presence-only state, for a group not created yet, or for a viewer without plan.staffing. */
  current: StaffingEstimateCurrentDto | null
}

/** The facility at full occupancy: the groups with an estimate plus the facility's surcharges (Leitung). */
export interface StaffingEstimateFacilityDto {
  periodCheck: boolean
  /** Groups with an estimate (counted for the facility surcharges) and groups without one. */
  groupCount: number
  groupsWithout: number
  /** null = no group with an estimate (or a presence-only state). */
  fte: number | null
  hoursPerWeek: number | null
  /** The groups' lines summed by key, then the facility lines; shown-only lines (Leitung) have counts false. */
  lines: RequirementLine[]
  /** This month's Soll of the facility (Personalschlüssel tab); null in a presence-only state or for a viewer without plan.staffing. */
  current: StaffingEstimateCurrentDto | null
}

/** GET /api/staffing/estimate: every group of the facility and the facility at full occupancy. */
export interface StaffingEstimatesDto {
  land: GermanState
  fteHoursPerWeek: number
  confidence: Confidence
  groups: StaffingEstimateGroupDto[]
  facility: StaffingEstimateFacilityDto
}

/** GET /api/staffing/estimate/preview: one group with the given type and places, and the facility with it. */
export interface StaffingEstimatePreviewDto {
  land: GermanState
  fteHoursPerWeek: number
  confidence: Confidence
  group: StaffingEstimateGroupDto
  facility: StaffingEstimateFacilityDto
}

/** A cash book (Kasse) of the facility or one of its groups; amounts in cents. */
export interface CashBoxInfoDto {
  id: number
  name: string
  kind: CashKind
  /** null = the whole facility („Einrichtung“). */
  groupId: number | null
  groupName: string | null
  startYear: number
  startMonth: number
  startBalance: number
  /** Archiviert: readable and printable, but no new or changed entries. */
  archived: boolean
  sortOrder: number
}

/** A box in the overview, with its state today. */
export interface CashBoxDto extends CashBoxInfoDto {
  /** Start balance plus all entries up to today. */
  balanceToday: number
  /** The latest closed month („abgeschlossen bis …“), null while none is closed. */
  closedThrough: YearMonth | null
  /** An expense (not a transfer) without receipt dated after the closed months. */
  missingReceipts: boolean
  /** Whether the box has entries (then it can only be archived, not deleted). */
  hasEntries: boolean
  /** No entries and no log lines beyond the box's own (the rule of deleting a box); otherwise it can only be archived. */
  canDelete: boolean
  /**
   * First day an archived box may be deleted for good („Endgültig löschen“): 1 January after the facility's cash
   * period following the year of the last entry or a later log line, such as a correction (without entries: of the
   * last log line or closed month); null
   * without entries and history (deletable at any time).
   */
  deletableFrom: IsoDate | null
}

/** A box's audit log line; `action` is a key (box_created, entry_updated …), `detail` the German text. */
export interface CashLogDto {
  id: number
  at: string
  actor: string
  action: string
  detail: string
}

/** The other side of a transfer row, and the user's text without the „Umbuchung an/von …: “ prefix. */
export interface CashTransferInfo {
  otherBoxId: number
  otherBoxName: string
  text: string
}

export type CashMonthRowDto = CashSheetRow & { receiptId: number | null; transfer: CashTransferInfo | null }

/** One month's sheet of a box (Kassenblatt). */
export interface CashMonthDto {
  box: CashBoxInfoDto
  year: number
  month: number
  opening: number
  income: number
  expense: number
  closing: number
  /** Cash boxes only: a day of the month ended below 0. */
  negative: boolean
  rows: CashMonthRowDto[]
  closed: { at: string; by: string } | null
  /** The box's log lines about this month (entries dated in it, its closing/reopening), plus box-level lines written in it; oldest first. */
  log: CashLogDto[]
}

/** A form template („Bogen“-Vorlage) of the facility, with its content (sections and items with stable ids). */
export interface FormTemplateDto {
  id: number
  kind: FormKind
  /** Whom an accident template's forms are about; null for the other kinds. */
  subject: FormSubject | null
  /** 'u1000': its forms print in the layout of the official Unfallanzeige (the starter and its copies). */
  printLayout: 'u1000' | null
  name: string
  /** Set for the app's starter templates (e.g. 'staff_self_assessment'), null for the facility's own and for copies. */
  starterKey: string | null
  /** Filled in by the employee (Selbstbeurteilung); only staff templates. */
  selfAssessment: boolean
  /** Stillgelegt: offered for no new forms, existing forms stay readable. */
  archived: boolean
  sortOrder: number
  content: FormContent
  updatedAt: string
  /** Name at the last change ('' for a starter template nobody changed yet). */
  updatedBy: string
  /** Forms were made from it (then it can only be archived, not deleted). */
  inUse: boolean
  /**
   * The facility's category of „Vorlagen“ it is filed in (template_categories, shared with the PDF templates; the top
   * one; null = none) and its subcategory (null = directly in it).
   */
  categoryId: number | null
  subcategoryId: number | null
  /** „Kategorie › Unterkategorie“; null without a category. */
  category: string | null
}

export type TalkFormRole = 'self' | 'assessment'
export type FormState = 'draft' | 'released' | 'submitted'

/**
 * A form of a staff talk: its own copy of the template content and the answers. `self` forms go draft → released
 * (the employee fills it in) → submitted; `readReleased` shows an assessment to the employee (read-only).
 */
export interface TalkFormDto {
  id: number
  role: TalkFormRole
  title: string
  content: FormContent
  answers: FormAnswers
  state: FormState
  readReleased: boolean
  updatedAt: string
  /** Name at the last change of the answers. */
  updatedBy: string
  /** Self form: when it was released to the employee (null while in draft). */
  releasedAt: string | null
  /** Self form: when the employee submitted it („abgegeben am“; null unless submitted). */
  submittedAt: string | null
  /** Assessment: when it was released to read („zum Lesen freigegeben am“; null unless released). */
  readReleasedAt: string | null
  /** Per item ever changed (not by the copy): the last change („geändert am … von …“). */
  itemChanges: Record<string, ItemChange>
  /** Items still as copied from the earlier talk („übernommen aus dem Gespräch vom …“): answered, never changed since. */
  carriedOver: string[]
  /**
   * A copy made by „Für ein weiteres Gespräch verwenden“: the form it came from (null once that form was deleted) and
   * the date of its talk; null for any other form. The employee gets all three only on their own self-assessment.
   */
  source: { formId: number | null; talkDate: IsoDate } | null
}

/** The viewer's right on a child observation form: fill it in, or only read it. */
export type ChildFormAccess = 'read' | 'edit'

/** A child observation form („Beobachtungsbogen“) in the child's list, with the viewer's right on it. */
export interface ChildFormListItemDto {
  id: number
  childId: number
  /** The template it was made from (null once that template was deleted or the child moved facility). */
  templateId: number | null
  /** The template's name when the form was made. */
  title: string
  date: IsoDate
  start: Minutes | null
  participants: string
  /** The parent meeting it was filled for (null = none, or the meeting was deleted). */
  parentMeetingId: number | null
  updatedAt: string
  /** Name at the last change. */
  updatedBy: string
  right: ChildFormAccess
  /** Leitung/Träger: may unlock employees for the form and delete it. */
  canManage: boolean
  /** A form of the info visit the child was taken over from (kind `info`): read only in the record. */
  infoVisit?: true
}

/**
 * The child's forms, newest first, and whether the viewer may start a new one (managers, the key educator at the tablet);
 * `templates` are the facility's active child templates to start one from (empty unless `canCreate`).
 */
export interface ChildFormsDto {
  forms: ChildFormListItemDto[]
  canCreate: boolean
  templates: TemplateChoice[]
}

/** One child form with its own copy of the template content, the answers and what the printout's header needs. */
export interface ChildFormDto extends ChildFormListItemDto {
  content: FormContent
  answers: FormAnswers
  child: { firstName: string; lastName: string; birthDate: IsoDate; groupName: string | null }
  facilityName: string
  /** Per item ever changed since the history began: the last change („geändert am … von …“). */
  itemChanges: Record<string, ItemChange>
  /** The items changed since the viewer last opened the form (none when they open it for the first time). */
  changedSinceSeen: string[]
}

/** One save in „Verlauf“ of a child form: when, by whom, how many items it changed; `initial`: the state before the history. */
export interface FormRevisionListItemDto {
  id: number
  savedAt: string
  savedBy: string
  changedCount: number
  initial: boolean
}

/** A page of „Verlauf“, newest first: `total` revisions in all, this page from `offset` on, `pageSize` per page. */
export interface FormRevisionsDto {
  revisions: FormRevisionListItemDto[]
  total: number
  offset: number
  pageSize: number
}

/** One stored state („Stand vom …“): the answers after that save and the items it changed. */
export interface FormRevisionDto extends FormRevisionListItemDto {
  answers: FormAnswers
  changedItemIds: string[]
}

/** A new child form: from a template with its header, or from a parent meeting (header copied from the meeting). */
export type ChildFormInput =
  | { templateId: number; date: string; start: number | null; participants: string; parentMeetingId?: undefined }
  | { templateId: number; parentMeetingId: number }

/** Saving a child form: the header fields and all answers, with the `updatedAt` the saver had loaded. */
export interface ChildFormSaveInput {
  date: string
  start: number | null
  participants: string
  answers: unknown
  expectedUpdatedAt: string
}

/** The answer to saving a child form: the new last change. */
export type ChildFormSavedDto = Pick<ChildFormListItemDto, 'updatedAt' | 'updatedBy'>

/**
 * An accident report („Unfallbericht“ about a child, „Unfallanzeige“ about an employee) in a list, with its fixed header
 * and what the viewer may do with it.
 */
export interface AccidentListItemDto {
  id: number
  subject: FormSubject
  /** The child (subject child) or the employee (subject employee); the other one is null. */
  childId: number | null
  employeeId: number | null
  /** The child's first and last name, or the employee's name. */
  personName: string
  /** The template it was made from (null once that template is gone or the person moved facility). */
  templateId: number | null
  /** The template's name when the form was made. */
  title: string
  date: IsoDate
  start: Minutes | null
  /** „Arztbesuch“. */
  doctor: boolean
  /** „arbeitsunfähig“ (employees only; always false for a child). */
  unfit: boolean
  /** „an Unfallkasse gemeldet am“ (null = not yet). */
  reportedOn: IsoDate | null
  /** 'u1000': printed in the layout of the official Unfallanzeige. */
  printLayout: 'u1000' | null
  updatedAt: string
  /** Name at the last change. */
  updatedBy: string
  /** 'edit' also needs: for anybody but Leitung/Träger the report is not yet reported to the Unfallkasse. */
  right: 'read' | 'edit'
  /** Leitung/Träger (accidents.manage) delete reports; nobody deletes one of an archived child record. */
  canDelete: boolean
  /** Leitung/Träger (accidents.manage) set „an Unfallkasse gemeldet am“; for everybody else the field is read-only. */
  canReport: boolean
}

/** The accident reports of one person, newest first; whether the viewer may fill in a new one and from which templates. */
export interface AccidentsDto {
  forms: AccidentListItemDto[]
  canCreate: boolean
  templates: TemplateChoice[]
}

/** A file attached to an accident report (photo, PDF). */
export interface AccidentAttachmentDto {
  id: number
  fileName: string
  mimeType: string
  size: number
  uploadedAt: string
  uploadedByName: string
  /** The uploader and Leitung/Träger remove it (where the report may be changed). */
  canDelete: boolean
}

/** One accident report with its own copy of the template content, the answers, the attachments and the printout's header. */
export interface AccidentFormDto extends AccidentListItemDto {
  content: FormContent
  answers: FormAnswers
  attachments: AccidentAttachmentDto[]
  /** The person for the header; the birth date only where the viewer may read it (null otherwise or not stored). */
  person: { name: string; birthDate: IsoDate | null; groupName: string | null }
  facilityName: string
}

/** The fixed header of an accident report; the service checks it (date valid and not in the future …). */
export interface AccidentHeaderInput {
  date: string
  start: number | null
  doctor: boolean
  unfit: boolean
  reportedOn: string | null
}

/** A new accident report from an active accident template of the person's subject, with its header. */
export interface AccidentCreateInput extends AccidentHeaderInput {
  templateId: number
}

/** Saving an accident report: the header and all answers, with the `updatedAt` the saver had loaded. */
export interface AccidentSaveInput extends AccidentHeaderInput {
  answers: unknown
  expectedUpdatedAt: string
}

/** The answer to saving an accident report: the new last change. */
export type AccidentSavedDto = Pick<AccidentListItemDto, 'updatedAt' | 'updatedBy'>

/** An employee unlocked to edit one child form at the tablet. */
export interface ChildFormEditorDto {
  employeeId: number
  name: string
  grantedAt: string
  grantedBy: string
}

/** A team meeting is written while `draft`; once Leitung/Träger released it, it is locked until they reopen it. */
export type TeamMeetingState = 'draft' | 'released'

/**
 * A participant chosen from the staff, with the name at the time of choosing (`employeeId` null once the employee was
 * deleted for good) and their confirmation of the released minutes (null = not yet signed).
 */
export interface TeamMeetingSignerDto {
  employeeId: number | null
  name: string
  signedAt: string | null
  signedVia: 'account' | 'tablet' | null
  /** The employee left before today, so they can no longer sign (false once deleted for good: `employeeId` null). */
  left: boolean
}

/** A team meeting (Teamsitzung) in the facility's list. Names (createdBy …) are the names at the time. */
export interface TeamMeetingListItemDto {
  id: number
  /** The template it was made from (null once that template was deleted). */
  templateId: number | null
  /** The template's name when the meeting was made. */
  title: string
  date: IsoDate
  start: Minutes | null
  /** The group it was held for (null = the whole facility). */
  groupId: number | null
  groupName: string | null
  /** Further participants as typed (they do not sign). */
  participants: string
  /** The participants chosen from the staff, in their order. */
  signers: TeamMeetingSignerDto[]
  /** The meeting is released and the member's own employee is a participant who has not signed yet. */
  mineOpen: boolean
  /** Protokollführung. */
  recorder: string
  state: TeamMeetingState
  releasedAt: string | null
  releasedBy: string | null
  /** The last reopening („wieder geöffnet“) with its reason; null when never reopened. */
  reopenReason: string | null
  reopenedAt: string | null
  reopenedBy: string | null
  createdAt: string
  createdBy: string
  /** The minutes' last change („zuletzt geändert von … am …“); the next save sends it as expectedUpdatedAt. */
  updatedAt: string
  updatedBy: string
}

/**
 * The facility's team meetings of a year, newest first; the active team templates, the groups and the staff (not left,
 * in the staff list's order) to choose from (the tablet and staff cannot read the template list); `canManage`:
 * Leitung/Träger, who release, reopen and delete. `toSign`: the released meetings of any year the member still has to
 * sign, with the oldest (none at the tablet or without an employee).
 */
export interface TeamMeetingsDto {
  meetings: TeamMeetingListItemDto[]
  templates: TemplateChoice[]
  groups: { id: number; name: string }[]
  staff: { id: number; name: string; shortName: string }[]
  toSign: { count: number; firstId: number | null }
  canManage: boolean
}

/**
 * Who reads a note („Sichtbar für“): the levels and viewer rule of the print-template categories
 * (shared/domain/templateCategories.ts) — everyone of the facility and the tablet, only Leitung and Träger, or only the
 * Träger. A writer chooses only a level they see.
 */
export type NoteVisibility = TemplateVisibility

/**
 * A note of the facility (Notizen), optionally until `validUntil`, for the whole facility (`groupId` null) or a group;
 * `canEdit`: the reader may change and delete it (notes.write for the facility, or for the note's group as the own
 * group). `visibility` („Sichtbar für“): who reads it (NoteVisibility).
 */
export interface NoteDto {
  id: number
  groupId: number | null
  groupName: string | null
  validUntil: IsoDate | null
  text: string
  visibility: NoteVisibility
  createdAt: string
  createdBy: string
  updatedAt: string | null
  updatedBy: string | null
  canEdit: boolean
}

/**
 * The page „Notizen“ (filtered by group and search): `current` the notes that apply (no „gilt bis“ or from today on),
 * `expired` those with „gilt bis“ before today, each newest first. `groups`: the facility's groups for the filter and
 * the form. `write`: null without notes.write (and at the tablet); `facility` for every note of the facility, else
 * only for the own group `groupId` (null: none); `visibilities` the levels „Sichtbar für“ the writer may choose.
 */
export interface NotesDto {
  current: NoteDto[]
  expired: NoteDto[]
  groups: { id: number; name: string; color: GroupColor | null }[]
  write: { facility: boolean; groupId: number | null; visibilities: NoteVisibility[] } | null
}

/**
 * A new or changed note; checked by the service (text, „gilt bis“, group, „Sichtbar für“). Without `visibility` a new
 * note is for all and a change keeps the stored level.
 */
export interface NoteInput {
  groupId: number | null
  validUntil: string | null
  text: string
  visibility?: NoteVisibility
}

/**
 * One team meeting with its own copy of the template content, the answers, the printout's facility name and the
 * facility's groups and staff to choose from in the header (the staff with those already chosen, even if they left).
 */
export interface TeamMeetingDto extends TeamMeetingListItemDto {
  content: FormContent
  answers: FormAnswers
  facilityName: string
  groups: { id: number; name: string }[]
  staff: { id: number; name: string; shortName: string }[]
  canManage: boolean
}

/** The header of a team meeting; `participantIds`: the employees chosen as participants, in the order shown. */
export interface TeamMeetingHeader {
  date: string
  start: number | null
  groupId: number | null
  participants: string
  recorder: string
  participantIds: number[]
}

/** A new team meeting from an active team template of the facility. */
export interface TeamMeetingInput extends TeamMeetingHeader {
  templateId: number
}

/** Saving a team meeting: the header and all answers, with the `updatedAt` the saver had loaded. */
export interface TeamMeetingSaveInput extends TeamMeetingHeader {
  answers: unknown
  expectedUpdatedAt: string
}

/** The answer to saving a team meeting: the new last change. */
export type TeamMeetingSavedDto = Pick<TeamMeetingListItemDto, 'updatedAt' | 'updatedBy'>

/** The answer to saving a form's answers: the new last change (the next save sends `updatedAt` as expectedUpdatedAt). */
export type FormSavedDto = Pick<TalkFormDto, 'updatedAt' | 'updatedBy' | 'releasedAt' | 'submittedAt' | 'readReleasedAt'>

/** A step of a BEM process: a talk (date, participants, notes), a measure (date, text, status) or a note. */
export interface BemStepDto {
  id: number
  kind: BemStepKind
  date: IsoDate
  participants: string
  text: string
  /** Only for a measure; null for a talk or a note. */
  status: BemMeasureStatus | null
}

/** A BEM process (§ 167 Abs. 2 SGB IX) with its steps, oldest step first. */
export interface BemProcessDto {
  id: number
  status: BemStatus
  /** The day it was started („BEM einleiten“) and by whom (name). */
  createdOn: IsoDate
  createdBy: string
  /** „Verschickt am“ (null = the invitation has not been sent yet). */
  invitedOn: IsoDate | null
  /** The day of the answer, or of „keine Antwort“. */
  answeredOn: IsoDate | null
  /** The day it ended: completed, declined, no answer or consent withdrawn. */
  completedOn: IsoDate | null
  steps: BemStepDto[]
}

/** The sick working days counted for the BEM (only „Krank“, on working days, in the window). */
export interface BemSickDaysDto {
  days: number
  /** More than this many is more than 6 weeks (6 × the working days per week valid today). */
  limit: number
  workdaysPerWeek: number
  from: IsoDate
  to: IsoDate
  /** The end of the last BEM when counting starts after it (later than the rolling 12 months); null otherwise. */
  restartAfter: IsoDate | null
}

/** The BEM part of the employee page (employees.sickness): the count, the running process and the earlier ones. */
export interface EmployeeBemDto {
  sickDays: BemSickDaysDto
  open: BemProcessDto | null
  /** Ended processes, newest first (read-only). */
  history: BemProcessDto[]
}

/** The invitation to print: the facility's letterhead, the employee's name and address, the letter's date and text. */
export interface BemInvitationDto {
  /** The letterhead from Kontakt: name, Träger (the employer), address, phone ('' when not set). */
  facility: { name: string; operator: string; street: string; postalCode: string; city: string; phone: string }
  /** Contact person for questions and sender: the Leitung from Kontakt, otherwise whoever prints; the phone for questions. */
  contact: { name: string; phone: string }
  /** The address only when stored and the viewer may read personal data (employees.personal); '' otherwise. */
  employee: { name: string; street: string; postalCode: string; city: string }
  /** The letter's date: „Verschickt am“ when entered, otherwise today. */
  date: IsoDate
  answerBy: IsoDate
  /** The invitation text with the placeholders filled in. */
  text: string
}

/** The facility's BEM invitation text (Leitung and Träger). */
export interface BemSettingsDto {
  /** The text with ‹Name›, ‹Antwort bis›, ‹Jahre› (the default text while the facility has none of its own). */
  text: string
  isDefaultText: boolean
}

/** A staff talk (Mitarbeitergespräch) with its forms in their order; `start` in minutes after midnight (null = no time). */
export interface StaffTalkDto {
  id: number
  employeeId: number
  date: IsoDate
  start: Minutes | null
  participants: string
  period: string
  forms: TalkFormDto[]
}

/** The talk header as the employee sees it. */
export interface MyTalkHeaderDto {
  id: number
  date: IsoDate
  start: Minutes | null
  participants: string
  period: string
}

/**
 * A talk of the signed-in employee with only the forms visible to them: self forms released or submitted, assessments
 * released to read.
 */
export interface MyTalkDto extends MyTalkHeaderDto {
  forms: TalkFormDto[]
}

/**
 * One form of a talk with what its printout's header needs: the employee's own (they may edit it while `state` is
 * 'released' and `role` 'self'), or for Leitung and Träger any form of the facility's talks.
 */
export interface MyTalkFormDto {
  talk: MyTalkHeaderDto
  form: TalkFormDto
  employeeName: string
  facilityName: string
}

/** A Mutterschutz case (MuSchG) of an employee, as the employee page shows it (employees.sickness, never the own one). */
export interface MaternityCaseDto {
  id: number
  notifiedOn: IsoDate
  expectedBirth: IsoDate
  actualBirth: IsoDate | null
  extendedAfter: boolean
  breastfeedingUntil: IsoDate | null
  authorityNotifiedOn: IsoDate | null
  riskAssessmentOn: IsoDate | null
  employmentBan: EmploymentBanKind
  banFrom: IsoDate | null
  banTo: IsoDate | null
  banNote: string
  banCheckedOn: IsoDate | null
  /** „Schutzfristen eintragen“ / „Beschäftigungsverbot eintragen“ was used: a change of the dates books the plan again. */
  protectionBooked: boolean
  banBooked: boolean
  /** Booked days no longer match the case (it was saved without plan.edit): „Dienstplan muss noch angepasst werden“. */
  planOutdated: boolean
  endedOn: IsoDate | null
  /** A miscarriage (§ 3 Abs. 5 MuSchG): its day, the week of pregnancy, whether the employee declined the protection. */
  miscarriageOn: IsoDate | null
  miscarriageWeek: number | null
  miscarriageWaived: boolean
  createdOn: IsoDate
  createdBy: string
}

/** The section „Mutterschutz“ of the employee page: the cases, newest first, and whether the viewer may book the plan. */
export interface EmployeeMaternityDto {
  cases: MaternityCaseDto[]
  /** plan.edit: „Schutzfristen eintragen“ and „Beschäftigungsverbot eintragen“ write the plan. */
  canBook: boolean
}

/** Gefährdungsbeurteilung (§ 10 MuSchG), Meldung an die Aufsichtsbehörde (§ 27), Beschäftigungsverbot prüfen. */
export type MaternityTask = 'riskAssessment' | 'authority' | 'banCheck' | 'planSync'

/** What a case's fields are when saved. */
export interface MaternityCaseInput {
  notifiedOn: IsoDate
  expectedBirth: IsoDate
  actualBirth: IsoDate | null
  extendedAfter: boolean
  breastfeedingUntil: IsoDate | null
  authorityNotifiedOn: IsoDate | null
  riskAssessmentOn: IsoDate | null
  employmentBan: EmploymentBanKind
  banFrom: IsoDate | null
  banTo: IsoDate | null
  banNote: string
  endedOn: IsoDate | null
  miscarriageOn?: IsoDate | null
  miscarriageWeek?: number | null
  miscarriageWaived?: boolean
}

/** What booking (or booking again) the plan did. */
export interface MaternityBookingDto {
  /** Days written with the code. */
  booked: number
  /** Days whose entry of the code was removed (no longer in the period). */
  removed: number
  /** Days kept because another full-day absence holds them (Krank, Urlaub …). */
  keptAbsences: number
  /** Booking again: days with duties on new days before the birth, left as they were. */
  skippedOccupied: number
  /** Booking again: days with duties in the period after the birth (or on a ban day), left in the plan – they must go. */
  protectedDuties: number
  /** „… eintragen“ with confirmation: leave days replaced in the period (given back, § 24 MuSchG). */
  returnedLeave: number
  /** Booking again: leave days on new days of the period, left as they were (give back with „… eintragen“). */
  keptLeave: number
}

/**
 * A long absence on the employee page (server/services/longAbsence.ts): entered (`source` 'entry': Langzeitkrank,
 * Kur/Reha, Sonstiges) or taken over from the Mutterschutz booked in the plan and from a full Elternzeit (changed there).
 */
export interface LongAbsenceDto {
  /** The entry's id; null for a period taken over. */
  id: number | null
  source: 'entry' | 'maternity' | 'parentalLeave'
  reason: LongAbsenceReason
  start: IsoDate
  /** null = „bis auf Weiteres“. */
  end: IsoDate | null
  /** The first working day after a known end (no public holiday, no closure, no further long absence); null otherwise. */
  returnDay: IsoDate | null
  /** Who entered it and when (entries only). */
  createdBy: string | null
  createdOn: IsoDate | null
  /** What the plan still holds in the period (entries only; null for a period taken over). */
  conflicts: LongAbsenceConflictsDto | null
}

/**
 * What stands in the way of an entered long absence: duties still planned (removable unless stamped), leave entries
 * (Urlaub, Sonderurlaub, Überstundenfrei – on days of Langzeitkrank/Kur they use no leave, § 9 BUrlG), open leave
 * requests overlapping it, and the days of the period with time records (their stamped time does not count).
 */
export interface LongAbsenceConflictsDto {
  duties: LongAbsenceDutyDto[]
  leave: { date: IsoDate; label: string }[]
  openRequests: { from: IsoDate; to: IsoDate; kind: 'vacation' | 'overtime_off' }[]
  stampedDays: number
}

/** The section „Längere Abwesenheit“ (tab „Gesundheit“, employees.sickness). */
export interface EmployeeLongAbsenceDto {
  items: LongAbsenceDto[]
  /** Duties still planned in a period can be removed here (plan.edit). */
  canRemoveDuties: boolean
}

export interface LongAbsenceInput {
  reason: StoredLongAbsenceReason
  start: IsoDate
  /** null = „bis auf Weiteres“. */
  end: IsoDate | null
}

/** A duty still planned in a long absence (shift, special shift, VZ, Büro …; this facility's plan only). */
export interface LongAbsenceDutyDto {
  id: number
  date: IsoDate
  label: string
  /** The day has time records: the duty is never removed by „Dienste entfernen“ (it stays, the Leitung decides). */
  stamped: boolean
}

/** Saving: the id and what the plan still holds in the period (nothing is changed or deleted silently). */
export interface LongAbsenceSaveDto extends LongAbsenceConflictsDto {
  id: number
}

/** Saving a case: its id and, when the plan was booked before and the period changed, what booking again did. */
export interface MaternitySaveDto {
  id: number
  protection: MaternityBookingDto | null
  ban: MaternityBookingDto | null
  /** The booked plan no longer matches (saved without plan.edit): „Dienstplan muss noch angepasst werden“. */
  planOutdated: boolean
}

/**
 * A category of the facility's address book („Kontakte“), in the facility's order. `contactCount`: the contacts the
 * viewer sees in it (the facility's own and those for all facilities filed under its name); `ownCount`: the facility's
 * own contacts in it, while there are any it cannot be deleted (only for whoever maintains the contacts, else 0).
 * `visibility`: „Wer sieht sie?“ (only categories the viewer sees are listed).
 */
export interface ContactCategoryDto {
  id: number
  name: string
  visibility: TemplateVisibility
  contactCount: number
  ownCount: number
}

/** A category's name and „Wer sieht sie?“ (left out: 'all' for a new one, unchanged for an existing one). */
export interface ContactCategoryInput {
  name: string
  visibility?: TemplateVisibility
}

/**
 * What Leitung or Träger enter about a contact, with „Gilt für“ (shared/domain/documentTargets.ts): left out on create =
 * the facility's own, left out on a change = as it is; 'all' / 'selected' are the Träger's.
 */
export interface ContactInput extends DocumentTargetsInput, CategoryAdoptInput {
  /** A contact of the facility: one of the facility's categories. */
  categoryId?: number | null
  /** A contact of the Träger (all or the chosen facilities): the category name it shows under in each facility (else „Vom Träger“). */
  categoryName?: string | null
  organisation: string
  person: string
  role: string
  phone: string
  mobile: string
  email: string
  street: string
  postalCode: string
  city: string
  website: string
  note: string
  /** „Wer sieht ihn?“ on top of the category's „Wer sieht sie?“ (the stricter wins); 'provider' only for the Träger. */
  visibility: TemplateVisibility
}

/** A contact as the viewer sees it, placed in the facility's categories. */
export interface ContactDto extends Omit<ContactInput, 'scope' | 'facilityIds' | 'groupTargets' | 'createCategories' | 'categoryId' | 'categoryName'> {
  id: number
  /** The facility's category it shows in; null = „Vom Träger“ (for all facilities, no category of its name). */
  categoryId: number | null
  /** Of the Träger (for all or the chosen facilities, only the Träger changes it). */
  global: boolean
  /** For all facilities, also later ones (the Träger's; otherwise for its own facility or the facilities chosen). */
  allFacilities: boolean
  /** „Gilt für“, for whoever maintains the contacts (null for everyone else). */
  targets: DocumentTargetsDto | null
  /** A contact for all facilities: the category name the Träger chose (null for a facility's own). */
  globalCategoryName: string | null
  /** When it was changed last; '' for whoever does not maintain the contacts (contacts.manage). */
  updatedAt: string
  /** Username of whoever changed it last (null when unknown or deleted; always null without contacts.manage). */
  updatedBy: string | null
  /** Whether the viewer may change and delete it. */
  canEdit: boolean
}

/** The address book of the viewer's facility: the categories in their order and the contacts the viewer sees. */
export interface ContactsDto {
  categories: ContactCategoryDto[]
  contacts: ContactDto[]
  /** contacts.manage: sees every contact and maintains them and the categories. */
  canManage: boolean
  /** contacts.global: also contacts for all facilities. */
  canManageGlobal: boolean
}

/** A school to choose as a child's „künftige Schule“: a contact in a category whose name contains „Schule“. */
export interface SchoolOptionDto {
  id: number
  /** The organisation, with the city when there is one („Grundschule Süd, Heidelberg“). */
  name: string
}

// ---- „Wissen“ (Dokumente → Wissen) -------------------------------------------

/**
 * A category or subcategory of „Wissen“ in the viewer's facility (only those the viewer sees, by visibility; a
 * subcategory only with its category), each category followed by its subcategories.
 */
export interface KnowledgeCategoryDto {
  id: number
  /** The category of a subcategory; null for a category. */
  parentId: number | null
  name: string
  visibility: TemplateVisibility
  /** The entries the viewer sees directly in it (the facility's own and the Träger's shown in it by name). */
  entryCount: number
  /** The facility's own entries filed directly in it; while there are any it cannot be deleted. */
  ownCount: number
  /** The subcategories the viewer does not see: while there are any, the viewer cannot delete the category (0 for a subcategory). */
  hiddenSubcategories: number
}

/** The viewer's own „Gelesen und verstanden“ of an entry (with an own account linked to an employee). */
export interface KnowledgeMyConfirmationDto {
  state: KnowledgeConfirmState
  /** When the person confirmed last (also an earlier version: „frühere Fassung bestätigt am …“); null when never. */
  confirmedAt: string | null
}

/** An entry of „Wissen“ as the viewer sees it. */
export interface KnowledgeEntryDto {
  id: number
  /** The facility's category it shows in; null = „Vom Träger“ (for all facilities, no category of its name). */
  categoryId: number | null
  /** The subcategory it shows in; null when directly in the category („Allgemein“) or under „Vom Träger“. */
  subcategoryId: number | null
  /** Of the Träger (for all or the chosen facilities, only the Träger changes it). */
  global: boolean
  /** For all facilities, also later ones (the Träger's; otherwise for its own facility or the facilities chosen). */
  allFacilities: boolean
  /**
   * An entry for all facilities: the category name, the subcategory name ('' for none) and the visibility the Träger
   * chose (null for a facility's own).
   */
  globalCategoryName: string | null
  globalSubcategoryName: string | null
  globalVisibility: TemplateVisibility | null
  kind: KnowledgeKind
  title: string
  description: string
  /** „Stand vom“ (null = not given). */
  asOf: IsoDate | null
  /** The link of a link entry ('' otherwise). */
  url: string
  /** The sanitized formatted text of a text entry ('' otherwise). */
  body: string
  /** The PDF's size in bytes (null for links and texts). */
  fileSize: number | null
  /** „Gelesen und verstanden erforderlich“. */
  needsConfirmation: boolean
  /** Counts up with every change of the content (file, link, text); older confirmations then are „frühere Fassung“. */
  version: number
  /** When the current version came (creation or the last change of file, link or text). */
  versionAt: string
  updatedAt: string
  /** The viewer's own confirmation; null at the tablet (the person confirms with the PIN) and without a linked employee. */
  myConfirmation: KnowledgeMyConfirmationDto | null
  /** Whether the viewer may change, move and delete it. */
  canEdit: boolean
  /** Who sees it at least (its own setting; its category's applies on top, the stricter one wins). */
  visibility: TemplateVisibility
  /** „Gilt für“, for Leitung, Träger and whoever may change it (null for everyone else). */
  targets: DocumentTargetsDto | null
}

/** „Wissen“ of the viewer's facility: the categories in their order and the entries the viewer sees, in order. */
export interface KnowledgeDto {
  categories: KnowledgeCategoryDto[]
  entries: KnowledgeEntryDto[]
  /** knowledge.manage: maintains the entries and categories of the facility and sees who confirmed. */
  canManage: boolean
  /** knowledge.global: also entries for all facilities. */
  canManageGlobal: boolean
  /** How the viewer confirms: with the own account (linked employee), at the tablet with name and PIN, or not at all. */
  confirmVia: 'account' | 'tablet' | null
  /** The entries the viewer (own account) still has to confirm (0 at the tablet). */
  openCount: number
}

/**
 * The fields of a new or changed entry (sent as multipart form fields, with the PDF as `file` for a file entry;
 * `facilityIds` and `groupTargets` as JSON). „Gilt für“: without `scope` a change keeps it as it is, a new entry is the
 * facility's own.
 */
export interface KnowledgeEntryInput extends DocumentTargetsInput, CategoryAdoptInput {
  kind: KnowledgeKind
  title: string
  description: string
  asOf: string
  url: string
  body: string
  needsConfirmation: boolean
  /** A facility's entry: one of its categories or subcategories (the viewer sees). */
  categoryId?: number
  /** An entry of the Träger for all or the chosen facilities: the category name, optionally a subcategory name. */
  categoryName?: string
  subcategoryName?: string
  /** Who sees it at least (not sent: as it was, 'all' for a new entry). */
  visibility?: TemplateVisibility
}

/** What the editor enters about a category; `parentId` (only when creating) makes it a subcategory of that category. */
export interface KnowledgeCategoryInput {
  name: string
  visibility: TemplateVisibility
  parentId?: number | null
}

/** One person in the overview of who confirmed an entry and who not yet. */
export interface KnowledgeConfirmationRowDto {
  employeeId: number
  name: string
  state: KnowledgeConfirmState
  /** Last confirmation (also of an earlier version); null when never. */
  confirmedAt: string | null
  /** At the tablet (with the PIN) or with the own account (null when never). */
  via: 'tablet' | 'account' | null
  /** Active staff of the facility who see the entry; false for a person who confirmed but left or no longer sees it. */
  expected: boolean
}

/** Who of the facility confirmed an entry and who not yet (knowledge.manage; also printed as „Nachweis“). */
export interface KnowledgeConfirmationsDto {
  entry: Pick<KnowledgeEntryDto, 'id' | 'title' | 'kind' | 'needsConfirmation' | 'version' | 'versionAt' | 'updatedAt' | 'asOf'> & { category: string }
  facilityName: string
  /** Open first, then an earlier version confirmed, then confirmed; each by name. */
  people: KnowledgeConfirmationRowDto[]
}

/** The answer to „Gelesen und verstanden“: who confirmed when. */
export interface KnowledgeConfirmResultDto {
  name: string
  confirmedAt: string
  version: number
}

// ---- Schulbezirke (street lists of the school districts) ----------------------

/** A district of a list: its code, the school's name and the school in the address book (null = none chosen). */
export interface SchoolDistrictInput {
  code: string
  name: string
  contactId: number | null
}

export interface SchoolDistrictDto extends SchoolDistrictInput {
  /** The contact as shown (organisation and city); null together with contactId. */
  contactName: string | null
  /** The contact no longer is a school of the list's facility (its „Gilt für“ changed): it stays, with a hint. */
  contactOutOfScope: boolean
}

/** A list as saved: the facility's own or the Träger's for all facilities. */
export interface SchoolDistrictListDto {
  scope: 'facility' | 'global'
  name: string
  /** „Stand“ as written. */
  asOf: string
  /** In the order they were saved. */
  rows: DistrictRow[]
  /** Every code the rows use, by code. */
  districts: SchoolDistrictDto[]
  updatedAt: string
  updatedBy: string | null
}

/** The settings „Schulbezirke“ of a facility: its own list, the Träger's, and the schools to map the districts to. */
export interface SchoolDistrictSettingsDto {
  own: SchoolDistrictListDto | null
  global: SchoolDistrictListDto | null
  /** The facility's „künftige Schule“ choices (for its own list). */
  schoolOptions: SchoolOptionDto[]
  /** The Träger's school contacts for all facilities (for the Träger's list). */
  globalSchoolOptions: SchoolOptionDto[]
}

/** Saving a list: it replaces the stored one of the same scope as a whole. */
export interface SchoolDistrictListInput {
  name: string
  asOf: string
  rows: DistrictRow[]
  districts: SchoolDistrictInput[]
}

/** An uploaded CSV or PDF read into rows, for the preview; nothing is saved yet. */
export interface SchoolDistrictParseDto {
  /** The file name without its extension, as a name for the list. */
  name: string
  /** A year found in the file name, else ''. */
  asOf: string
  rows: DistrictRow[]
  /** The school names found (the PDF's legend, a CSV's „Schule“ column), by code. */
  legend: DistrictLegendEntry[]
  /** Lines with digits that are no row (the first 100), and how many there were. */
  skipped: string[]
  skippedCount: number
  /** The file had more rows than a list may hold; the rest was left out. */
  truncated: boolean
}

/**
 * A child's school district by the list that applies to its facility (its own, else the Träger's): exactly one
 * (`match`, with the district's school and whether it can be taken over as „künftige Schule“), several (`ambiguous`:
 * overlapping rows, or a street without house number) or none (`none`: the address is not in the list).
 */
export type SchoolDistrictMatchDto =
  | {
    status: 'match'; code: string; name: string; asOf: string; scope: 'facility' | 'global'
    /** The district's school in the address book (null = none mapped). */
    contactId: number | null
    contactName: string | null
    /** The district's school no longer is for the child's facility (its „Gilt für“ changed): shown with a hint. */
    contactOutOfScope: boolean
    /** The child has no „künftige Schule“ yet and the district's school is one of the facility's choices. */
    canAdopt: boolean
  }
  | { status: 'ambiguous'; codes: string[]; asOf: string; scope: 'facility' | 'global' }
  | { status: 'none'; asOf: string; scope: 'facility' | 'global' }

/** An Elternzeit of an employee (contract data, server/services/parentalLeave.ts). */
export interface ParentalLeaveDto {
  id: number
  /** The child of the personnel file it is for (null: entered by birth date only, or the child was removed). */
  childId: number | null
  /** The child's first name, only for viewers of the personal data (employees.personal); null otherwise or without a name. */
  childName: string | null
  childBirthDate: IsoDate
  start: IsoDate
  end: IsoDate
  /** Part-time work during it (minutes per week); null = full Elternzeit. */
  partTimeWeeklyMinutes: number | null
  /** The working days of the part-time work (bitmask, bit 0 = Monday); null without part time. */
  partTimeWorkdays: number | null
  /** The employer cuts the leave by 1/12 per full calendar month (§ 17 Abs. 1 BEEG). */
  reduceLeave: boolean
  note: string
  /** „Erster Arbeitstag danach“: the person's next working day after the end (no public holiday, no closure; null: none found). */
  firstWorkingDay: IsoDate | null
  createdBy: string
}

/** The section „Elternzeit“ of the employee page. */
export interface EmployeeParentalLeaveDto {
  /** The summary of the 36 months per child of the periods (§ 15 Abs. 2 BEEG), oldest child first. */
  summaries: ParentalLeaveChildSummaryDto[]
  /** The viewer sees and enters the Mutterschutz after the birth (employees.sickness, not at the tablet). */
  canEnterProtection: boolean
  periods: ParentalLeaveDto[]
  /** The children of the personnel file to choose from (only with employees.personal, else empty: the birth date is entered). */
  children: { id: number; firstName: string | null; birthDate: IsoDate }[]
  /** The viewer may enter and change (employees.contractEdit). */
  canEdit: boolean
  /** The contract's working days today (bitmask): the default working days of part time in the dialog. */
  contractWorkdays: number
  /**
   * The next TVöD level step moved by the Elternzeit (§ 17 Abs. 3 TVöD) with its hints (never computed in); null without
   * a level, a start of employment, at the top level or without any move.
   */
  levelShift: { level: number; on: IsoDate; days: number; hints: LevelShiftHint[] } | null
}

/** What „Elternzeit eintragen“ saves (the dialog computes the end from a duration in months when given that way). */
export interface ParentalLeaveInput {
  childId: number | null
  childBirthDate: IsoDate
  start: IsoDate
  end: IsoDate
  partTimeWeeklyMinutes: number | null
  /** The working days of the part time (bitmask); null = the contract's working days at the start. Ignored without part time. */
  partTimeWorkdays?: number | null
  /**
   * „Mutterschutz nach der Geburt bis“ for a birth without a Mutterschutz case in the app (only with employees.sickness):
   * a day from the birth to 20 weeks after it, null removes it, left out = unchanged.
   */
  protectionAfterBirthUntil?: IsoDate | null
  reduceLeave: boolean
  note: string
}

/** The dialog's check of a period before saving (nothing is stored). */
export interface ParentalLeaveCheckDto {
  /**
   * Suggested start: for viewers of the health data (employees.sickness) the day after the Mutterschutz period after this
   * birth, else (and without such a case) the birth date.
   */
  suggestedStart: IsoDate
  /** Refuses saving (null = fine). */
  error: ParentalLeaveError | null
  /** Hints that never block: a fourth section, more than 36 months, more than 24 months after the 3rd birthday. */
  hints: ParentalLeaveHint[]
  sections: number
  totalMonths: number
  monthsAfterThird: number
  /** What was still possible for the child before this period, in average months (daysToMonths). */
  remainingMonths: number
  /** `remainingMonths` is exact; false: at most that, the Mutterschutz after the birth comes off on top (viewer without employees.sickness). */
  remainingExact: boolean
  /** The Mutterschutz after the birth counted (only for viewers with employees.sickness; the typed end included). */
  protection: { from: IsoDate; to: IsoDate; source: 'case' | 'manual' } | null
  firstWorkingDay: IsoDate | null
  /** Entries already in the plan on the days of a full Elternzeit (they stay; health codes „abwesend“ without employees.sickness). */
  entries: { date: IsoDate; label: string }[]
}

/** Saving a period answers the entries already in the plan on the days of a full Elternzeit (as in the check). */
/**
 * „36 Monate insgesamt · davon Mutterschutz … · Elternzeit eingetragen … · noch möglich …“ for one child (months: days /
 * (365.25 / 12), one decimal). The Mutterschutz after the birth with dates and months only for viewers with
 * employees.sickness; everybody else learns only that one counts, the months entered and at most what is still possible.
 */
export interface ParentalLeaveChildSummaryDto {
  childId: number | null
  /** Only for viewers of the personal data (employees.personal). */
  childName: string | null
  childBirthDate: IsoDate
  /** From the birth to its last day, from the case or entered by hand; null without one or for viewers without employees.sickness. */
  protection: { from: IsoDate; to: IsoDate; source: 'case' | 'manual' } | null
  /** A Mutterschutz after the birth counts towards the 36 months („Mutterschutzfrist wird angerechnet“). */
  protectionCounted: boolean
  totalMonths: number
  /** Null for viewers without employees.sickness. */
  protectionMonths: number | null
  plannedMonths: number
  /** Still possible (below 0 = too much); with `remainingExact` false at most this (36 minus the Elternzeit). */
  remainingMonths: number
  remainingExact: boolean
}

export interface ParentalLeaveSaveDto {
  id: number
  entries: { date: IsoDate; label: string }[]
}

/** „Elternzeit für alle sichtbar anzeigen“ of the facility. */
export interface ParentalLeaveSettingsDto {
  visibleToAll: boolean
  /** The viewer may change it (employees.contractEdit). */
  canEdit: boolean
}

/** „Zum Unterschreiben senden“ (server/services/signRequests.ts): one recipient of a request, as the senders see it. */
export interface SignRequestRecipientDto {
  id: number
  employeeId: number
  name: string
  status: 'open' | 'signed' | 'declined' | 'withdrawn'
  signedAt: string | null
  declinedAt: string | null
  declineReason: string | null
  withdrawnAt: string | null
  remindedAt: string | null
  /** The signed copy in the personnel file; null when not signed, deleted since, or the viewer may not use its folder now. */
  signedDocumentId: number | null
  /** SHA-256 of the signed copy as it was stored (for the record). */
  signedHash: string | null
  /** The copy in the personnel file no longer has that SHA-256 (replaced since, e.g. via „Bearbeiten“). */
  copyModified: boolean
  /** Signed, but the copy was deleted from the personnel file since. */
  copyDeleted: boolean
  /**
   * The copy must not be kept: its Pflichtdokument is „nur Einsicht vermerken“ (switched after sending), so it was filed
   * unlinked and is on the cleanup list (Datenschutz & Löschen) until deleted.
   */
  copyInspectionOnly?: true
}

/** A request to sign, as the senders see it (Mitarbeitende → Unterschriften). */
export interface SignRequestDto {
  id: number
  title: string
  createdAt: string
  /** The sender's user name; null when the account was deleted. */
  createdBy: string | null
  sourceKind: 'template' | 'document'
  targetFolder: EmployeeDocumentFolder
  dueDate: IsoDate | null
  note: string
  fileSize: number
  /** A recipient is still open after the due date. */
  overdue: boolean
  recipients: SignRequestRecipientDto[]
}

/** An open request of the employee (Meins → Zu unterschreiben, or the unlocked tablet). */
export interface MySignRequestDto {
  recipientId: number
  title: string
  sentAt: string
  sentBy: string | null
  dueDate: IsoDate | null
  note: string
  remindedAt: string | null
  fileSize: number
  overdue: boolean
}

/** The open requests of the own employee and how many of them are overdue (the menu's count). */
export interface MySignRequestCountDto {
  count: number
  overdue: number
}

/**
 * „Offen für dich“ (GET /api/my/open-items): what waits for the account's own linked employee, counted by the services
 * that own each item. All zero (false) without a linked employee.
 */
export interface MyOpenItemsDto {
  /** Entries of „Wissen“ to confirm (never, or only an earlier version). */
  knowledge: number
  /** Requests to sign still open, and how many of them are overdue. */
  sign: number
  signOverdue: number
  /** Own self-assessments released to fill in. */
  selfAssessments: number
  /** Own leave requests decided (approved or rejected) in the last 14 days. */
  leaveDecisions: number
  /** The notice on remaining leave is still to be read. */
  leaveNotice: boolean
  /** Own mandatory appointments overdue (one never entered only after the first 4 weeks of employment). */
  requirements: number
  /**
   * Pflichttermin appointments of the active facility from their (last) day on whose attendance is not confirmed yet
   * (only with employees.edit and calendar.edit; absent when there are none): how many, and the first to open.
   */
  attendance?: { count: number; eventId: number; year: number }
}

export interface MySignRequestsDto {
  /** The signing person's name (for the line „Elektronisch unterschrieben von …“). */
  employeeName: string
  requests: MySignRequestDto[]
}

// ---- „Infogespräche & Hospitationen“ (server/services/visits.ts) ----------------------------------------------

/** An info visit as the form sends it (status: only open or declined; „waitlisted“ comes with the take-over). */
export interface InfoVisitInput {
  visitDate: IsoDate
  visitStart: Minutes | null
  familyName: string
  phone: string
  email: string
  childFirstName: string
  childLastName: string
  childBirthDate: IsoDate | null
  desiredStart: IsoDate | null
  guidedByEmployeeId: number | null
  guidedByName: string
  notes: string
  status?: 'open' | 'declined'
}

/** A document of a visit (never the file itself). */
export interface VisitDocumentDto {
  id: number
  title: string
  mimeType: string
  size: number
  fillable: boolean
  /** The uploader's user name; null when the account was deleted. */
  uploadedBy: string | null
  uploadedAt: string
}

/** A form of a visit in its list. */
export interface VisitFormListItemDto {
  id: number
  title: string
  templateId: number | null
  updatedAt: string
  updatedBy: string
}

/** A form of a visit with its content and answers; `editable` for visits.manage while the record is not taken over. */
export interface VisitFormDto extends VisitFormListItemDto {
  kind: 'info' | 'applicant'
  content: FormContent
  answers: FormAnswers
  editable: boolean
}

export interface InfoVisitListItemDto {
  id: number
  visitDate: IsoDate
  visitStart: Minutes | null
  familyName: string
  childFirstName: string
  childLastName: string
  status: InfoVisitStatus
  /** The waitlist child it was taken over as (null otherwise, or once that record is gone). */
  childId: number | null
  /** That child's name while it is in this facility (a taken-over record keeps no names of its own). */
  linkedName: string | null
  /** The employee's name, else the free text. */
  guidedBy: string
  phone: string
  email: string
  documentCount: number
  formCount: number
  updatedAt: string
}

/** A person of the facility to choose as guide or mentor. */
export interface VisitStaffDto {
  id: number
  name: string
}

export interface InfoVisitDto extends InfoVisitListItemDto {
  childBirthDate: IsoDate | null
  desiredStart: IsoDate | null
  guidedByEmployeeId: number | null
  guidedByName: string
  notes: string
  createdAt: string
  createdBy: string | null
  updatedBy: string | null
  documents: VisitDocumentDto[]
  forms: VisitFormListItemDto[]
  /** The facility's active templates of the kind „Infogespräch“. */
  templates: TemplateChoice[]
  staff: VisitStaffDto[]
}

/** „Als Vormerkung übernehmen“: the birth date (the record needs one) and the type the documents get in the child's record. */
export interface InfoVisitTakeOverInput {
  birthDate: IsoDate
  documentTypeId: number | null
}

export interface ApplicantDayDto {
  date: IsoDate
  from: Minutes | null
  to: Minutes | null
}

export interface ApplicantVisitInput {
  name: string
  phone: string
  email: string
  kind: ApplicantKind
  notes: string
  mentorEmployeeId: number | null
  days: ApplicantDayDto[]
  status?: 'open' | 'declined'
}

export interface ApplicantVisitListItemDto {
  id: number
  name: string
  kind: ApplicantKind
  status: ApplicantStatus
  declinedAt: IsoDate | null
  /** The employee it was hired as (null otherwise, or once that record is gone). */
  employeeId: number | null
  /** That employee's name while they are in this facility (a hired record keeps no name of its own). */
  linkedName: string | null
  firstDay: IsoDate | null
  lastDay: IsoDate | null
  dayCount: number
  mentorName: string | null
  phone: string
  email: string
  documentCount: number
  formCount: number
  updatedAt: string
}

export interface ApplicantVisitDto extends ApplicantVisitListItemDto {
  notes: string
  mentorEmployeeId: number | null
  days: ApplicantDayDto[]
  createdAt: string
  createdBy: string | null
  updatedBy: string | null
  documents: VisitDocumentDto[]
  forms: VisitFormListItemDto[]
  templates: TemplateChoice[]
  staff: VisitStaffDto[]
  /** visits.manage: may change it (else read only, e.g. visits.applicants.view). */
  canManage: boolean
}

/** „Einstellen“: the employee's first data (the Träger completes the contract) and the folder for the documents. */
export interface ApplicantHireInput {
  shortName: string
  validFrom: IsoDate
  weeklyMinutes: number
  groupId: number | null
  folder: EmployeeDocumentFolder | null
}

/** A form of the application, moved into the personnel file at „Einstellen“ (read only there). */
export interface ApplicationFormDto {
  id: number
  title: string
  content: FormContent
  answers: FormAnswers
  updatedAt: string
  updatedBy: string
}
