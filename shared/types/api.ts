import type { ChildStatus } from '../domain/children'
import type { HolidayKey } from '../domain/holidays'
import type { LeaveAccount, LeaveRange } from '../domain/leave'
import type { BreakMode, StampChannel } from '../domain/stamping'
import type { JobKey, PayGroup } from '../domain/tvoed'
import type { CodeKey, CreditMode, DomainEntry, EntryKind, IsoDate, Minutes } from '../domain/types'
import type { Warning } from '../domain/warnings'

export const COLOR_KEYS = ['neutral', 'gray', 'green', 'yellow', 'blue', 'red', 'violet', 'orange'] as const
export type ColorKey = typeof COLOR_KEYS[number]

/** The consents (Einwilligungen) in a child's record; each matches a `consent_*` column of `children`. */
export const CONSENT_KEYS = [
  'artworkDisplay', 'photosDisplay', 'photosForeignPortfolios', 'photosInternalEvents', 'photosWhatsapp',
  'photosNamesBirthdaysDisplay', 'groupWorkWithNames', 'whatsappContact', 'whatsappPhotos', 'whatsappParentGroup',
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
}

/** A group (Gruppe) of a facility. */
export interface GroupDto {
  id: number
  name: string
  sortOrder: number
}

/** A care type (Betreuungsart) of a facility: a booking time window, times in minutes since midnight. */
export interface CareTypeDto {
  id: number
  name: string
  start: Minutes
  end: Minutes
  sortOrder: number
}

export type CareTypeInput = Omit<CareTypeDto, 'id'>

/** A document type (Dokumentart) of a facility; important/required drive the completeness view. */
export interface DocumentTypeDto {
  id: number
  name: string
  important: boolean
  required: boolean
  /** New documents of this type start out confidential. */
  confidentialDefault: boolean
  sortOrder: number
}

export type DocumentTypeInput = Omit<DocumentTypeDto, 'id'>

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
  infoMeetingDate: IsoDate | null
  schoolStartDate: IsoDate | null
  primarySchool: string
  note: string
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
  entryDate: IsoDate | null
  plannedEntryDate: IsoDate | null
  hasAllergies: boolean
  contactBans: { name: string; note: string }[]
}

export interface ChildRecordDto {
  id: number
  status: ChildStatus
  master: ChildMasterInput
  health: ChildHealthInput
  consents: ChildConsents
  contacts: ChildContactDto[]
  stamps: Record<'master' | 'contacts' | 'health' | 'consents', SectionStamp>
  leftOn: IsoDate | null
  /** Day the archived record is deleted automatically; null while the child has not left. */
  purgeOn: IsoDate | null
  canEdit: boolean
  documents: []
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
}

export interface DayRowDto {
  date: IsoDate
  weekday: number
  isWeekend: boolean
  holidayKey: HolidayKey | null
  closureLabel: string | null
  info1: string
  info2: string
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
  days: DayRowDto[]
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
  /** Contract data; only sent to the Träger, and to the Leitung when the Träger allows it. */
  contract?: EmployeeContractDto
}

export interface EmployeeDetailDto extends EmployeeListItemDto {
  hours: { id: number; weeklyMinutes: number; validFrom: IsoDate; workdays: number }[]
  adjustments: { id: number; date: IsoDate; minutes: number; reason: string }[]
  /** carriedOverDays is the carry-over that counts; carriedAutomatically when it is the rest of the year before. */
  entitlements: { id: number; year: number; days: number; carriedOverDays: number; carriedAutomatically: boolean }[]
  hasPin: boolean
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
  employees: { id: number; name: string }[]
  /** Per employee id: the calendar kind of each day that has one. */
  days: Record<number, Record<IsoDate, CalendarKind>>
  /** Per employee id: dates with plan entries other than the four absences (an absence would replace them). */
  otherEntries: Record<number, IsoDate[]>
  /** Per employee id: weekdays (Mon–Fri, no holiday) that are not working days of their contract. */
  freeDays: Record<number, IsoDate[]>
  /** Urlaub, Krank, Fortbildung, Schule — entered by clicking a day. */
  absenceCodes: CodeDto[]
  events: CalendarEventDto[]
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
