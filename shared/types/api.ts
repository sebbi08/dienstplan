import type { CashKind, CashSheetRow, YearMonth } from '../domain/cash'
import type { AdmissionStatus, ChildStatus } from '../domain/children'
import type { FormAnswers, FormContent, FormKind } from '../domain/forms'
import type { HolidayKey, HolidayRules } from '../domain/holidays'
import type { LeaveAccount, LeaveRange } from '../domain/leave'
import type { DayMeal } from '../domain/meals'
import type { DayHours, OpeningHours } from '../domain/openingHours'
import type { DocSettings, ReminderKind } from '../domain/reminders'
import type { RequirementState } from '../domain/requirements'
import type { BreakMode, StampChannel } from '../domain/stamping'
import type {
  Confidence, Qualification, QuotaLine, RequirementLine, StaffingMethod, StaffingRuleSet,
} from '../domain/staffing/types'
import type { GermanState } from '../domain/states'
import type { MarkSummary } from '../domain/timeMarks'
import type { JobKey, PayGroup } from '../domain/tvoed'
import type { CodeKey, CreditMode, DomainEntry, EntryKind, IsoDate, Minutes } from '../domain/types'
import type { Warning } from '../domain/warnings'

export const COLOR_KEYS = ['neutral', 'gray', 'green', 'yellow', 'blue', 'red', 'violet', 'orange'] as const
export type ColorKey = typeof COLOR_KEYS[number]

/**
 * The colours a group may have (palette keys, shown as light shades). Green, red, lime and blue tones are left out:
 * the year calendar uses them for vacation, sick days, special leave and training (Fortbildung).
 */
export const GROUP_COLORS = ['amber', 'orange', 'rose', 'fuchsia', 'violet', 'brown', 'teal', 'slate'] as const
export type GroupColor = typeof GROUP_COLORS[number]
export const isGroupColor = (value: string): value is GroupColor => (GROUP_COLORS as readonly string[]).includes(value)

/** The consents (Einwilligungen) in a child's record; each matches a `consent_*` column of `children`. */
export const CONSENT_KEYS = [
  'artworkDisplay', 'photosDisplay', 'photosForeignPortfolios', 'photosInternalEvents',
  'photosNamesBirthdaysDisplay', 'groupWorkWithNames', 'whatsappContact', 'whatsappPhotos', 'signalPhotos', 'whatsappParentGroup', 'insectRepellent',
] as const
export type ConsentKey = typeof CONSENT_KEYS[number]
/** An answer that may still be open: yes, no or not answered (null). */
export type TriState = boolean | null

export type Role = 'provider' | 'admin' | 'observer' | 'terminal'
export type ClosureMode = 'vacation' | 'closure_day'
export type NoteField = 'info1' | 'info2'
export type ChangeField = 'entry' | NoteField
export type ApplyMode = 'replace' | 'add' | 'clear'

export interface SessionUser {
  id: number
  username: string
  role: Role
  employeeId: number | null
  mustChangePassword: boolean
  /** The stored flag as is (only meaningful for a Mitarbeiter); `mayEditChildren` decides who may edit child records. */
  canEditChildren: boolean
  /**
   * The facility the user works in, resolved fresh on every request: Leitung and tablet their own, the Träger the
   * active selection, a Mitarbeiter that of the linked employee (null without one).
   */
  facilityId: number | null
}

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
export type CareTypeInput = Omit<CareTypeDto, 'id' | 'daysPerWeek'> & { daysPerWeek?: number }

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
export type DocumentTypeInput = Omit<DocumentTypeDto, 'id' | 'careContract'> & { careContract?: boolean }

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
  mayTakeTemperature: TriState
  mayApplySunscreen: TriState
  mayApplyPlaster: TriState
}

export type ChildConsents = Record<ConsentKey, TriState>

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

/** The school cutoff of a facility: a child is of school age when it reaches `ageYears` by `cutoffDay`.`cutoffMonth`. */
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
  /** The day it is about: the documentation's due day, the birthday, the last day before leaving. */
  date: IsoDate
  /** Overdue only for a documentation. */
  state: 'upcoming' | 'today' | 'overdue'
  /** The child's first and last name, or the employee's name. */
  name: string
  /** null for a staff birthday. */
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
  health: ChildHealthInput
  consents: ChildConsents
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
}

/** What the user enters about a document (the file comes with the upload). */
export interface ChildDocumentMeta {
  typeId: number
  title: string
  documentDate: IsoDate
  confidential: boolean
}

/** Where a new print template applies: the facility the uploader works in, or every facility (Träger only). */
export type PrintTemplateScope = 'facility' | 'all'

/** What the user enters about a print template (the file comes with the upload). Empty category = „Sonstiges“. */
export interface PrintTemplateMeta {
  title: string
  category: string
}

/** A blank PDF form to open and print (the file itself is served separately). */
export interface PrintTemplateDto {
  id: number
  title: string
  category: string
  /** For all facilities (maintained by the Träger). */
  global: boolean
  size: number
  uploadedAt: string
  updatedAt: string
  /** Whether the viewer may rename, replace and delete it. */
  canEdit: boolean
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
  address: string
  consents: ChildConsents
  measlesProof: boolean | null
  measlesProofDate: IsoDate | null
  infectionBriefingDate: IsoDate | null
  allergies: string
  mayTakeTemperature: boolean | null
  mayApplySunscreen: boolean | null
  mayApplyPlaster: boolean | null
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
}

/** An archived child in the archive list; the record may be deleted from `purgeOn` on (by the Träger, by hand). */
export interface ArchivedChildDto {
  id: number
  name: string
  leftOn: IsoDate
  purgeOn: IsoDate
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
}

/** An employee of another facility helping out in this facility's plan for a month (a helper column). */
export interface HelperDto {
  helpOutId: number
  employeeId: number
  name: string
  shortName: string
  fromFacilityId: number
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

export interface WeekSummaryDto {
  weekStart: IsoDate
  weekEnd: IsoDate
  weekNumber: number
  /** Name of the facility's week template this week was saved as or filled from (null = none). */
  templateName: string | null
  /** Template names of the week keyed '0' (the whole facility, as templateName) or by group id; none = {}. */
  templateNames: Record<string, string>
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
  /** Per own employee: the month's weekdays they do not work (part-time days off, before or after employment, holidays). */
  offDays: Record<number, IsoDate[]>
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
  admin: MonthPlanAdminDto | null
}

/** An entry in "Mein Dienstplan"; a help-out duty carries the name of the facility it is in. */
export interface MyPlanEntryDto extends EntryDto {
  helpFacilityName?: string
}

export interface MyPlanDayDto extends DayRowDto {
  entries: MyPlanEntryDto[]
  changes: ChangeDto[]
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
  ranges: LeaveRange[]
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
   * Only for someone with a leaving day: whether balance adjustments marked „ausgezahlt“ are left (the archive names
   * their deletion date only then; without them the entry goes with the assessments).
   */
  hasPaidOut?: boolean
}

export interface EmployeeDetailDto extends EmployeeListItemDto {
  hours: { id: number; weeklyMinutes: number; validFrom: IsoDate; workdays: number }[]
  /** `paidOut`: „ausgezahlt“, kept for the longer retention period after leaving. */
  adjustments: { id: number; date: IsoDate; minutes: number; reason: string; paidOut: boolean }[]
  /** carriedOverDays is the carry-over that counts; carriedAutomatically when it is the rest of the year before. */
  entitlements: { id: number; year: number; days: number; carriedOverDays: number; carriedAutomatically: boolean }[]
  /** End of a running timed PIN lock (15 or 30 minutes; null = none). */
  pinLockedUntil: string | null
  /** The PIN stays locked until the Leitung or the Träger unlocks it („PIN freischalten“). */
  pinLockedPermanently: boolean
  /** Locks since the last right PIN (0 = none; stays after a timed lock has run out, until a right PIN or the unlock). */
  pinLockLevel: number
}

export interface UserDto {
  id: number
  username: string
  role: Role
  employeeId: number | null
  employeeName: string | null
  active: boolean
  mustChangePassword: boolean
  canEditChildren: boolean
  lockedUntil: string | null
}

export interface ClosureDto {
  id: number
  startDate: IsoDate
  endDate: IsoDate
  label: string
  mode: ClosureMode
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
  payGroup: PayGroup | null
  payLevel: number | null
}

export interface AppSettingsDto {
  timeTrackingFrom: IsoDate | null
  /** Set by the Träger: whether the Leitung sees the contract data of the employees. */
  contractVisibleToAdmins: boolean
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
  | { unlocked: true; employeeId: number; name: string; rights: ChildRightsDto; lockMinutes: number }

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
  recordedMinutes: number
  /** What the balance counts for this day. */
  counted: number
  usesRecords: boolean
  /** One of the four absences of the time page (Urlaub, Krank, Fortbildung, Schule) is planned. */
  absence: boolean
  /** The plan has entries other than those absences (shifts, Feiertag, Schließtag …) that an absence would replace. */
  otherEntries: boolean
  /** A daily-target code (Urlaub … Feiertag, Schließtag) is planned: the day counts its target, records do not count. */
  targetCredit: boolean
  warnings: Warning[]
  /** Admin's free-text reason for this day (not shown to the employee). */
  note: string
  changes: TimeRecordChangeDto[]
  /** The day has planned working time and no full-day absence: it can be marked "Im Dienst erkrankt". */
  plannedDuty: boolean
  /** "Im Dienst erkrankt": the planned time is credited whatever was stamped, and the day has no time hints. */
  sickLeave: SickLeaveMarkDto | null
  /**
   * Minutes the first stamped arrival came after the first planned work start, when more than the facility's tolerance
   * (null = not marked). Leitung and Träger only, like the whole time page; never in the staff's own time view.
   */
  lateMinutes: number | null
  /** Minutes the last departure lay before the last planned work end, when more than the tolerance and switched on. */
  earlyMinutes: number | null
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
export type CalendarKind = 'sick' | 'vacation' | 'special_leave' | 'training' | 'closed' | 'requested'

/** Admin's own appointment in the year calendar. */
export interface CalendarEventDto {
  id: number
  date: IsoDate
  start: Minutes | null
  end: Minutes | null
  title: string
  visibleToStaff: boolean
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
}

/** A saved plan week; `rows` previews it per employee with one text per weekday Monday–Friday ('' = empty). */
export interface WeekTemplateDto {
  id: number
  name: string
  /** The group the template is for (null = the whole facility). */
  groupId: number | null
  updatedAt: string
  rows: { employeeId: number; name: string; days: string[] }[]
}

export interface WeekTemplateApplyResult {
  /** Employee days filled from the template. */
  filled: number
  /** Template days left out: cell not empty, or no working day for that employee (holiday, closure, day off, left). */
  skipped: number
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

/** An employee's next TVöD level step that is due soon or overdue (see dueLevelUp). */
export interface LevelUpDto {
  employeeId: number
  name: string
  /** The level currently entered and the one that is due. */
  fromLevel: number
  level: number
  on: IsoDate
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

export interface LeaveRequestDto {
  id: number
  employeeId: number
  name: string
  startDate: IsoDate
  endDate: IsoDate
  note: string
  status: LeaveRequestStatus
  createdAt: string
  decidedAt: string | null
  decidedBy: string | null
  decisionNote: string
  /** Working days of the employee in the range (without holidays, closures and days off). */
  workdays: number
  /** Days of the range on which more people than allowed would be on leave (open requests only). */
  overLimitDates: IsoDate[]
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
  workdays: number
  /** Leave days left in the start year after this request (null: no entitlement recorded). */
  availableAfter: number | null
  overLimitDates: IsoDate[]
}

/** The planning page: year calendar of leave and open requests, people per day and the open requests. */
export interface LeavePlanningDto {
  calendar: YearCalendarDto
  /** People on leave (planned + open requests) per day. */
  counts: Record<IsoDate, number>
  maxConcurrent: number | null
  openRequests: LeaveRequestDto[]
}

/** A kind of mandatory appointment or proof (Pflichttermin) of a facility. */
export interface RequirementTypeDto {
  id: number
  name: string
  /** Due again every this many months (null = needed once). */
  intervalMonths: number | null
  /** 'company_doctor', 'first_aid', 'criminal_record' or 'measles' for the built-in kinds, null for the facility's own. */
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
    type: Pick<RequirementTypeDto, 'id' | 'name' | 'intervalMonths'>
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
export interface NoteDto {
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
  theme: NoteDto
  /** Monday to Friday: the day's label (holiday or closure, null on an ordinary day) and the "Was haben wir gemacht" text. */
  days: { date: IsoDate; label: GroupDayLabel | null; note: NoteDto }[]
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
}

/**
 * The child's forms, newest first, and whether the viewer may start a new one (managers, the key educator at the tablet);
 * `templates` are the facility's active child templates to start one from (empty unless `canCreate`).
 */
export interface ChildFormsDto {
  forms: ChildFormListItemDto[]
  canCreate: boolean
  templates: { id: number; name: string }[]
}

/** One child form with its own copy of the template content, the answers and what the printout's header needs. */
export interface ChildFormDto extends ChildFormListItemDto {
  content: FormContent
  answers: FormAnswers
  child: { firstName: string; lastName: string; birthDate: IsoDate; groupName: string | null }
  facilityName: string
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

/** An employee unlocked to edit one child form at the tablet. */
export interface ChildFormEditorDto {
  employeeId: number
  name: string
  grantedAt: string
  grantedBy: string
}

/** A team meeting is written while `draft`; once Leitung/Träger released it, it is locked until they reopen it. */
export type TeamMeetingState = 'draft' | 'released'

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
  participants: string
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
 * The facility's team meetings of a year, newest first; the active team templates and the groups to choose from (the
 * tablet and staff cannot read the template list); `canManage`: Leitung/Träger, who release, reopen and delete.
 */
export interface TeamMeetingsDto {
  meetings: TeamMeetingListItemDto[]
  templates: { id: number; name: string }[]
  groups: { id: number; name: string }[]
  canManage: boolean
}

/**
 * One team meeting with its own copy of the template content, the answers, the printout's facility name and the
 * facility's groups to choose from in the header.
 */
export interface TeamMeetingDto extends TeamMeetingListItemDto {
  content: FormContent
  answers: FormAnswers
  facilityName: string
  groups: { id: number; name: string }[]
  canManage: boolean
}

/** The header of a team meeting. */
export interface TeamMeetingHeader {
  date: string
  start: number | null
  groupId: number | null
  participants: string
  recorder: string
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
