import { sql } from 'drizzle-orm'
import { blob, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { OverviewColumnRef } from '../../shared/domain/childConsents'
import type { RightsRole } from '../../shared/domain/permissionBundles'
import { EMPLOYEE_DOCUMENT_FOLDERS } from '../../shared/domain/personnel'
import type { GermanState } from '../../shared/domain/states'
import { QUALIFICATIONS } from '../../shared/domain/staffing/types'
import { TEMPLATE_VISIBILITIES } from '../../shared/domain/templateCategories'
import { MEETING_KINDS } from '../../shared/types/api'

/**
 * Reminder of the development documentation (see shared/domain/reminders.ts DocSettings): off, every
 * `doc_interval_months` months (1–24) or around the birthday, shown `doc_lead_weeks` weeks (0–12) before it is due.
 * `doc_since` („gilt seit“, ISO date): the day the mode last changed (switched on, or interval ↔ birthday); without a
 * done date the due day is counted from no earlier than this day. Null while the mode is off.
 */
function docSettings() {
  return {
    docMode: text('doc_mode', { enum: ['off', 'interval', 'birthday'] }).notNull().default('off'),
    docIntervalMonths: integer('doc_interval_months').notNull().default(12),
    docLeadWeeks: integer('doc_lead_weeks').notNull().default(2),
    docSince: text('doc_since'),
  }
}

/** A facility (Einrichtung) of the Träger; the existing data became facility 1 "Kindergarten". */
export const facilities = sqliteTable('facilities', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  sortOrder: integer('sort_order').notNull().default(0),
  /** Start of time tracking in this facility (ISO date; null = plan only). */
  timeTrackingFrom: text('time_tracking_from'),
  /** Time tracking: a delay or early leaving of more than this many minutes is marked for the Leitung (0–60). */
  markToleranceMinutes: integer('mark_tolerance_minutes').notNull().default(5),
  /** Time tracking: whether leaving earlier than planned is marked (late arrivals always are). */
  markEarlyLeave: integer('mark_early_leave', { mode: 'boolean' }).notNull().default(true),
  /** At most this many employees of the facility on leave at the same time (null = no limit). */
  leaveMaxConcurrent: integer('leave_max_concurrent'),
  /**
   * The settings form's current choice for 24 and 31 December without the TVöD: half a leave day (`christmasEveHalfLeave`),
   * „bezahlt frei“ (`christmasEvePaidFree`) or else a whole leave day. Only the Träger sets them. How a year counts is
   * never read from here but from facilityEveRules (each change is written there from the effective year on).
   */
  christmasEveHalfLeave: integer('christmas_eve_half_leave', { mode: 'boolean' }).notNull().default(false),
  christmasEvePaidFree: integer('christmas_eve_paid_free', { mode: 'boolean' }).notNull().default(false),
  /**
   * „Wir arbeiten nach TVöD SuE“ (Träger only, default on): 24 and 31 December are paid free (TVöD § 6 Abs. 3), written
   * to facilityEveRules as 'paid' from the effective year. It changes nothing else; pay groups, levels and the level
   * steps stay usable either way.
   */
  tvoedSue: integer('tvoed_sue', { mode: 'boolean' }).notNull().default(true),
  /**
   * Remaining leave of a year lapses on this day of the year after (January to September; default 31.03.). Leitung and
   * Träger set it; the notice on remaining leave (shared/domain/leaveForfeit.ts) names it.
   */
  leaveForfeitDay: integer('leave_forfeit_day').notNull().default(31),
  leaveForfeitMonth: integer('leave_forfeit_month').notNull().default(3),
  /** The facility's own text of that notice with ‹Tage›, ‹Jahr›, ‹Verfall› (null = DEFAULT_LEAVE_FORFEIT_TEXT). */
  leaveForfeitText: text('leave_forfeit_text'),
  /** The facility's own text of the BEM invitation with ‹Name›, ‹Antwort bis›, ‹Jahre› (null = BEM_DEFAULT_INVITATION_TEXT). */
  bemInvitationText: text('bem_invitation_text'),
  /** School cutoff (Stichtag): the last birthday of the year (`schoolAgeYears` before) that still starts school on 1 September. */
  schoolCutoffMonth: integer('school_cutoff_month').notNull().default(6),
  schoolCutoffDay: integer('school_cutoff_day').notNull().default(30),
  schoolAgeYears: integer('school_age_years').notNull().default(6),
  /** The daily run deregisters the facility's school children to the day before their school start (off until the Träger turns it on). */
  autoLeaveSchoolChildren: integer('auto_leave_school_children', { mode: 'boolean' }).notNull().default(false),
  /** Minutes without use after which the facility's tablet locks the child records again (1–30). */
  tabletLockMinutes: integer('tablet_lock_minutes').notNull().default(2),
  /** Whether the tablet shows waitlisted children (Vormerkungen) to staff and helpers. */
  tabletShowWaitlist: integer('tablet_show_waitlist', { mode: 'boolean' }).notNull().default(false),
  /** Whether the tablet shows children with a contract that has not started yet to staff and helpers. */
  tabletShowFutureContracts: integer('tablet_show_future_contracts', { mode: 'boolean' }).notNull().default(false),
  /** The state (Bundesland) whose public holidays apply to the facility and to the staff it is home to. */
  state: text('state').$type<GermanState>().notNull().default('BW'),
  /** Mariä Himmelfahrt (15 August) is a holiday here; effective only in Bavaria (BY). */
  assumptionDay: integer('assumption_day', { mode: 'boolean' }).notNull().default(true),
  /** Child attendance: whether arriving asks who brought the child. */
  recordBroughtBy: integer('record_brought_by', { mode: 'boolean' }).notNull().default(false),
  /**
   * Child attendance is recorded from this day on (ISO date; null = not yet): only from here a past care day without an
   * entry is unexcused. Set by the first attendance entry, changed only in the settings.
   */
  attendanceSince: text('attendance_since'),
  /** § 34 IfSG: the readmission after a medical judgement needs a written attest (photo/PDF) to be stored. */
  ifsgRequireAttest: integer('ifsg_require_attest', { mode: 'boolean' }).notNull().default(false),
  /** § 34 IfSG: the local health office (name and phone), shown with its rules and in „Rücksprache“ cases. */
  healthOfficeName: text('health_office_name').notNull().default(''),
  healthOfficePhone: text('health_office_phone').notNull().default(''),
  /** How the child lists order the children inside a group (shared/domain/childSort.ts); default = oldest first. */
  childSort: text('child_sort').notNull().default('age_desc'),
  /** Opening hours: the minimum number of staff at opening and until closing (1–20). */
  minAtOpening: integer('min_at_opening').notNull().default(1),
  minAtClosing: integer('min_at_closing').notNull().default(1),
  /**
   * „Elternzeit für alle sichtbar anzeigen“ (set by whoever edits contract data, default off): the plan names a full
   * Elternzeit „Elternzeit“ for everyone; off, only viewers with employees.view see it, everybody else and the tablet
   * „abwesend“ (server/services/parentalLeave.ts).
   */
  parentalLeaveVisible: integer('parental_leave_visible', { mode: 'boolean' }).notNull().default(false),
  /** Development documentation (Entwicklungsdokumentation) of the children without group; see docSettings. */
  ...docSettings(),
  /** Reminders: days before a child's birthday, days before a staff birthday, weeks before a child leaves (0–30, 0–30, 0–12). */
  birthdayLeadDays: integer('birthday_lead_days').notNull().default(7),
  staffBirthdayLeadDays: integer('staff_birthday_lead_days').notNull().default(7),
  leavingLeadWeeks: integer('leaving_lead_weeks').notNull().default(4),
  /** Höchstzahl Kinder in der Einrichtung (e.g. from the Betriebserlaubnis; 1–999, null = not set); set by the Träger only. */
  capacity: integer('capacity'),
  /** Contact data (Kontakt): address, website, operator (Träger) and manager (Leitung) as free text; the phone numbers and e-mails are in facilityContacts. */
  street: text('street').notNull().default(''),
  postalCode: text('postal_code').notNull().default(''),
  city: text('city').notNull().default(''),
  website: text('website').notNull().default(''),
  operatorName: text('operator_name').notNull().default(''),
  managerName: text('manager_name').notNull().default(''),
  /**
   * From 0055_forms: the staff starter templates were created once. No longer read: since 0056_child_forms the seeded
   * starters are kept per key in `form_starter_seeds` (the migration carried this flag over).
   */
  formStartersSeeded: integer('form_starters_seeded', { mode: 'boolean' }).notNull().default(false),
})

/** The owning facility of a row (default 1 only until every insert passes it explicitly). */
const facilityId = () => integer('facility_id').notNull().default(1).references(() => facilities.id)

/** A group (Gruppe) of a facility; its name is unique within the facility, compared case-insensitively. */
export const groups = sqliteTable('groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  /** Number of places in the group (null = not set). */
  capacity: integer('capacity'),
  /** After-school care (Hort): a child in such a group on its school start stays instead of leaving the day before. */
  forSchoolChildren: integer('for_school_children', { mode: 'boolean' }).notNull().default(false),
  /** Minimum number of staff at opening and until closing, used with the group's own opening hours (1–20). */
  minAtOpening: integer('min_at_opening').notNull().default(1),
  minAtClosing: integer('min_at_closing').notNull().default(1),
  /** Palette key of the group's colour in the year calendar (see GROUP_COLORS; null = no colour). */
  color: text('color'),
  /** Group type (Gruppenart) of the staffing ratio, a key of the state's groupTypes (null = not entered). */
  groupType: text('group_type'),
  /** Development documentation (Entwicklungsdokumentation) of the group's children; see docSettings. */
  ...docSettings(),
}, table => [index('groups_facility').on(table.facilityId)])

/** The group a row belongs to (null = the whole facility, or no group of its own); always a group of the row's facility. */
const groupId = () => integer('group_id').references(() => groups.id)

export const employees = sqliteTable('employees', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** The home facility; every employee belongs to exactly one. */
  facilityId: facilityId(),
  /**
   * Day the employee moved into this facility (null = belongs to it from the start). Plan cells before it were planned
   * by another facility: they never count as that facility's unreleased changes and a discard never touches them.
   */
  facilitySince: text('facility_since'),
  /**
   * „Stundenkonto ab“ (ISO date): the hours account counts target and worked time only from the later of this day and
   * the first weekly hours (null = from the first weekly hours). Balance adjustments count by their own date; the leave
   * account is not affected.
   */
  balanceFrom: text('balance_from'),
  /** The home group in the home facility (null = Springer, or the facility has no groups). */
  groupId: groupId(),
  name: text('name').notNull(),
  shortName: text('short_name').notNull().default(''),
  sortOrder: integer('sort_order').notNull().default(0),
  leftOn: text('left_on'),
  /** Hash of the 6-digit stamp PIN for the shared tablet (null = no PIN). */
  pinHash: text('pin_hash'),
  pinFailed: integer('pin_failed').notNull().default(0),
  pinLockedUntil: text('pin_locked_until'),
  /** How often the PIN was locked since the last right entry: 1 = 15 minutes, 2 = 30 minutes, 3 = until a manager unlocks it. */
  pinLockLevel: integer('pin_lock_level').notNull().default(0),
  /** Where the employee may clock in and out (set by the Leitung). */
  stampVia: text('stamp_via', { enum: ['both', 'tablet'] }).notNull().default('both'),
  /** 'stamp': breaks are clocked (gaps count); 'auto': the planned break is deducted in full from the clocked time. */
  breakMode: text('break_mode', { enum: ['stamp', 'auto'] }).notNull().default('stamp'),
  // Contract data, edited only by the Träger (provider); see shared/domain/tvoed.ts.
  personnelNumber: text('personnel_number').unique(),
  employedSince: text('employed_since'),
  jobKey: text('job_key'),
  jobOther: text('job_other'),
  payGroup: text('pay_group'),
  payLevel: integer('pay_level'),
  /** Birthday as `MM-DD` without a year (null = not given), for the reminders; never shown with a year or age. */
  birthday: text('birthday'),
  /** Qualification for the staffing ratio (see shared/domain/staffing/types.ts; null = not entered yet). */
  qualification: text('qualification', { enum: QUALIFICATIONS }),
  /** Counting share for the staffing ratio in percent, 0–100 (null = the state's default for the qualification). */
  staffingShare: integer('staffing_share'),
  // Personnel file (spec Personalakte §2): address, contact and birth year under employees.personal.
  /** Year of birth; with `birthday` ('MM-DD') it forms the full date (null = not given). */
  birthYear: integer('birth_year'),
  street: text('street'),
  postalCode: text('postal_code'),
  city: text('city'),
  phone: text('phone'),
  email: text('email'),
  // Under employees.sensitive.
  nationality: text('nationality'),
  /** Schwerbehinderung. */
  disability: integer('disability', { mode: 'boolean' }).notNull().default(false),
  /** Grad der Behinderung, 20–100 in steps of 10 (null = not given). */
  disabilityDegree: integer('disability_degree'),
  /** „gleichgestellt“ (equal status with a severe disability). */
  disabilityEqual: integer('disability_equal', { mode: 'boolean' }).notNull().default(false),
  /** Valid until (ISO date; null = unlimited or not given). */
  disabilityUntil: text('disability_until'),
  /** „befristet bis“: end of a fixed-term contract (ISO date), visible like the other contract fields. */
  fixedTermUntil: text('fixed_term_until'),
  /** „Probezeit bis“: last day of the probation period (ISO date; null = none entered), contract data (shared/domain/probation.ts). */
  probationUntil: text('probation_until'),
  /**
   * „Ausbildung/Studium hier bis“ (ISO date; null = none): the level years start the day after (see levelStart in
   * shared/domain/tvoed.ts). Contract data like the fields above.
   */
  trainingUntil: text('training_until'),
  /** „Anerkennungsjahr zählt als Stufe 1“: the level years start one year before the day after trainingUntil. */
  recognitionYearCounts: integer('recognition_year_counts', { mode: 'boolean' }).notNull().default(false),
  /** „alleinerziehend“ (personal data like the children, employeeChildren): the higher Kinderkrankentage apply. */
  singleParent: integer('single_parent', { mode: 'boolean' }).notNull().default(false),
})

export const employeeHours = sqliteTable('employee_hours', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  weeklyMinutes: integer('weekly_minutes').notNull(),
  validFrom: text('valid_from').notNull(),
  /** Working days as bitmask, bit 0 = Monday … bit 6 = Sunday (31 = Monday–Friday). */
  workdays: integer('workdays').notNull().default(31),
}, table => [uniqueIndex('employee_hours_employee_valid_from').on(table.employeeId, table.validFrom)])

export const balanceAdjustments = sqliteTable('balance_adjustments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  minutes: integer('minutes').notNull(),
  reason: text('reason').notNull(),
  /** „ausgezahlt“: paid-out overtime, kept for the longer retention period after leaving (shared/domain/retention.ts). */
  paidOut: integer('paid_out', { mode: 'boolean' }).notNull().default(false),
})

export const leaveEntitlements = sqliteTable('leave_entitlements', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  year: integer('year').notNull(),
  days: real('days').notNull(),
  carriedOverDays: real('carried_over_days').notNull().default(0),
}, table => [uniqueIndex('leave_entitlements_employee_year').on(table.employeeId, table.year)])

/**
 * „Zusatztag nur für dieses Jahr“: one-off extra leave days of an employee in one year (e.g. „Dank für Sommerfest“),
 * 0.5 to 30 in half days, with a required reason. They raise only that year's available leave, never the entitlement of
 * the following years; what is left at the end of the year carries over like the other Resturlaub
 * (server/services/leave.ts yearEntitlement). Retention: with the leave entitlements. `createdBy` is the name of whoever
 * added them.
 */
export const leaveExtraDays = sqliteTable('leave_extra_days', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  year: integer('year').notNull(),
  days: real('days').notNull(),
  reason: text('reason').notNull(),
  createdBy: text('created_by').notNull().default(''),
  createdAt: text('created_at').notNull(),
}, table => [index('leave_extra_days_employee_year').on(table.employeeId, table.year)])

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  // TypeScript only: the column has no CHECK constraint, so the Gruppenleitung ('group_lead') needed no migration.
  role: text('role', { enum: ['provider', 'admin', 'group_lead', 'observer', 'terminal'] }).notNull(),
  employeeId: integer('employee_id').references(() => employees.id, { onDelete: 'set null' }).unique(),
  mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
  failedLogins: integer('failed_logins').notNull().default(0),
  lockedUntil: text('locked_until'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  /** Leitung and tablet: their facility. Träger: the active facility selection. Mitarbeiter: null (follows the employee). */
  facilityId: integer('facility_id').references(() => facilities.id),
  /**
   * The old flag „darf Kinderakten pflegen“ (Mitarbeiter). Since the rights page the right itself is the exception
   * `childrenEdit` in user_bundle_overrides (migration 0064 moved it there); the column is no longer read for rights.
   */
  canEditChildren: integer('can_edit_children', { mode: 'boolean' }).notNull().default(false),
})

export const shiftTemplates = sqliteTable('shift_templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: facilityId(),
  shortLabel: text('short_label').notNull().default(''),
  label: text('label').notNull(),
  start: integer('start').notNull(),
  end: integer('end').notNull(),
  breakStart: integer('break_start'),
  breakEnd: integer('break_end'),
  countsAsStaff: integer('counts_as_staff', { mode: 'boolean' }).notNull().default(true),
  /** Offered as the full shift around VZ/Büro (F2, M, S). */
  pairsWithPrepTime: integer('pairs_with_prep_time', { mode: 'boolean' }).notNull().default(false),
  /** Entries made with this button are home office (counts without stamping, not on site); only new entries get it. */
  homeOffice: integer('home_office', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
})

export const absenceCodes = sqliteTable('absence_codes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(),
  label: text('label').notNull(),
  color: text('color').notNull(),
  creditMode: text('credit_mode', { enum: ['daily_target', 'timed', 'none'] }).notNull(),
  requiresTimes: integer('requires_times', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
})

export const closures = sqliteTable('closures', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: facilityId(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  label: text('label').notNull(),
  mode: text('mode', { enum: ['vacation', 'closure_day'] }).notNull(),
})

export const entries = sqliteTable('entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  kind: text('kind', { enum: ['shift', 'special', 'code', 'break'] }).notNull(),
  shiftTemplateId: integer('shift_template_id').references(() => shiftTemplates.id, { onDelete: 'set null' }),
  absenceCodeId: integer('absence_code_id').references(() => absenceCodes.id),
  start: integer('start'),
  end: integer('end'),
  breakStart: integer('break_start'),
  breakEnd: integer('break_end'),
  countsAsStaff: integer('counts_as_staff', { mode: 'boolean' }).notNull().default(true),
  note: text('note'),
  closureId: integer('closure_id').references(() => closures.id, { onDelete: 'set null' }),
  /**
   * The facility whose plan this help-out entry belongs to (null = a normal entry of the home facility). Never the
   * employee's current home facility; all entries of one employee on one date share it (one day, one facility).
   */
  helpFacilityId: integer('help_facility_id').references(() => facilities.id),
  /** The group this single duty counts for (null = the employee's home group); a group of the plan's facility. */
  groupId: groupId(),
  /**
   * „Homeoffice – zählt ohne Stempeln“: the entry's time counts in the time tracking as if stamped (only on entries
   * with working time: shifts, special shifts, timed codes such as Büro or VZ).
   */
  homeOffice: integer('home_office', { mode: 'boolean' }).notNull().default(false),
  /** „Kind krank“: which of the employee's children (optional; the link goes when the child is removed). */
  employeeChildId: integer('employee_child_id').references(() => employeeChildren.id, { onDelete: 'set null' }),
  /**
   * „Sonderurlaub“: the reason (a key of SPECIAL_LEAVE_REASONS, shared/domain/specialLeave.ts) and a free text; null on
   * every other entry. Only for Leitung, Träger and the employee themselves: never part of the plan's entries.
   */
  specialLeaveReason: text('special_leave_reason'),
  specialLeaveText: text('special_leave_text'),
  updatedAt: text('updated_at').notNull(),
  updatedBy: integer('updated_by').references(() => users.id, { onDelete: 'set null' }),
}, table => [
  index('entries_date').on(table.date),
  index('entries_employee_date').on(table.employeeId, table.date),
])

/** An employee helps out in another facility (never their home) for a month: they get a helper column in its plan. */
export const helpOuts = sqliteTable('help_outs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id),
  year: integer('year').notNull(),
  month: integer('month').notNull(),
}, table => [uniqueIndex('help_outs_employee_facility_month').on(table.employeeId, table.facilityId, table.year, table.month)])

/**
 * The Träger's mutual permission for help-outs between two facilities (server/services/helpoutPairs.ts): one row per
 * pair, the smaller facility id first (the service keeps that order). Help-outs between the groups of one facility need
 * none. Without a row no help-out between the two can be planned, and planned ones give no visibility. Starts empty.
 */
export const facilityHelpoutPairs = sqliteTable('facility_helpout_pairs', {
  facilityAId: integer('facility_a_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  facilityBId: integer('facility_b_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
}, table => [
  primaryKey({ columns: [table.facilityAId, table.facilityBId] }),
  index('facility_helpout_pairs_b').on(table.facilityBId),
])

export const dayNotes = sqliteTable('day_notes', {
  facilityId: facilityId(),
  date: text('date').notNull(),
  info1: text('info1').notNull().default(''),
  info2: text('info2').notNull().default(''),
}, table => [primaryKey({ columns: [table.facilityId, table.date] })])

/** Mirrors the newest release snapshot of a month (written in the same transaction); also read by the internal change log. */
export const monthPlans = sqliteTable('month_plans', {
  facilityId: facilityId(),
  year: integer('year').notNull(),
  month: integer('month').notNull(),
  releasedAt: text('released_at'),
  releasedBy: integer('released_by').references(() => users.id, { onDelete: 'set null' }),
}, table => [primaryKey({ columns: [table.facilityId, table.year, table.month] })])

export const changeLog = sqliteTable('change_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: facilityId(),
  date: text('date').notNull(),
  employeeId: integer('employee_id').references(() => employees.id, { onDelete: 'cascade' }),
  field: text('field', { enum: ['entry', 'info1', 'info2'] }).notNull(),
  before: text('before').notNull(),
  after: text('after').notNull(),
  changedAt: text('changed_at').notNull(),
  changedBy: integer('changed_by').references(() => users.id, { onDelete: 'set null' }),
}, table => [index('change_log_date').on(table.date), index('change_log_facility_date').on(table.facilityId, table.date)])

export const coverageRules = sqliteTable('coverage_rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: facilityId(),
  label: text('label').notNull(),
  start: integer('start').notNull(),
  end: integer('end'),
  minCount: integer('min_count').notNull().default(1),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  /** The group the rule applies to (null = the whole facility). */
  groupId: groupId(),
  /** Weekdays the rule is checked on: bit 0 = Monday … bit 4 = Friday (31 = every weekday). */
  weekdays: integer('weekdays').notNull().default(31),
})

/**
 * Opening hours of one weekday (0 = Monday … 4 = Friday) of a facility (`groupId` null) or of a group with its own hours.
 * A day without a row, or with neither times nor `closed`, is not entered. The minimum counts live on the facility / group.
 */
export const openingHours = sqliteTable('opening_hours', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  groupId: integer('group_id').references(() => groups.id, { onDelete: 'cascade' }),
  weekday: integer('weekday').notNull(),
  open: integer('open'),
  close: integer('close'),
  closed: integer('closed', { mode: 'boolean' }).notNull().default(false),
}, table => [
  // NULLs are distinct in a unique index, so the facility's rows (no group) and the groups' rows each need their own.
  uniqueIndex('opening_hours_facility_weekday').on(table.facilityId, table.weekday).where(sql`\`group_id\` IS NULL`),
  uniqueIndex('opening_hours_group_weekday').on(table.groupId, table.weekday).where(sql`\`group_id\` IS NOT NULL`),
])

export const releaseSnapshots = sqliteTable('release_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: facilityId(),
  year: integer('year').notNull(),
  month: integer('month').notNull(),
  releasedAt: text('released_at').notNull(),
  releasedBy: integer('released_by').references(() => users.id, { onDelete: 'set null' }),
  /** JSON of SnapshotData */
  data: text('data').notNull(),
}, table => [
  index('release_snapshots_month').on(table.year, table.month),
  index('release_snapshots_facility_month').on(table.facilityId, table.year, table.month),
])

/** One clocked period of a day; end null = still clocked in. */
export const timeRecords = sqliteTable('time_records', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  start: integer('start').notNull(),
  end: integer('end'),
  source: text('source', { enum: ['self', 'terminal', 'admin'] }).notNull(),
  editedBy: integer('edited_by').references(() => users.id, { onDelete: 'set null' }),
  editedAt: text('edited_at'),
  createdAt: text('created_at').notNull(),
  /** Kommt or Geht came from the tablet's offline queue („offline erfasst“). */
  offline: integer('offline', { mode: 'boolean' }).notNull().default(false),
  /** The tablet's clock was off by this many minutes when it sent the offline stamp (null = within 5 minutes). */
  clockSkewMinutes: integer('clock_skew_minutes'),
}, table => [index('time_records_employee_date').on(table.employeeId, table.date)])

/**
 * Every stamp the tablet sent from its offline queue, by the tablet's random client id (a stamp sent twice is taken
 * once). Those not taken over with a person (wrong PIN, too old, not fitting the records …) are the review list of the
 * time page until the Leitung or the Träger marks them checked. The PIN is never stored.
 */
export const offlineStamps = sqliteTable('offline_stamps', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clientId: text('client_id').notNull().unique(),
  /** The tablet's facility. */
  facilityId: facilityId(),
  /** null when the tablet named a person it does not know. */
  employeeId: integer('employee_id').references(() => employees.id, { onDelete: 'cascade' }),
  action: text('action', { enum: ['in', 'out'] }).notNull(),
  /** The tablet's clock at the tap, as sent (ISO with offset). */
  stampedAt: text('stamped_at').notNull(),
  /** Day and minute of the tap in Berlin. */
  date: text('date').notNull(),
  minutes: integer('minutes').notNull(),
  status: text('status', { enum: ['recorded', 'review', 'rejected'] }).notNull(),
  reason: text('reason'),
  recordId: integer('record_id').references(() => timeRecords.id, { onDelete: 'set null' }),
  clockSkewMinutes: integer('clock_skew_minutes'),
  receivedAt: text('received_at').notNull(),
  checkedAt: text('checked_at'),
  checkedBy: integer('checked_by').references(() => users.id, { onDelete: 'set null' }),
}, table => [index('offline_stamps_employee').on(table.employeeId)])

/** Audit trail of admin corrections of time records. */
export const timeRecordChanges = sqliteTable('time_record_changes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  recordId: integer('record_id'),
  before: text('before').notNull(),
  after: text('after').notNull(),
  actorId: integer('actor_id').references(() => users.id, { onDelete: 'set null' }),
  at: text('at').notNull(),
}, table => [index('time_record_changes_employee_date').on(table.employeeId, table.date)])

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

/** Admin's free-text reason per employee and day on the time tracking page (not shown to employees). */
export const timeDayNotes = sqliteTable('time_day_notes', {
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  note: text('note').notNull(),
}, table => [primaryKey({ columns: [table.employeeId, table.date] })])

/** Days the facility closed earlier than usual (admin-only record; no effect on working hours). */
export const earlyClosures = sqliteTable('early_closures', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: facilityId(),
  date: text('date').notNull(),
  closedFrom: integer('closed_from').notNull(),
  reason: text('reason').notNull(),
}, table => [uniqueIndex('early_closures_facility_date').on(table.facilityId, table.date)])

/** Admin's own appointments for the year calendar (Elternabend, Teamsitzung …); no effect on plan or hours. */
export const calendarEvents = sqliteTable('calendar_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: facilityId(),
  date: text('date').notNull(),
  start: integer('start'),
  end: integer('end'),
  title: text('title').notNull(),
  /** Shown to the employees in their year calendar (the Leitung decides per appointment). */
  visibleToStaff: integer('visible_to_staff', { mode: 'boolean' }).notNull().default(false),
}, table => [index('calendar_events_date').on(table.date)])

/** Saved plan weeks (Mo–Fr for all employees) that the admin can insert into any week of the plan. */
export const weekTemplates = sqliteTable('week_templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: facilityId(),
  name: text('name').notNull(),
  updatedAt: text('updated_at').notNull(),
  /** The group the template is for (null = the whole facility). */
  groupId: groupId(),
}, table => [uniqueIndex('week_templates_facility_name').on(table.facilityId, table.name)])

/** One working entry of a week template (shift, special shift, break, VZ or Büro) on a weekday (0 = Monday). */
export const weekTemplateEntries = sqliteTable('week_template_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  weekTemplateId: integer('week_template_id').notNull().references(() => weekTemplates.id, { onDelete: 'cascade' }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  weekday: integer('weekday').notNull(),
  kind: text('kind', { enum: ['shift', 'special', 'code', 'break'] }).notNull(),
  shiftTemplateId: integer('shift_template_id').references(() => shiftTemplates.id, { onDelete: 'set null' }),
  absenceCodeId: integer('absence_code_id').references(() => absenceCodes.id),
  start: integer('start'),
  end: integer('end'),
  breakStart: integer('break_start'),
  breakEnd: integer('break_end'),
  countsAsStaff: integer('counts_as_staff', { mode: 'boolean' }).notNull().default(true),
  note: text('note'),
  /** „Homeoffice – zählt ohne Stempeln“ of the saved entry; filling a week writes it into the plan again. */
  homeOffice: integer('home_office', { mode: 'boolean' }).notNull().default(false),
}, table => [index('week_template_entries_template').on(table.weekTemplateId)])

/** The plan's Info 1 / Info 2 texts of a week template on a weekday (0 = Monday … 6 = Sunday); a day without any has no row. */
export const weekTemplateInfos = sqliteTable('week_template_infos', {
  weekTemplateId: integer('week_template_id').notNull().references(() => weekTemplates.id, { onDelete: 'cascade' }),
  weekday: integer('weekday').notNull(),
  info1: text('info1').notNull().default(''),
  info2: text('info2').notNull().default(''),
}, table => [primaryKey({ columns: [table.weekTemplateId, table.weekday] })])

/** Which template a plan week came from or was saved as (latest wins); its name is shown in the plan's week row. */
export const weekTemplateMarks = sqliteTable('week_template_marks', {
  facilityId: facilityId(),
  weekStart: text('week_start').notNull(),
  weekTemplateId: integer('week_template_id').notNull().references(() => weekTemplates.id, { onDelete: 'cascade' }),
  /** The group's week (0 = the whole facility; no foreign key, as 0 is no group). */
  groupId: integer('group_id').notNull().default(0),
}, table => [primaryKey({ columns: [table.facilityId, table.groupId, table.weekStart] })])

/**
 * Each time a week template filled a plan week, for the hint in the plan's week row (editors only). The template's
 * name and the applier's username are kept as they were (a deleted template keeps its name; the username is kept like
 * the names of the change log); the rows go with the facility only.
 */
export const weekTemplateUses = sqliteTable('week_template_uses', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: facilityId(),
  /** The Monday of the plan week. */
  weekStart: text('week_start').notNull(),
  templateId: integer('template_id').references(() => weekTemplates.id, { onDelete: 'set null' }),
  templateName: text('template_name').notNull(),
  appliedAt: text('applied_at').notNull(),
  appliedBy: text('applied_by').notNull(),
  /**
   * The facility's plan of that week right after the apply, as a fingerprint of its entries (weekFingerprint): another
   * fingerprint now means it was entered, changed or deleted in since („danach angepasst“).
   */
  weekFingerprint: text('week_fingerprint').notNull(),
}, table => [index('week_template_uses_facility_week').on(table.facilityId, table.weekStart)])

/** Message to an employee that their released duties changed (created when a month is released again). */
export const notifications = sqliteTable('notifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  year: integer('year').notNull(),
  month: integer('month').notNull(),
  /** Time of the release that caused it (same as month_plans.released_at then). */
  createdAt: text('created_at').notNull(),
  readAt: text('read_at'),
  /** JSON list of { date, before, after } (cell texts). */
  changes: text('changes').notNull(),
}, table => [index('notifications_employee').on(table.employeeId)])

/** An employee's request for leave (Urlaubsantrag); approving writes "Urlaub" into the plan. */
export const leaveRequests = sqliteTable('leave_requests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  note: text('note').notNull().default(''),
  status: text('status', { enum: ['open', 'approved', 'rejected', 'withdrawn'] }).notNull().default('open'),
  /** 'vacation' = Urlaub (uses leave days), 'overtime_off' = Überstundenfrei (taken from the balance). */
  kind: text('kind', { enum: ['vacation', 'overtime_off'] }).notNull().default('vacation'),
  createdAt: text('created_at').notNull(),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  decidedAt: text('decided_at'),
  decidedBy: integer('decided_by').references(() => users.id, { onDelete: 'set null' }),
  decisionNote: text('decision_note').notNull().default(''),
}, table => [index('leave_requests_employee').on(table.employeeId), index('leave_requests_status').on(table.status)])

/**
 * „Gelesen“ on the notice on remaining leave (server/services/leaveForfeit.ts), with the days and the very text shown,
 * as evidence that the employee was told. Never changed afterwards; a later notice of the year (more days, another
 * forfeiture date or text) gets a receipt of its own.
 */
export const leaveForfeitReceipts = sqliteTable('leave_forfeit_receipts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  /** The year the remaining leave comes from. */
  year: integer('year').notNull(),
  days: real('days').notNull(),
  text: text('text').notNull(),
  readAt: text('read_at').notNull(),
  /** The account that clicked „Gelesen“ (the employee's own). */
  readBy: integer('read_by').references(() => users.id, { onDelete: 'set null' }),
}, table => [index('leave_forfeit_receipts_employee_year').on(table.employeeId, table.year)])

/**
 * Accounts (Träger/Leitung) the Träger made responsible for leave planning: who gets the notifications. Since the
 * rights page a Leitung's right to plan is the bundle `leavePlan` (role setting or exception), not this list.
 */
export const leavePlanners = sqliteTable('leave_planners', {
  userId: integer('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
})

/**
 * The Träger's role settings on the rights page: a bundle (shared/domain/permissionBundles.ts) on or off for every
 * account of the role, with its scope for the children bundles (null = the role's default scope). A bundle without a
 * row keeps its default; unknown bundles are ignored. `role` stays free text ('admin' | 'group_lead' |
 * 'observer').
 */
export const roleBundles = sqliteTable('role_bundles', {
  role: text('role').$type<RightsRole>().notNull(),
  bundle: text('bundle').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull(),
  scope: text('scope', { enum: ['group', 'facility'] }),
}, table => [primaryKey({ columns: [table.role, table.bundle] })])

/** Exceptions per account: a bundle granted or revoked for this one person, over the role setting. */
export const userBundleOverrides = sqliteTable('user_bundle_overrides', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bundle: text('bundle').notNull(),
  effect: text('effect', { enum: ['grant', 'revoke'] }).notNull(),
  scope: text('scope', { enum: ['group', 'facility'] }),
}, table => [primaryKey({ columns: [table.userId, table.bundle] })])

/**
 * A kind of mandatory appointment or proof (Pflichttermin) of a facility. Its name is unique within the facility,
 * compared case-insensitively. Every facility has the seven built-in kinds (see shared/domain/requirements.ts).
 */
export const requirementTypes = sqliteTable('requirement_types', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id),
  name: text('name').notNull(),
  /** Due again every this many months (null = needed once). */
  intervalMonths: integer('interval_months'),
  /** The second record is due this many months after the first (null = after intervalMonths as well; ArbMedVV). */
  firstIntervalMonths: integer('first_interval_months'),
  /** Key of a built-in kind, which cannot be deleted (null = one of the facility's own kinds). */
  builtinKey: text('builtin_key'),
  sortOrder: integer('sort_order').notNull().default(0),
}, table => [uniqueIndex('requirement_types_facility_builtin').on(table.facilityId, table.builtinKey)])

/**
 * One appointment kept or proof shown by an employee; the rows of an employee and kind form the history, and the newest
 * date counts. The kind always belongs to the employee's home facility.
 */
export const employeeRequirements = sqliteTable('employee_requirements', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  typeId: integer('type_id').notNull().references(() => requirementTypes.id, { onDelete: 'cascade' }),
  /** Day of the appointment, or the day the proof was shown. */
  date: text('date').notNull(),
  note: text('note'),
}, table => [
  index('employee_requirements_employee').on(table.employeeId),
  index('employee_requirements_type').on(table.typeId),
])

/** A training (Fortbildung) an employee took part in; it stays with the employee in whatever facility they work. */
export const employeeTrainings = sqliteTable('employee_trainings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  title: text('title').notNull(),
  note: text('note'),
}, table => [index('employee_trainings_employee').on(table.employeeId)])

/** An employee's emergency contact (Notfallkontakt), only for Leitung and Träger; the first in the order is called first. */
export const employeeEmergencyContacts = sqliteTable('employee_emergency_contacts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull().default(0),
  name: text('name').notNull(),
  relation: text('relation').notNull().default(''),
  phone: text('phone').notNull(),
  phone2: text('phone2').notNull().default(''),
  note: text('note').notNull().default(''),
}, table => [index('employee_emergency_contacts_employee').on(table.employeeId)])

/**
 * Whether an employee agreed that colleagues see their emergency contacts at the facility tablet (after unlocking with
 * name and PIN); at most one row, none means no consent. The consent is the employee's own (switch in „Meins“,
 * source 'self') or a written one the Leitung recorded (source 'written'); a withdrawal by the employee always wins.
 */
export const employeeEmergencyConsent = sqliteTable('employee_emergency_consent', {
  employeeId: integer('employee_id').primaryKey().references(() => employees.id, { onDelete: 'cascade' }),
  consent: integer('consent', { mode: 'boolean' }).notNull().default(false),
  /** When this state was recorded (ISO timestamp). */
  consentAt: text('consent_at').notNull(),
  /** The day of the consent: the day it was given in the app, or the day of the written declaration. */
  consentDate: text('consent_date').notNull(),
  /** 'self' or the user name of the Leitung/Träger who recorded it. */
  consentBy: text('consent_by').notNull(),
  source: text('source', { enum: ['self', 'written'] }).notNull(),
})

/** Every grant and withdrawal of that consent, never changed afterwards (who, when). */
export const employeeEmergencyConsentLog = sqliteTable('employee_emergency_consent_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  granted: integer('granted', { mode: 'boolean' }).notNull(),
  source: text('source', { enum: ['self', 'written'] }).notNull(),
  /** 'self' or the user name of who recorded it. */
  by: text('by').notNull(),
  /** ISO timestamp of the entry. */
  at: text('at').notNull(),
  /** The day it concerns: the written declaration's day, otherwise the Berlin day of `at`. */
  date: text('date').notNull(),
}, table => [index('employee_emergency_consent_log_employee').on(table.employeeId)])

/** „Lohn und Steuer“ of an employee (employees.payroll only); at most one row, every field optional. */
export const employeePayroll = sqliteTable('employee_payroll', {
  employeeId: integer('employee_id').primaryKey().references(() => employees.id, { onDelete: 'cascade' }),
  /** Steuer-ID, 11 digits without spaces. */
  taxId: text('tax_id'),
  /** Steuerklasse 1–6. */
  taxClass: integer('tax_class'),
  /** Sozialversicherungsnummer, 12 characters without spaces. */
  svNumber: text('sv_number'),
  healthInsurer: text('health_insurer'),
  /** Upper case, without spaces. */
  iban: text('iban'),
  accountHolder: text('account_holder'),
  /** Konfession (Kirchensteuer). */
  denomination: text('denomination'),
})

/**
 * A child of an employee (personal data, employees.personal): for the Kinderkrankentage (§ 45 SGB V, eligible under 12
 * or with a disability and dependent on help) and the parent status of the Pflegeversicherung (children under 25).
 */
export const employeeChildren = sqliteTable('employee_children', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  /** Optional, only to tell the children apart. */
  firstName: text('first_name'),
  birthDate: text('birth_date').notNull(),
  /** „Kind mit Behinderung, auf Hilfe angewiesen“: eligible for Kinderkrankentage at any age. */
  disabledDependent: integer('disabled_dependent', { mode: 'boolean' }).notNull().default(false),
}, table => [index('employee_children_employee').on(table.employeeId)])

/**
 * An uploaded document (PDF, JPEG or PNG) in an employee's personnel file, in one of the folders (each with its own
 * permission and retention category, shared/domain/personnel.ts); the file itself lives in the database.
 */
export const employeeDocuments = sqliteTable('employee_documents', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  folder: text('folder', { enum: EMPLOYEE_DOCUMENT_FOLDERS }).notNull(),
  title: text('title').notNull().default(''),
  documentDate: text('document_date'),
  note: text('note').notNull().default(''),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  data: blob('data', { mode: 'buffer' }).notNull(),
  uploadedBy: integer('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
  uploadedAt: text('uploaded_at').notNull(),
  /** A PDF form with fields to fill in the app (server/lib/pdfForm.ts, judged when the file is stored); null = not judged yet. */
  fillable: integer('fillable', { mode: 'boolean' }),
}, table => [index('employee_documents_employee').on(table.employeeId)])

/**
 * "Im Dienst erkrankt": the employee fell ill during the duty of that day and left early. The day stays a working day
 * (no sick day), its planned time is credited in full, and the marker is only for Leitung and Träger. It belongs to the
 * person: one per employee and day, kept when they move to another facility.
 */
export const earlySickLeaves = sqliteTable('early_sick_leaves', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  /** Time of leaving in minutes of the day (null = not entered: the end of the last time record counts). */
  leftAt: integer('left_at'),
  note: text('note'),
  createdAt: text('created_at').notNull(),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
}, table => [uniqueIndex('early_sick_leaves_employee_date').on(table.employeeId, table.date)])

/** A care type (Betreuungsart) of a facility, e.g. a booking time window; times in minutes since midnight. */
export const careTypes = sqliteTable('care_types', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: facilityId(),
  name: text('name').notNull(),
  start: integer('start').notNull(),
  end: integer('end').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  /** Care days per week (1–7); with start and end it gives the child's weekly hours for the staffing ratio. */
  daysPerWeek: integer('days_per_week').notNull().default(5),
}, table => [index('care_types_facility').on(table.facilityId)])

/** A kind of document in a child's record (Dokumentart); important/required drive the completeness view. */
export const documentTypes = sqliteTable('document_types', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: facilityId(),
  name: text('name').notNull(),
  important: integer('important', { mode: 'boolean' }).notNull().default(false),
  required: integer('required', { mode: 'boolean' }).notNull().default(false),
  /** New documents of this type start out confidential. */
  confidentialDefault: integer('confidential_default', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  /** The type of the care contract (Betreuungsvertrag); at most one per facility, which the service sees to. */
  careContract: integer('care_contract', { mode: 'boolean' }).notNull().default(false),
}, table => [index('document_types_facility').on(table.facilityId)])

/** A child's record (Kinderakte). Tri-state columns: null = not answered yet. */
export const children = sqliteTable('children', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: facilityId(),
  /**
   * Day the record was moved into this facility (null = it was created here). The time before it belongs to another
   * facility: the occupancy counts the child here only from this day on.
   */
  facilitySince: text('facility_since'),
  /** The child's group; null = no group (also after the group was deleted). */
  groupId: integer('group_id').references(() => groups.id, { onDelete: 'set null' }),
  careTypeId: integer('care_type_id').references(() => careTypes.id),
  lastName: text('last_name').notNull(),
  firstName: text('first_name').notNull(),
  birthDate: text('birth_date').notNull(),
  address: text('address').notNull().default(''),
  entryDate: text('entry_date'),
  plannedEntryDate: text('planned_entry_date'),
  /** 'waitlist' = Vormerkung (no contract yet, never active, needs no entry date); 'contract' = a child with a contract. */
  admissionStatus: text('admission_status', { enum: ['waitlist', 'contract'] }).notNull().default('contract'),
  /** Day the child was put on the waitlist; only kept for waitlist children. */
  waitlistedOn: text('waitlisted_on'),
  infoMeetingDate: text('info_meeting_date'),
  schoolStartDate: text('school_start_date'),
  primarySchool: text('primary_school').notNull().default(''),
  schoolDistrict: text('school_district').notNull().default(''),
  /**
   * The child's Bezugserzieher, an employee of the child's facility; null = nobody (also after the employee was deleted).
   * Whether the person still counts (same facility, not left) is checked when reading; see services/children.
   */
  keyEducatorId: integer('key_educator_id').references(() => employees.id, { onDelete: 'set null' }),
  note: text('note').notNull().default(''),
  /** „künftige Schule“: a contact of the address book (a school); null = none, also after the contact was deleted. */
  futureSchoolContactId: integer('future_school_contact_id').references((): AnySQLiteColumn => contacts.id, { onDelete: 'set null' }),
  leftOn: text('left_on'),
  // Health
  measlesProof: integer('measles_proof', { mode: 'boolean' }),
  measlesProofDate: text('measles_proof_date'),
  infectionBriefingDate: text('infection_briefing_date'),
  allergies: text('allergies').notNull().default(''),
  // Since 0111 these three and the consents below are questions of the facility (child_consent_answers): the columns
  // are no longer read or written and stay only for a rollback (docs/BETRIEB.md: drop them in a later release).
  mayTakeTemperature: integer('may_take_temperature', { mode: 'boolean' }),
  mayApplySunscreen: integer('may_apply_sunscreen', { mode: 'boolean' }),
  mayApplyPlaster: integer('may_apply_plaster', { mode: 'boolean' }),
  // Consents (Einwilligungen), unused since 0111 (see above)
  consentArtworkDisplay: integer('consent_artwork_display', { mode: 'boolean' }),
  consentPhotosDisplay: integer('consent_photos_display', { mode: 'boolean' }),
  consentPhotosForeignPortfolios: integer('consent_photos_foreign_portfolios', { mode: 'boolean' }),
  consentPhotosInternalEvents: integer('consent_photos_internal_events', { mode: 'boolean' }),
  consentPhotosNamesBirthdaysDisplay: integer('consent_photos_names_birthdays_display', { mode: 'boolean' }),
  consentGroupWorkWithNames: integer('consent_group_work_with_names', { mode: 'boolean' }),
  consentWhatsappContact: integer('consent_whatsapp_contact', { mode: 'boolean' }),
  consentWhatsappPhotos: integer('consent_whatsapp_photos', { mode: 'boolean' }),
  consentSignalPhotos: integer('consent_signal_photos', { mode: 'boolean' }),
  consentWhatsappParentGroup: integer('consent_whatsapp_parent_group', { mode: 'boolean' }),
  consentInsectRepellent: integer('consent_insect_repellent', { mode: 'boolean' }),
  // Who changed which section last
  masterUpdatedAt: text('master_updated_at'),
  masterUpdatedBy: integer('master_updated_by').references(() => users.id, { onDelete: 'set null' }),
  contactsUpdatedAt: text('contacts_updated_at'),
  contactsUpdatedBy: integer('contacts_updated_by').references(() => users.id, { onDelete: 'set null' }),
  healthUpdatedAt: text('health_updated_at'),
  healthUpdatedBy: integer('health_updated_by').references(() => users.id, { onDelete: 'set null' }),
  consentsUpdatedAt: text('consents_updated_at'),
  consentsUpdatedBy: integer('consents_updated_by').references(() => users.id, { onDelete: 'set null' }),
  // Sections not confirmed since the group change of this day (null = confirmed); set when a change is applied.
  contactsReviewSince: text('contacts_review_since'),
  healthReviewSince: text('health_review_since'),
  consentsReviewSince: text('consents_review_since'),
  documentsReviewSince: text('documents_review_since'),
  careTypeReviewSince: text('care_type_review_since'),
  keyEducatorReviewSince: text('key_educator_review_since'),
  /** The further care contract of a change into a group for school children is not confirmed since this day. */
  contractReviewSince: text('contract_review_since'),
  createdAt: text('created_at').notNull(),
}, table => [
  index('children_facility').on(table.facilityId),
  index('children_group').on(table.groupId),
])

/**
 * A consent question (Einwilligung / Erlaubnis) of the facility, asked in every child's record with ja / nein / keine
 * Angabe: the full `text` (1–300), the `short` column head of the overview (1–40) and a free `area` (Datenschutz,
 * Messenger, Gesundheit or the facility's own), ordered by `sortOrder` (areas in the order of their first question).
 * A hidden question is no longer asked; its answers stay as proof. `builtinKey` marks the questions that were fixed
 * columns of `children` before 0111 (shared/domain/childConsents.ts; the attendance list reads the insect repellent by it).
 */
export const childConsentQuestions = sqliteTable('child_consent_questions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  short: text('short').notNull(),
  area: text('area').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
  builtinKey: text('builtin_key'),
}, table => [
  index('child_consent_questions_facility').on(table.facilityId),
  uniqueIndex('child_consent_questions_facility_builtin').on(table.facilityId, table.builtinKey),
])

/** A child's answer to a consent question: only ja (true) or nein (false) are stored; no row = keine Angabe. */
export const childConsentAnswers = sqliteTable('child_consent_answers', {
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  questionId: integer('question_id').notNull().references(() => childConsentQuestions.id, { onDelete: 'cascade' }),
  value: integer('value', { mode: 'boolean' }).notNull(),
}, table => [
  primaryKey({ columns: [table.childId, table.questionId] }),
  index('child_consent_answers_question').on(table.questionId),
])

/**
 * A tab of the children overview (Kinder → Übersicht) of the facility: its name (1–40), its place and its columns in
 * order, each a consent question of the facility or a fixed field (OverviewColumnRef, shared/domain/childConsents.ts).
 */
export const childOverviewSheets = sqliteTable('child_overview_sheets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  columns: text('columns', { mode: 'json' }).$type<OverviewColumnRef[]>().notNull().default(sql`'[]'`),
}, table => [index('child_overview_sheets_facility').on(table.facilityId)])

/**
 * A child's group history: "in group `groupId` from `fromDate` on". Every child has exactly one start entry
 * (`fromDate` null = from the beginning) and at most one entry per day. An entry without `appliedAt` is a planned
 * change the daily run has not applied yet; `children.groupId` follows the applied entries.
 */
export const childGroupChanges = sqliteTable('child_group_changes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  /** null = no group (also after the group was deleted). */
  groupId: integer('group_id').references(() => groups.id, { onDelete: 'set null' }),
  fromDate: text('from_date'),
  // false = the section must be confirmed again after the change.
  keepContacts: integer('keep_contacts', { mode: 'boolean' }).notNull().default(true),
  keepHealth: integer('keep_health', { mode: 'boolean' }).notNull().default(true),
  keepConsents: integer('keep_consents', { mode: 'boolean' }).notNull().default(true),
  keepDocuments: integer('keep_documents', { mode: 'boolean' }).notNull().default(true),
  keepCareType: integer('keep_care_type', { mode: 'boolean' }).notNull().default(true),
  keepKeyEducator: integer('keep_key_educator', { mode: 'boolean' }).notNull().default(true),
  /** A change into a group for school children: the further care contract it needs was confirmed when planning it. */
  newContract: integer('new_contract', { mode: 'boolean' }).notNull().default(false),
  /** ISO timestamp of applying the change to the child; null = planned. */
  appliedAt: text('applied_at'),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull(),
}, table => [
  uniqueIndex('child_group_changes_child_date').on(table.childId, table.fromDate),
  // NULLs are distinct in a unique index, so the single start entry needs its own.
  uniqueIndex('child_group_changes_child_start').on(table.childId).where(sql`\`from_date\` IS NULL`),
  index('child_group_changes_group').on(table.groupId),
])

/** A contact person of a child (guardian, emergency contact, pick-up person). */
export const childContacts = sqliteTable('child_contacts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull().default(0),
  name: text('name').notNull(),
  relation: text('relation').notNull().default(''),
  phoneHome: text('phone_home').notNull().default(''),
  phoneMobile: text('phone_mobile').notNull().default(''),
  phoneWork: text('phone_work').notNull().default(''),
  isGuardian: integer('is_guardian', { mode: 'boolean' }).notNull().default(false),
  mayPickUp: integer('may_pick_up', { mode: 'boolean' }).notNull().default(false),
  contactBan: integer('contact_ban', { mode: 'boolean' }).notNull().default(false),
  /** Position in the emergency call order (1 = first); null = not an emergency contact. */
  emergencyRank: integer('emergency_rank'),
  contactBanNote: text('contact_ban_note').notNull().default(''),
  note: text('note').notNull().default(''),
}, table => [index('child_contacts_child').on(table.childId)])

/** An uploaded document (PDF, JPEG or PNG) in a child's record; the file itself lives in the database. */
export const childDocuments = sqliteTable('child_documents', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  documentTypeId: integer('document_type_id').notNull().references(() => documentTypes.id),
  title: text('title').notNull().default(''),
  documentDate: text('document_date'),
  /** Only readers with the right to see confidential documents get it. */
  confidential: integer('confidential', { mode: 'boolean' }).notNull().default(false),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  data: blob('data', { mode: 'buffer' }).notNull(),
  uploadedBy: integer('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
  uploadedAt: text('uploaded_at').notNull(),
  /** A PDF form with fields to fill in the app (server/lib/pdfForm.ts, judged when the file is stored); null = not judged yet. */
  fillable: integer('fillable', { mode: 'boolean' }),
}, table => [index('child_documents_child').on(table.childId)])

/**
 * A development documentation (Entwicklungsdokumentation) of a child marked done on `doneOn` (Berlin date), by an
 * account (`doneByUserId`) and/or an employee (`doneByEmployeeId`; the tablet person without an account) and always by
 * name, which stays when the person is deleted. The latest done date counts for the reminder.
 */
export const childDevelopmentDocs = sqliteTable('child_development_docs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  doneOn: text('done_on').notNull(),
  doneByUserId: integer('done_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  doneByEmployeeId: integer('done_by_employee_id').references(() => employees.id, { onDelete: 'set null' }),
  doneByName: text('done_by_name').notNull().default(''),
  createdAt: text('created_at').notNull(),
}, table => [index('child_development_docs_child').on(table.childId)])

/**
 * A notifiable disease of a child under § 34 IfSG (health data; deleted with the child record). `disease` is a key of
 * the facility's rules (`ifsgRulesFor`: the RKI catalogue, later local ones), kept as text. `kind`: erkrankt/Verdacht
 * (Abs. 1), Ausscheider (Abs. 2), Erkrankung in der Wohngemeinschaft (Abs. 3). `reportedOn` is the attendance day the
 * case was entered on (from that day „Kommt“ is blocked until the readmission), `onsetDate` the beginning of the illness
 * (or the contact), `ruleVariant`/`ruleDate` the chosen date rule of the disease and the date it counts from (antibiotic
 * start, rash onset, symptom end, last contact …; null = not known yet). The readmission stores its day, a note, who
 * confirmed it and an optional attest as a child document. The Leitung's duty to notify the health office ends with
 * `healthOfficeNotifiedOn` or the physician's report (§ 6 IfSG). `ended`: closed by the Leitung without a readmission.
 */
export const childIfsgCases = sqliteTable('child_ifsg_cases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  facilityId: facilityId(),
  disease: text('disease').notNull(),
  kind: text('kind', { enum: ['sick', 'carrier', 'household'] }).notNull(),
  reportedOn: text('reported_on').notNull(),
  onsetDate: text('onset_date').notNull(),
  ruleVariant: text('rule_variant'),
  /**
   * The chosen date rule as it was when chosen (anchor, days, label, condition): the earliest day keeps counting by it
   * when the facility's rules change later. Null = no rule (or a case from before the snapshot: the key is resolved).
   */
  ruleAnchor: text('rule_anchor'),
  ruleDays: integer('rule_days'),
  ruleLabel: text('rule_label').notNull().default(''),
  ruleCondition: text('rule_condition').notNull().default(''),
  ruleDate: text('rule_date'),
  createdByUserId: integer('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdByName: text('created_by_name').notNull().default(''),
  createdAt: text('created_at').notNull(),
  readmittedOn: text('readmitted_on'),
  readmissionNote: text('readmission_note').notNull().default(''),
  readmittedByName: text('readmitted_by_name').notNull().default(''),
  readmissionAttachmentId: integer('readmission_attachment_id').references(() => childDocuments.id, { onDelete: 'set null' }),
  healthOfficeNotifiedOn: text('health_office_notified_on'),
  physicianReported: integer('physician_reported', { mode: 'boolean' }).notNull().default(false),
  ended: integer('ended', { mode: 'boolean' }).notNull().default(false),
}, table => [index('child_ifsg_cases_child').on(table.childId), index('child_ifsg_cases_facility').on(table.facilityId)])

/**
 * The local health office's rule for a disease (shared/domain/ifsgLocal.ts), taking precedence over the RKI field by
 * field; null = the RKI value. `custom`: a local disease (then `name` and `notifiable`). `rules`: JSON list of date
 * rules ({anchor, days, label}), null = the RKI ones. One row per facility and disease key.
 */
export const ifsgLocalRules = sqliteTable('ifsg_local_rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  disease: text('disease').notNull(),
  custom: integer('custom', { mode: 'boolean' }).notNull().default(false),
  name: text('name'),
  notifiable: integer('notifiable', { mode: 'boolean' }),
  text: text('text'),
  rules: text('rules'),
  proof: text('proof'),
  notify: integer('notify', { mode: 'boolean' }),
  householdText: text('household_text'),
  householdExclusion: integer('household_exclusion', { mode: 'boolean' }),
  note: text('note'),
  hint: text('hint'),
  updatedAt: text('updated_at').notNull(),
}, table => [uniqueIndex('ifsg_local_rules_disease').on(table.facilityId, table.disease)])

/** The local health office's documents for the readmission (PDF/JPG/PNG), readable at the tablet in the app. */
export const ifsgDocuments = sqliteTable('ifsg_documents', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  title: text('title').notNull().default(''),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  data: blob('data', { mode: 'buffer' }).notNull(),
  uploadedBy: integer('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
  uploadedAt: text('uploaded_at').notNull(),
}, table => [index('ifsg_documents_facility').on(table.facilityId)])

/**
 * A cluster of a disease (§ 34 Abs. 6 Satz 2) the Leitung reported to the health office on `acknowledgedOn`; it covers
 * the cases up to `upTo` (the last case day of the cluster then), a later case brings the reminder back.
 */
export const ifsgClusterAcks = sqliteTable('ifsg_cluster_acks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  disease: text('disease').notNull(),
  upTo: text('up_to').notNull(),
  acknowledgedOn: text('acknowledged_on').notNull(),
  acknowledgedByName: text('acknowledged_by_name').notNull().default(''),
  createdAt: text('created_at').notNull(),
}, table => [index('ifsg_cluster_acks_facility').on(table.facilityId, table.disease)])

/**
 * A parent meeting (Elterngespräch) in a child's record, held or planned: the day, the time from (minutes of the day)
 * and optionally until, the kind and who took part. `note` is confidential: only Leitung and Träger read and write it.
 * Who entered it is kept as account, employee and name (the name stays when the person is gone); who changed it last
 * by name.
 */
export const childParentMeetings = sqliteTable('child_parent_meetings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  start: integer('start').notNull(),
  end: integer('end'),
  kind: text('kind', { enum: MEETING_KINDS }).notNull(),
  participants: text('participants').notNull().default(''),
  note: text('note').notNull().default(''),
  createdAt: text('created_at').notNull(),
  createdByUserId: integer('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdByEmployeeId: integer('created_by_employee_id').references(() => employees.id, { onDelete: 'set null' }),
  createdByName: text('created_by_name').notNull().default(''),
  updatedAt: text('updated_at'),
  updatedByName: text('updated_by_name'),
}, table => [index('child_parent_meetings_child').on(table.childId)])

/**
 * A note (Notiz) in a child's record: the day, the text (1–2000 characters) and the educator it is about or by
 * (Erzieher). `educatorName` is the educator's name when the note was saved, shown once the employee is deleted. Who
 * entered it is kept as account, employee and name (the author may change and delete it); who changed it last by name.
 * Goes with the child (archived and deleted with the record).
 */
export const childNotes = sqliteTable('child_notes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  text: text('text').notNull(),
  educatorEmployeeId: integer('educator_employee_id').references(() => employees.id, { onDelete: 'set null' }),
  educatorName: text('educator_name').notNull().default(''),
  createdAt: text('created_at').notNull(),
  createdByUserId: integer('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdByEmployeeId: integer('created_by_employee_id').references(() => employees.id, { onDelete: 'set null' }),
  createdByName: text('created_by_name').notNull().default(''),
  updatedAt: text('updated_at'),
  updatedByName: text('updated_by_name'),
}, table => [index('child_notes_child').on(table.childId)])

/**
 * A child on a date (Anwesenheitstag), created by the first entry of that day. `groupId` is the child's group on the
 * day, stored when the row was created. The meals ticked by hand are in `childAttendanceMeals`.
 */
export const childAttendanceDays = sqliteTable('child_attendance_days', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  groupId: integer('group_id').references(() => groups.id, { onDelete: 'set null' }),
  plannedPickup: integer('planned_pickup'),
  broughtBy: text('brought_by').notNull().default(''),
  absence: text('absence', { enum: ['sick', 'vacation', 'excused'] }),
  /** "Was ist heute passiert": free text of the staff about the day. */
  note: text('note').notNull().default(''),
}, table => [uniqueIndex('child_attendance_days_child_date').on(table.childId, table.date)])

/** A meal (Essen) of a facility; its name and time come from its dated versions. */
export const meals = sqliteTable('meals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
}, table => [index('meals_facility').on(table.facilityId)])

/**
 * A meal's name and time from `validFrom` on (null = since always) until its next version; `removed` = no meal from
 * then on. One version per meal and day; SQLite lets several nulls through, so the service keeps one null version per meal.
 */
export const mealVersions = sqliteTable('meal_versions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  mealId: integer('meal_id').notNull().references(() => meals.id, { onDelete: 'cascade' }),
  validFrom: text('valid_from'),
  name: text('name').notNull(),
  /** Minutes after midnight at which the meal is counted. */
  time: integer('time').notNull(),
  removed: integer('removed', { mode: 'boolean' }).notNull().default(false),
}, table => [uniqueIndex('meal_versions_meal_valid_from').on(table.mealId, table.validFrom)])

/** A meal ticked by hand for a child on a day (no row = counted automatically). */
export const childAttendanceMeals = sqliteTable('child_attendance_meals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  dayId: integer('day_id').notNull().references(() => childAttendanceDays.id, { onDelete: 'cascade' }),
  mealId: integer('meal_id').notNull().references(() => meals.id, { onDelete: 'cascade' }),
  value: integer('value', { mode: 'boolean' }).notNull(),
}, table => [uniqueIndex('child_attendance_meals_day_meal').on(table.dayId, table.mealId), index('child_attendance_meals_meal').on(table.mealId)])

/**
 * One stay of a child on a day; `left` null while the child is still here. The pickup person's name as it was;
 * `pickedUpOther` = a person typed by hand who is neither a contact nor announced ("nicht hinterlegt"), with whom that
 * was agreed in `pickedUpConfirmedWith` ("Rücksprache mit", '' = not given).
 */
export const childAttendanceStays = sqliteTable('child_attendance_stays', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  dayId: integer('day_id').notNull().references(() => childAttendanceDays.id, { onDelete: 'cascade' }),
  arrived: integer('arrived').notNull(),
  left: integer('left'),
  pickedUpBy: text('picked_up_by'),
  pickedUpContactId: integer('picked_up_contact_id').references(() => childContacts.id, { onDelete: 'set null' }),
  pickedUpOther: integer('picked_up_other', { mode: 'boolean' }).notNull().default(false),
  pickedUpConfirmedWith: text('picked_up_confirmed_with').notNull().default(''),
}, table => [index('child_attendance_stays_day').on(table.dayId)])

/** A person announced to pick the child up on this day only. */
export const childPickupAnnouncements = sqliteTable('child_pickup_announcements', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  dayId: integer('day_id').notNull().references(() => childAttendanceDays.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  announcedBy: text('announced_by').notNull().default(''),
}, table => [index('child_pickup_announcements_day').on(table.dayId)])

/** The remark (Bemerkung) of a child's row in the month overview; `month` is YYYY-MM. */
export const childAttendanceMonths = sqliteTable('child_attendance_months', {
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  month: text('month').notNull(),
  remark: text('remark').notNull().default(''),
}, table => [uniqueIndex('child_attendance_months_child_month').on(table.childId, table.month)])

/**
 * The change log of the attendance: one row per changed field, with who changed it. A person at the tablet without
 * account has no user id but the employee id and name of the person who unlocked it.
 */
export const childAttendanceChanges = sqliteTable('child_attendance_changes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  field: text('field').notNull(),
  before: text('before').notNull(),
  after: text('after').notNull(),
  changedAt: text('changed_at').notNull(),
  changedByUserId: integer('changed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  changedByEmployeeId: integer('changed_by_employee_id').references(() => employees.id, { onDelete: 'set null' }),
  changedByName: text('changed_by_name').notNull(),
}, table => [index('child_attendance_changes_child_date').on(table.childId, table.date)])

/**
 * Groups merged at the edge times („Gruppen zusammenlegen“, Anwesenheit) for one day of the facility; `groupIds` is a
 * JSON array of two or more of its group ids. Ended by „Zusammenlegung beenden“ (`endedAt`) or by the end of the day
 * (a row of an earlier date is ignored). A group is in one active merge at a time (checked by the service). The log
 * keeps who merged and who ended by name only, as the other logs do after a person is deleted.
 */
export const groupMerges = sqliteTable('group_merges', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  groupIds: text('group_ids').notNull(),
  createdAt: text('created_at').notNull(),
  createdByName: text('created_by_name').notNull(),
  endedAt: text('ended_at'),
  endedByName: text('ended_by_name'),
}, table => [index('group_merges_facility_date').on(table.facilityId, table.date)])

/**
 * The child records are unlocked at a facility's tablet by one person (name + PIN): at most one row per tablet account.
 * Locking deletes the row; the tablet's session holds its id. Valid until `lastActiveAt` plus the facility's lock time,
 * kept open through the facility's windows without the automatic lock (tabletUnlockedWindows).
 */
export const terminalUnlocks = sqliteTable('terminal_unlocks', {
  id: text('id').primaryKey(),
  terminalUserId: integer('terminal_user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
  lastActiveAt: text('last_active_at').notNull(),
})

/**
 * A time window „Keine automatische Sperre“ of a facility's tablet (e.g. the main drop-off and pick-up times; at most 6,
 * not overlapping, minutes after midnight Berlin time, `end` after `start`, 24:00 at most): on every day the facility is
 * open, an unlock does not run out by inactivity inside it (shared/domain/tablet.ts unlockDeadline).
 */
export const tabletUnlockedWindows = sqliteTable('tablet_unlocked_windows', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  start: integer('start').notNull(),
  end: integer('end').notNull(),
}, table => [index('tablet_unlocked_windows_facility').on(table.facilityId)])

/**
 * The Leitung lets the staff of `groupId` also read the group book of `readableGroupId` (records and weekly overview,
 * no entries). One direction only: A reading B does not let B read A.
 */
export const groupReadAccess = sqliteTable('group_read_access', {
  groupId: integer('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  readableGroupId: integer('readable_group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
}, table => [primaryKey({ columns: [table.groupId, table.readableGroupId] })])

/**
 * The age limits of a group: „von `fromYears` bis unter `toYears` Jahren: höchstens `maxChildren` Kinder“ (whole years
 * 0 to 18, from < to, max >= 0). Several per group, they may overlap. A child's age in a month is its age on the 1st.
 */
export const groupAgeLimits = sqliteTable('group_age_limits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  groupId: integer('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  fromYears: integer('from_years').notNull(),
  toYears: integer('to_years').notNull(),
  maxChildren: integer('max_children').notNull(),
}, table => [index('group_age_limits_group').on(table.groupId)])

/** The weekly overview's theme of a group for a week; `weekStart` is the week's Monday (ISO date). */
export const groupWeekNotes = sqliteTable('group_week_notes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  groupId: integer('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  weekStart: text('week_start').notNull(),
  text: text('text').notNull().default(''),
  updatedAt: text('updated_at').notNull(),
  updatedByName: text('updated_by_name').notNull(),
}, table => [uniqueIndex('group_week_notes_group_week').on(table.groupId, table.weekStart)])

/** The weekly overview's "Was haben wir gemacht" of a group on a day (Monday to Friday). */
export const groupDayNotes = sqliteTable('group_day_notes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  groupId: integer('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  text: text('text').notNull().default(''),
  updatedAt: text('updated_at').notNull(),
  updatedByName: text('updated_by_name').notNull(),
}, table => [uniqueIndex('group_day_notes_group_date').on(table.groupId, table.date)])

/**
 * The change log of the group book: one row per change of the week's theme (`field` 'week', `date` the week's Monday)
 * or of a day's text ('day', the day), with who changed it. A person at the tablet without account has no user id but
 * the employee id and name of the person who unlocked it.
 */
export const groupBookChanges = sqliteTable('group_book_changes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  groupId: integer('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  field: text('field', { enum: ['week', 'day'] }).notNull(),
  date: text('date').notNull(),
  before: text('before').notNull(),
  after: text('after').notNull(),
  changedAt: text('changed_at').notNull(),
  changedByUserId: integer('changed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  changedByEmployeeId: integer('changed_by_employee_id').references(() => employees.id, { onDelete: 'set null' }),
  changedByName: text('changed_by_name').notNull(),
}, table => [index('group_book_changes_group_date').on(table.groupId, table.date)])

/**
 * A category of print templates of one facility (one list for all facilities before 0108_facility_template_categories),
 * in `sortOrder` among its siblings. One level of subcategories (0115_subcategories): a subcategory names its category in
 * `parentId` (a category of the same facility without a parent of its own); a category is deleted only without
 * subcategories. The name is unique per facility and parent regardless of case; `visibility` says who sees the category
 * and its templates (shared/domain/templateCategories.ts), for a subcategory on top of its category's (the stricter wins).
 */
export const templateCategories = sqliteTable('template_categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  parentId: integer('parent_id').references((): AnySQLiteColumn => templateCategories.id),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  visibility: text('visibility', { enum: TEMPLATE_VISIBILITIES }).notNull().default('all'),
}, table => [
  uniqueIndex('template_categories_facility_parent_name').on(table.facilityId, sql`(case when ${table.parentId} is null then 0 else ${table.parentId} end)`, sql`lower(${table.name})`),
  index('template_categories_parent').on(table.parentId),
])

/**
 * A blank PDF form (Vorlage) to open and print: of one facility, or for all facilities (`facilityId` null, only the
 * Träger maintains those). A facility's template is filed in one of the facility's categories (`categoryId`; a category
 * is deleted only while empty). A template for all facilities has no category row (`categoryId` null) but a
 * `categoryName`: each facility shows it in its own category of that name (regardless of case), otherwise under „Vom
 * Träger“; its `visibility` applies on top of that category's (the stricter one wins; facility templates leave it
 * 'all'). `uploadedAt` is the first upload, `updatedAt` the last change of title, category or file. `category` is the
 * free text from before 0063_template_categories, kept but no longer used (new rows leave it empty).
 */
export const printTemplates = sqliteTable('print_templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: integer('facility_id').references(() => facilities.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  category: text('category').notNull().default(''),
  categoryId: integer('category_id').references(() => templateCategories.id),
  categoryName: text('category_name'),
  /** A template for all facilities: the subcategory name within `categoryName` (null = directly in the category). */
  subcategoryName: text('subcategory_name'),
  visibility: text('visibility', { enum: TEMPLATE_VISIBILITIES }).notNull().default('all'),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  data: blob('data', { mode: 'buffer' }).notNull(),
  uploadedBy: integer('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
  uploadedAt: text('uploaded_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  /** A PDF form with fields to fill in the app (server/lib/pdfForm.ts, judged when the file is stored); null = not judged yet. */
  fillable: integer('fillable', { mode: 'boolean' }),
  /**
   * „Gilt für“ alle Einrichtungen (also later ones): a template of the Träger (`facilityId` null) shown everywhere;
   * otherwise only in the facilities of print_template_targets (a facility's own template: just that one).
   */
  allFacilities: integer('all_facilities', { mode: 'boolean' }).notNull().default(false),
}, table => [index('print_templates_facility').on(table.facilityId), index('print_templates_category').on(table.categoryId)])

/**
 * „Gilt für“ of a template, per facility (shared/domain/documentTargets.ts): the facilities it shows in (unless it is for
 * all facilities; a facility's own template has exactly its facility here) and whether there it is for all groups or only
 * for the groups chosen in print_template_target_groups (for a template for all facilities a row only limits the groups
 * of that facility). Gone with the template or the facility.
 */
export const printTemplateTargets = sqliteTable('print_template_targets', {
  templateId: integer('template_id').notNull().references(() => printTemplates.id, { onDelete: 'cascade' }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  allGroups: integer('all_groups', { mode: 'boolean' }).notNull().default(true),
}, table => [primaryKey({ columns: [table.templateId, table.facilityId] }), index('print_template_targets_facility').on(table.facilityId)])

/** The groups a template is limited to (in facilities whose target row says not all groups); gone with the group. */
export const printTemplateTargetGroups = sqliteTable('print_template_target_groups', {
  templateId: integer('template_id').notNull().references(() => printTemplates.id, { onDelete: 'cascade' }),
  groupId: integer('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
}, table => [primaryKey({ columns: [table.templateId, table.groupId] }), index('print_template_target_groups_group').on(table.groupId)])

/**
 * The order of the templates within a facility's sub-tab of „Dokumente“ → „Vorlagen“ (▲/▼), one row per facility and
 * template: a template for all facilities shows in every facility and each orders it on its own. Within a sub-tab the
 * templates with a row come first by `sortOrder`, those without one after them by title (so a template of before stays
 * where it was). Gone with the facility or the template.
 */
export const printTemplateOrder = sqliteTable('print_template_order', {
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  templateId: integer('template_id').notNull().references(() => printTemplates.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull(),
}, table => [primaryKey({ columns: [table.facilityId, table.templateId] }), index('print_template_order_template').on(table.templateId)])

/**
 * The Träger's overrides of the state's staffing preset, one row per facility (no row = the preset as it is).
 * `overrides` is JSON `{ [path]: { value, preset } }` (see shared/domain/staffing/overrides.ts).
 */
export const staffingOverrides = sqliteTable('staffing_overrides', {
  facilityId: integer('facility_id').primaryKey().references(() => facilities.id, { onDelete: 'cascade' }),
  overrides: text('overrides').notNull(),
  updatedAt: text('updated_at').notNull(),
  updatedBy: integer('updated_by').references(() => users.id, { onDelete: 'set null' }),
})

/**
 * A plan warning the Leitung or the Träger marked „Zur Kenntnis genommen“, per facility: `key` is type, day and subject
 * of the warning (see shared/domain/warningList.ts), `signature` its values when marked; a warning whose values changed
 * shows again. `date` is the warning's day (to load a month). Old rows are harmless and stay.
 */
export const warningAcks = sqliteTable('warning_acks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  date: text('date').notNull(),
  signature: text('signature').notNull(),
  acknowledgedAt: text('acknowledged_at').notNull(),
  acknowledgedBy: integer('acknowledged_by').references(() => users.id, { onDelete: 'set null' }),
  acknowledgedByName: text('acknowledged_by_name').notNull().default(''),
}, table => [
  uniqueIndex('warning_acks_facility_key').on(table.facilityId, table.key),
  index('warning_acks_facility_date').on(table.facilityId, table.date),
])

/**
 * „Brauchen wir nicht“: an item of „Was noch fehlt“ (see shared/domain/setupChecklist.ts) hidden for the facility, for
 * every Leitung and the Träger alike, until someone shows it again.
 */
export const setupHidden = sqliteTable('setup_hidden', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  hiddenAt: text('hidden_at').notNull(),
  hiddenBy: integer('hidden_by').references(() => users.id, { onDelete: 'set null' }),
}, table => [uniqueIndex('setup_hidden_facility_key').on(table.facilityId, table.key)])

/**
 * A cash book (Kasse) of a facility: for the whole facility (`groupId` null) or one of its groups. `kind` „Bar“ (cash)
 * or „EC/Konto“ (account). Amounts are integer cents; `startBalance` is the balance at the start of the start month.
 * An archived box (archiviert) stays readable, but takes no new, changed or deleted entries.
 */
export const cashBoxes = sqliteTable('cash_boxes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  // Deleting a group with boxes is refused by the service (409 group_has_cash_boxes).
  groupId: integer('group_id').references(() => groups.id),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['cash', 'account'] }).notNull(),
  startYear: integer('start_year').notNull(),
  startMonth: integer('start_month').notNull(),
  startBalance: integer('start_balance').notNull().default(0),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  /** Order within the box's scope (facility or group). */
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
}, table => [index('cash_boxes_facility').on(table.facilityId)])

/** A receipt (Beleg) file of cash entries: JPG, PNG or PDF, kept in the database so backups include it. */
export const cashReceipts = sqliteTable('cash_receipts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  mime: text('mime').notNull(),
  data: blob('data', { mode: 'buffer' }).notNull(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
}, table => [index('cash_receipts_facility').on(table.facilityId)])

/**
 * An income (`in`) or expense (`out`) of a box, in cents (> 0). Numbers are not stored (given per month when shown).
 * A transfer (Umbuchung) is an expense in one box and an income in another; both rows carry the expense row's id as
 * `transferId`.
 */
export const cashEntries = sqliteTable('cash_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  boxId: integer('box_id').notNull().references(() => cashBoxes.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  direction: text('direction', { enum: ['in', 'out'] }).notNull(),
  cents: integer('cents').notNull(),
  purpose: text('purpose').notNull(),
  receiptId: integer('receipt_id').references(() => cashReceipts.id, { onDelete: 'set null' }),
  transferId: integer('transfer_id'),
  /** A transfer row: the user's own text, `purpose` being „Umbuchung an/von ‹Kasse›: ‹text›“ (null for plain entries). */
  transferText: text('transfer_text'),
  createdAt: text('created_at').notNull(),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
}, table => [
  index('cash_entries_box_date').on(table.boxId, table.date),
  index('cash_entries_transfer').on(table.transferId),
])

/** A closed month of a box (no entry dated in it may change); `closedBy` is the user name at the time. */
export const cashClosedMonths = sqliteTable('cash_closed_months', {
  boxId: integer('box_id').notNull().references(() => cashBoxes.id, { onDelete: 'cascade' }),
  year: integer('year').notNull(),
  month: integer('month').notNull(),
  closedAt: text('closed_at').notNull(),
  closedBy: text('closed_by').notNull(),
}, table => [primaryKey({ columns: [table.boxId, table.year, table.month] })])

/**
 * The audit log of a box (nobody changes or deletes it): `actor` is the user name at the time, `action` a key
 * (box_created, entry_updated, transfer_deleted …), `detail` the German text shown (before → after for changes).
 * `month` ('YYYY-MM') is the month the line concerns: the entry's month (after a date change the new one), the closed
 * or reopened month; null for lines about the box itself.
 */
export const cashLog = sqliteTable('cash_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  boxId: integer('box_id').notNull().references(() => cashBoxes.id, { onDelete: 'cascade' }),
  at: text('at').notNull(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  detail: text('detail').notNull(),
  month: text('month'),
}, table => [index('cash_log_box_month').on(table.boxId, table.month)])

/**
 * A form template („Bogen“-Vorlage) of a facility for one kind (staff talk, child, team meeting, accident report).
 * `content` is JSON FormContent (sections and items with stable ids, see shared/domain/forms.ts). `starterKey` marks a
 * starter template created by the app (null for the facility's own templates and for copies). `selfAssessment`: filled
 * in by the employee. `subject`: whom an accident template's forms are about (null for the other kinds). `updatedBy` is
 * the name at the time ('' for the starters).
 */
export const formTemplates = sqliteTable('form_templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['staff', 'child', 'team', 'accident'] }).notNull(),
  subject: text('subject', { enum: ['child', 'employee'] }),
  name: text('name').notNull(),
  starterKey: text('starter_key'),
  /** 'u1000': forms made from it print in the layout of the official Unfallanzeige (set on the starter, kept by copies). */
  printLayout: text('print_layout', { enum: ['u1000'] }),
  selfAssessment: integer('self_assessment', { mode: 'boolean' }).notNull().default(false),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  updatedBy: text('updated_by').notNull().default(''),
}, table => [index('form_templates_facility_kind').on(table.facilityId, table.kind)])

/**
 * A filled form („Bogen“): `content` is the template's content copied when the form was made (later template changes
 * never reach it), `answers` JSON keyed by item id. Self-assessments go draft → released → submitted; `readReleased`
 * shows an assessment to the employee. `updatedBy` is the name at the time.
 */
export const forms = sqliteTable('forms', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  // Deleting a template with forms is refused by the service (409 form_template_in_use).
  templateId: integer('template_id').references(() => formTemplates.id, { onDelete: 'set null' }),
  kind: text('kind', { enum: ['staff', 'child', 'team', 'accident'] }).notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  answers: text('answers').notNull().default('{}'),
  state: text('state', { enum: ['draft', 'released', 'submitted'] }).notNull().default('draft'),
  readReleased: integer('read_released', { mode: 'boolean' }).notNull().default(false),
  /** When the self form was last released to the employee / submitted / the assessment released to read (null = not now). */
  releasedAt: text('released_at'),
  submittedAt: text('submitted_at'),
  readReleasedAt: text('read_released_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  updatedBy: text('updated_by').notNull().default(''),
  /** Child forms (kind `child`) and accident reports about a child: the child; the form goes with the child's record. */
  childId: integer('child_id').references(() => children.id, { onDelete: 'cascade' }),
  /** Child forms: the parent meeting the form was filled for (a meeting has at most one); deleting it keeps the form. */
  parentMeetingId: integer('parent_meeting_id').references(() => childParentMeetings.id, { onDelete: 'set null' }),
  /** Child forms: the header fields Datum, Uhrzeit (minutes after midnight, null = none) and Teilnehmer. */
  formDate: text('form_date'),
  formStart: integer('form_start'),
  formParticipants: text('form_participants').notNull().default(''),
  /** Accident reports about an employee: the employee (an accident report has exactly one of childId and employeeId). */
  employeeId: integer('employee_id').references(() => employees.id, { onDelete: 'cascade' }),
  /**
   * Accident reports: the fixed header besides Datum and Uhrzeit (formDate, formStart): „Arztbesuch“, „arbeitsunfähig“
   * (employees only) and „an Unfallkasse gemeldet am“ (ISO date, null = not yet).
   */
  accidentDoctor: integer('accident_doctor', { mode: 'boolean' }),
  accidentUnfit: integer('accident_unfit', { mode: 'boolean' }),
  accidentReportedOn: text('accident_reported_on'),
  /** Accident reports: who filled it in, as account and/or employee (the tablet's person), so the author may change it. */
  createdByUserId: integer('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdByEmployeeId: integer('created_by_employee_id').references(() => employees.id, { onDelete: 'set null' }),
  /** 'u1000': made from the official Unfallanzeige starter and printed in its layout; null: printed like every Bogen. */
  printLayout: text('print_layout', { enum: ['u1000'] }),
  /**
   * Staff talk forms made by „Für ein weiteres Gespräch verwenden“: the form they were copied from (null once it is
   * deleted) and that talk's date (kept, for „übernommen aus dem Gespräch vom …“); both null for every other form.
   */
  sourceFormId: integer('source_form_id').references((): AnySQLiteColumn => forms.id, { onDelete: 'set null' }),
  sourceTalkDate: text('source_talk_date'),
}, table => [
  index('forms_facility').on(table.facilityId),
  index('forms_source').on(table.sourceFormId),
  index('forms_template').on(table.templateId),
  index('forms_child').on(table.childId),
  index('forms_employee').on(table.employeeId),
  uniqueIndex('forms_parent_meeting').on(table.parentMeetingId).where(sql`parent_meeting_id IS NOT NULL`),
])

/**
 * A file (PDF, JPEG or PNG) attached to an accident report, e.g. a photo of the injury or a doctor's note; stored like
 * the child documents (in the database, the type judged by the first bytes, the same size limit). Goes with the form.
 */
export const formAttachments = sqliteTable('form_attachments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  formId: integer('form_id').notNull().references(() => forms.id, { onDelete: 'cascade' }),
  /** The name shown in the list and the printout (the uploaded file's name, cleaned). */
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  data: blob('data', { mode: 'buffer' }).notNull(),
  uploadedAt: text('uploaded_at').notNull(),
  uploadedByName: text('uploaded_by_name').notNull().default(''),
  /** Who uploaded it (account and/or the tablet's person): besides Leitung/Träger only they may remove it. */
  uploadedByUserId: integer('uploaded_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  uploadedByEmployeeId: integer('uploaded_by_employee_id').references(() => employees.id, { onDelete: 'set null' }),
}, table => [index('form_attachments_form').on(table.formId)])

/** Employees a manager unlocked to edit one child form at the tablet (besides the child's key educator). */
export const formEditors = sqliteTable('form_editors', {
  formId: integer('form_id').notNull().references(() => forms.id, { onDelete: 'cascade' }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  grantedAt: text('granted_at').notNull(),
  /** Name of the manager at the time. */
  grantedBy: text('granted_by').notNull().default(''),
}, table => [primaryKey({ columns: [table.formId, table.employeeId] })])

/**
 * „Verlauf“ of a child form (kind `child`, server/services/childFormHistory.ts): one row per save that changed answers,
 * with the answers after that save and the items it changed (shared/domain/formHistory.ts). Goes with the form (and so
 * with the child). The person by name, as stored at the time (like forms.updatedBy). `initial`: the state before the
 * history began (written by migration 0122 for forms with answers); it names no changed items.
 */
export const formRevisions = sqliteTable('form_revisions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  formId: integer('form_id').notNull().references(() => forms.id, { onDelete: 'cascade' }),
  savedAt: text('saved_at').notNull(),
  savedBy: text('saved_by').notNull().default(''),
  /** JSON object: the form's answers after the save. */
  answers: text('answers').notNull(),
  /** JSON array of item ids whose answer the save changed. */
  changedItemIds: text('changed_item_ids').notNull().default('[]'),
  initial: integer('initial', { mode: 'boolean' }).notNull().default(false),
}, table => [index('form_revisions_form').on(table.formId, table.id)])

/**
 * When a person last opened a child form, for the marker „geändert seit du den Bogen zuletzt geöffnet hast“: an account
 * in the office, the unlocking employee at the tablet (exactly one of the two). Goes with the form, the account or the
 * employee (and with the employee's immediate data, server/services/employeeDeletion.ts).
 */
export const formReads = sqliteTable('form_reads', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  formId: integer('form_id').notNull().references(() => forms.id, { onDelete: 'cascade' }),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  employeeId: integer('employee_id').references(() => employees.id, { onDelete: 'cascade' }),
  openedAt: text('opened_at').notNull(),
}, table => [
  uniqueIndex('form_reads_user').on(table.userId, table.formId).where(sql`user_id IS NOT NULL`),
  uniqueIndex('form_reads_employee').on(table.employeeId, table.formId).where(sql`employee_id IS NOT NULL`),
  index('form_reads_form').on(table.formId),
])

/**
 * The starter templates (shared/domain/forms/starters.ts) a facility has been given, one row per starter key: a starter
 * is created once, a deleted or renamed one is not created again, and a new starter reaches existing facilities.
 */
export const formStarterSeeds = sqliteTable('form_starter_seeds', {
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  starterKey: text('starter_key').notNull(),
  seededAt: text('seeded_at').notNull(),
}, table => [primaryKey({ columns: [table.facilityId, table.starterKey] })])

/** A staff talk (Mitarbeitergespräch) with its fixed header fields; `start` in minutes after midnight (null = no time). */
export const staffTalks = sqliteTable('staff_talks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  start: integer('start'),
  participants: text('participants').notNull().default(''),
  period: text('period').notNull().default(''),
  createdAt: text('created_at').notNull(),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
}, table => [index('staff_talks_facility_employee').on(table.facilityId, table.employeeId)])

/**
 * A BEM process (Betriebliches Eingliederungsmanagement, § 167 Abs. 2 SGB IX) of an employee: health data, only for
 * employees.sickness and never for the employee themselves (server/services/bem.ts). It belongs to the employee's home
 * facility (no facility column: it moves with the person). `invitedOn` is „Verschickt am“, `answeredOn` the day of the
 * answer (or of „keine Antwort“), `completedOn` the day it ended (completed, declined, no answer, consent withdrawn).
 * `createdBy` is the name of whoever started it.
 */
export const bemProcesses = sqliteTable('bem_processes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  status: text('status', { enum: ['invited', 'accepted', 'declined', 'no_answer', 'completed'] }).notNull().default('invited'),
  invitedOn: text('invited_on'),
  answeredOn: text('answered_on'),
  completedOn: text('completed_on'),
  createdBy: text('created_by').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [index('bem_processes_employee').on(table.employeeId)])

/** The steps of a BEM process: talks (with participants), measures (with their status) and notes. */
export const bemSteps = sqliteTable('bem_steps', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  processId: integer('process_id').notNull().references(() => bemProcesses.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['meeting', 'measure', 'note'] }).notNull(),
  date: text('date').notNull(),
  participants: text('participants').notNull().default(''),
  text: text('text').notNull().default(''),
  /** Only for a measure. */
  status: text('status', { enum: ['planned', 'done', 'dropped'] }),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [index('bem_steps_process').on(table.processId)])

/**
 * A Mutterschutz case (MuSchG) of an employee: health data, only for employees.sickness and never for the employee
 * themselves (server/services/maternity.ts); it belongs to the employee's home facility and goes with the immediate data
 * when the employee is deleted. `notifiedOn` is the Bekanntgabe, `extendedAfter` 12 weeks after the birth (premature or
 * multiple birth, disabled child), `breastfeedingUntil` the optional end of the Stillzeit. `authorityNotifiedOn` (§ 27)
 * and `riskAssessmentOn` (§ 10) end their reminders, `banCheckedOn` the reminder „Beschäftigungsverbot prüfen“.
 * `protectionBooked`/`banBooked`: „Schutzfristen/Beschäftigungsverbot eintragen“ was used, so a change of the dates books
 * the plan again. `endedOn`: the case ended (nothing applies after it). `createdBy` is the name of whoever entered it.
 */
export const maternityCases = sqliteTable('maternity_cases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  notifiedOn: text('notified_on').notNull(),
  expectedBirth: text('expected_birth').notNull(),
  actualBirth: text('actual_birth'),
  extendedAfter: integer('extended_after', { mode: 'boolean' }).notNull().default(false),
  breastfeedingUntil: text('breastfeeding_until'),
  authorityNotifiedOn: text('authority_notified_on'),
  riskAssessmentOn: text('risk_assessment_on'),
  employmentBan: text('employment_ban', { enum: ['none', 'partial', 'full'] }).notNull().default('none'),
  banFrom: text('ban_from'),
  banTo: text('ban_to'),
  banNote: text('ban_note').notNull().default(''),
  banCheckedOn: text('ban_checked_on'),
  protectionBooked: integer('protection_booked', { mode: 'boolean' }).notNull().default(false),
  banBooked: integer('ban_booked', { mode: 'boolean' }).notNull().default(false),
  /**
   * The case's period fields as last written to the plan (JSON `{ protection?, ban? }`, see server/services/maternity.ts):
   * booking again compares with it, also after a change saved by someone without plan.edit.
   */
  planSync: text('plan_sync'),
  endedOn: text('ended_on'),
  /** A miscarriage (§ 3 Abs. 5 MuSchG): its day, the week of pregnancy, and whether the employee declined the protection. */
  miscarriageOn: text('miscarriage_on'),
  miscarriageWeek: integer('miscarriage_week'),
  miscarriageWaived: integer('miscarriage_waived', { mode: 'boolean' }).notNull().default(false),
  createdBy: text('created_by').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [index('maternity_cases_employee').on(table.employeeId)])

/**
 * An Elternzeit (BEEG) of an employee, contract data (server/services/parentalLeave.ts): entered with
 * employees.contractEdit, seen with employees.contractView. `start` and `end` are inclusive. `childId` links a child of
 * the personnel file when one was chosen (cleared when the child is removed); `childBirthDate` is always stored (copied
 * or entered) for the 8th birthday and the sections per child. `partTimeWeeklyMinutes` (at most 32 hours): part-time
 * work at the facility during it, the target follows these hours; null = full Elternzeit (no target). `reduceLeave`: the
 * employer cuts the leave by 1/12 per full calendar month (§ 17 Abs. 1 BEEG, off by default). Deleted with the time data
 * (it decides the target hours and the leave account, server/services/employeeDeletion.ts).
 */
export const parentalLeaves = sqliteTable('parental_leaves', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  childId: integer('child_id').references(() => employeeChildren.id, { onDelete: 'set null' }),
  childBirthDate: text('child_birth_date').notNull(),
  start: text('start').notNull(),
  end: text('end').notNull(),
  partTimeWeeklyMinutes: integer('part_time_weekly_minutes'),
  /** The working days of the part-time work (bitmask as employee_hours.workdays); null without part time. */
  partTimeWorkdays: integer('part_time_workdays'),
  reduceLeave: integer('reduce_leave', { mode: 'boolean' }).notNull().default(false),
  note: text('note').notNull().default(''),
  createdBy: text('created_by').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [index('parental_leaves_employee').on(table.employeeId)])

/**
 * „Mutterschutz nach der Geburt bis“ entered by hand for a birth whose Mutterschutz case is not in the app (one per
 * employee and birth date: twins share one birth). Health data like the case (the length tells 8 or 12 weeks): entered
 * and seen only with employees.sickness. It counts towards the 36 months of Elternzeit (§ 15 Abs. 2 BEEG) from the birth
 * to `protectionUntil`; a case for the same birth wins over it. Goes with the Elternzeit (time data).
 */
export const parentalLeaveBirths = sqliteTable('parental_leave_births', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  childBirthDate: text('child_birth_date').notNull(),
  protectionUntil: text('protection_until').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [uniqueIndex('parental_leave_births_employee_birth').on(table.employeeId, table.childBirthDate)])

/** The forms of a staff talk: the employee's self-assessment (`self`) or an assessment, in the order of `sort`. */
export const staffTalkForms = sqliteTable('staff_talk_forms', {
  talkId: integer('talk_id').notNull().references(() => staffTalks.id, { onDelete: 'cascade' }),
  formId: integer('form_id').notNull().references(() => forms.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['self', 'assessment'] }).notNull(),
  sort: integer('sort').notNull().default(0),
}, table => [
  primaryKey({ columns: [table.talkId, table.formId] }),
  uniqueIndex('staff_talk_forms_form').on(table.formId),
])

/**
 * A team meeting (Teamsitzung) of the facility with its minutes in one form (kind `team`): optionally of one group (null
 * = the whole facility; a deleted group leaves it to the facility). `start` in minutes after midnight (null = no time).
 * Draft → released by Leitung/Träger; `reopen*` keeps the last reopening. Names are the names at the time.
 */
export const teamMeetings = sqliteTable('team_meetings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  groupId: integer('group_id').references(() => groups.id, { onDelete: 'set null' }),
  formId: integer('form_id').notNull().references(() => forms.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  start: integer('start'),
  participants: text('participants').notNull().default(''),
  /** Protokollführung. */
  recorder: text('recorder').notNull().default(''),
  state: text('state', { enum: ['draft', 'released'] }).notNull().default('draft'),
  releasedAt: text('released_at'),
  releasedBy: text('released_by'),
  reopenReason: text('reopen_reason'),
  reopenedAt: text('reopened_at'),
  reopenedBy: text('reopened_by'),
  createdAt: text('created_at').notNull(),
  createdBy: text('created_by').notNull().default(''),
}, table => [
  index('team_meetings_facility_date').on(table.facilityId, table.date),
  uniqueIndex('team_meetings_form').on(table.formId),
])

/**
 * The employees chosen as participants of a team meeting, in `sortOrder`, with their name at the time of choosing (it
 * stays when the employee is deleted for good: `employeeId` becomes null). `signedAt`/`signedVia`: the confirmation that
 * they read the released minutes, with their own account or at the tablet (null = not yet).
 */
export const teamMeetingParticipants = sqliteTable('team_meeting_participants', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  meetingId: integer('meeting_id').notNull().references(() => teamMeetings.id, { onDelete: 'cascade' }),
  employeeId: integer('employee_id').references(() => employees.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull(),
  signedAt: text('signed_at'),
  signedVia: text('signed_via', { enum: ['account', 'tablet'] }),
}, table => [uniqueIndex('team_meeting_participants_meeting_employee').on(table.meetingId, table.employeeId)])

/**
 * A note of the facility (Notizen), optionally until `validUntil` (afterwards under „Abgelaufen“), for the whole
 * facility (`groupId` null) or one of its groups (null again once the group is deleted). `createdBy`/`updatedBy`: the
 * names at the time (`updatedAt`/`updatedBy` null until the first change). Deleted only by hand. (The former day notes
 * became general notes with their date in front of the text, migration 0067.) `visibility` („Sichtbar für“) says who
 * reads it, with the levels and viewer rule of the print-template categories (shared/domain/templateCategories.ts;
 * the notes before migration 0068 are visible to all).
 */
export const facilityNotes = sqliteTable('facility_notes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  groupId: integer('group_id').references(() => groups.id, { onDelete: 'set null' }),
  validUntil: text('valid_until'),
  text: text('text').notNull(),
  createdAt: text('created_at').notNull(),
  createdBy: text('created_by').notNull(),
  updatedAt: text('updated_at'),
  updatedBy: text('updated_by'),
  visibility: text('visibility', { enum: TEMPLATE_VISIBILITIES }).notNull().default('all'),
}, table => [index('facility_notes_facility').on(table.facilityId)])

/**
 * The Träger's retention periods after an employee left, per facility (shared/domain/retention.ts; no row = the defaults,
 * created on first read): years after the end of the leaving year for time data, assessments and paid-out overtime;
 * pension only for information; the cash box period; who may delete a left employee at once („Endgültig löschen“).
 */
export const retentionSettings = sqliteTable('retention_settings', {
  facilityId: integer('facility_id').primaryKey().references(() => facilities.id, { onDelete: 'cascade' }),
  timeYears: integer('time_years').notNull().default(2),
  assessmentYears: integer('assessment_years').notNull().default(3),
  paidOvertimeYears: integer('paid_overtime_years').notNull().default(8),
  pensionYears: integer('pension_years').notNull().default(30),
  cashYears: integer('cash_years').notNull().default(10),
  /** BEM records (§ 167 Abs. 2 SGB IX) may be deleted this many years after the process ended. */
  bemYears: integer('bem_years').notNull().default(3),
  /** Mutterschutz records (MuSchG) may be deleted this many years after the case ended (§ 27 Abs. 5: kept 2 years). */
  maternityYears: integer('maternity_years').notNull().default(2),
  employeeDelete: text('employee_delete', { enum: ['off', 'provider', 'managers'] }).notNull().default('managers'),
  /**
   * „Lohnunterlagen bewahrt ein Lohnbüro/Steuerbüro auf“ (default yes): „Lohn und Steuer“ of someone who left may be
   * deleted the day after leaving; no = kept 6 years after the end of the leaving year (§ 41 EStG, § 147 AO).
   */
  payrollOffice: integer('payroll_office', { mode: 'boolean' }).notNull().default(true),
})

/**
 * The phone numbers and e-mail addresses of a facility (Kontakt), each belonging to the facility itself, its Leitung or
 * its Träger, with an optional label (Büro, Handy …). A table rather than a JSON column: every entry is validated on its
 * own and later features can select by kind. `sortOrder` is the order the Träger arranged them in.
 */
export const facilityContacts = sqliteTable('facility_contacts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['phone', 'email'] }).notNull(),
  value: text('value').notNull(),
  belongsTo: text('belongs_to', { enum: ['facility', 'leitung', 'traeger'] }).notNull(),
  label: text('label').notNull().default(''),
  sortOrder: integer('sort_order').notNull().default(0),
}, table => [index('facility_contacts_facility').on(table.facilityId)])

/**
 * How 24 and 31 December count for the staff a facility is home to, per year (TVöD § 6 Abs. 3): the rule of a year is
 * the entry with the latest `fromYear` not after it. 'whole' / 'half': a whole or half leave day; 'paid': paid free, like
 * a public holiday for the staff (no leave, no target hours). Changing the TVöD switch or the choice writes the entry of
 * the effective year (the current year until 23 December, else the next), so past years never change. Every facility
 * has an entry from year 0.
 */
export const facilityEveRules = sqliteTable('facility_eve_rules', {
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  fromYear: integer('from_year').notNull(),
  mode: text('mode', { enum: ['whole', 'half', 'paid'] }).notNull(),
}, table => [primaryKey({ columns: [table.facilityId, table.fromYear] })])

/**
 * A category of the facility's address book („Kontakte“), one list per facility (each facility names, orders and adds
 * its own; it starts with DEFAULT_CONTACT_CATEGORIES). The name is unique per facility regardless of case; a category is
 * deleted only while no contact of the facility is filed in it.
 */
export const contactCategories = sqliteTable('contact_categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
}, table => [uniqueIndex('contact_categories_facility_name').on(table.facilityId, sql`lower(${table.name})`)])

/**
 * An external business contact of the facility (school, Jugendamt, Fachberatung …), or for all facilities (`facilityId`
 * null, only the Träger maintains those). A facility's contact is filed in one of the facility's categories
 * (`categoryId`); a contact for all facilities has no category row but a `categoryName`: each facility shows it in its
 * own category of that name (regardless of case), otherwise under „Vom Träger“. `visibleToStaff`: also Mitarbeiter
 * accounts and the facility's tablet see it (else only whoever holds contacts.manage). `sortOrder` orders before the
 * organisation (0 for all today). Business contacts, no retention period: they go with their facility.
 */
export const contacts = sqliteTable('contacts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: integer('facility_id').references(() => facilities.id, { onDelete: 'cascade' }),
  categoryId: integer('category_id').references(() => contactCategories.id),
  categoryName: text('category_name'),
  organisation: text('organisation').notNull(),
  person: text('person').notNull().default(''),
  role: text('role').notNull().default(''),
  phone: text('phone').notNull().default(''),
  mobile: text('mobile').notNull().default(''),
  email: text('email').notNull().default(''),
  street: text('street').notNull().default(''),
  postalCode: text('postal_code').notNull().default(''),
  city: text('city').notNull().default(''),
  website: text('website').notNull().default(''),
  note: text('note').notNull().default(''),
  visibleToStaff: integer('visible_to_staff', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
  updatedBy: integer('updated_by').references(() => users.id, { onDelete: 'set null' }),
  /** „Gilt für“ alle Einrichtungen (also later ones), like print_templates.all_facilities (shared/domain/documentTargets.ts). */
  allFacilities: integer('all_facilities', { mode: 'boolean' }).notNull().default(false),
}, table => [index('contacts_facility').on(table.facilityId), index('contacts_category').on(table.categoryId)])

/** „Gilt für“ of a contact per facility, like print_template_targets. */
export const contactTargets = sqliteTable('contact_targets', {
  contactId: integer('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  allGroups: integer('all_groups', { mode: 'boolean' }).notNull().default(true),
}, table => [primaryKey({ columns: [table.contactId, table.facilityId] }), index('contact_targets_facility').on(table.facilityId)])

/** The groups a contact is limited to, like print_template_target_groups. */
export const contactTargetGroups = sqliteTable('contact_target_groups', {
  contactId: integer('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  groupId: integer('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
}, table => [primaryKey({ columns: [table.contactId, table.groupId] }), index('contact_target_groups_group').on(table.groupId)])

/**
 * A category of „Wissen“ (Dokumente → Wissen), one list per facility like the print template categories, with one level
 * of subcategories (`parentId`, as there): name unique per facility and parent regardless of case, an order among its
 * siblings, and who sees it and its entries (all / Leitung and Träger / Träger only; a subcategory on top of its
 * category's). Deleted only while the facility has no entry and no subcategory in it.
 */
export const knowledgeCategories = sqliteTable('knowledge_categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  parentId: integer('parent_id').references((): AnySQLiteColumn => knowledgeCategories.id),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  visibility: text('visibility', { enum: TEMPLATE_VISIBILITIES }).notNull().default('all'),
}, table => [
  uniqueIndex('knowledge_categories_facility_parent_name').on(table.facilityId, sql`(case when ${table.parentId} is null then 0 else ${table.parentId} end)`, sql`lower(${table.name})`),
  index('knowledge_categories_parent').on(table.parentId),
])

/**
 * An entry of „Wissen“: a PDF (`fileData`, PDF only, at most 30 MB), a link (`url`, http/https only) or a short
 * formatted text (`body`, sanitized like the free-text answers), of one facility or for all facilities (`facilityId`
 * null, the Träger's: no category row but a `categoryName` – shown in each facility's category of that name, otherwise
 * under „Vom Träger“ – and its own `visibility`, the stricter one wins; a facility's entry leaves it 'all').
 * `needsConfirmation`: readers confirm „Gelesen und verstanden“; `version` counts up with every change of the content
 * (file, link, text), so older confirmations count as „frühere Fassung“; `versionAt` is when the current version came
 * (creation or the last change of the content; the „Nachweis“ prints it). `asOf` is „Stand vom“. `starterKey` marks a
 * starter link (shared/domain/knowledge.ts). Deleted with the facility.
 */
export const knowledgeEntries = sqliteTable('knowledge_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: integer('facility_id').references(() => facilities.id, { onDelete: 'cascade' }),
  categoryId: integer('category_id').references(() => knowledgeCategories.id),
  categoryName: text('category_name'),
  /** An entry for all facilities: the subcategory name within `categoryName` (null = directly in the category). */
  subcategoryName: text('subcategory_name'),
  visibility: text('visibility', { enum: TEMPLATE_VISIBILITIES }).notNull().default('all'),
  kind: text('kind', { enum: ['file', 'link', 'text'] }).notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  asOf: text('as_of'),
  fileData: blob('file_data', { mode: 'buffer' }),
  fileMime: text('file_mime'),
  fileSize: integer('file_size'),
  url: text('url').notNull().default(''),
  body: text('body').notNull().default(''),
  needsConfirmation: integer('needs_confirmation', { mode: 'boolean' }).notNull().default(false),
  version: integer('version').notNull().default(1),
  versionAt: text('version_at').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  starterKey: text('starter_key'),
  createdAt: text('created_at').notNull(),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: text('updated_at').notNull(),
  updatedBy: integer('updated_by').references(() => users.id, { onDelete: 'set null' }),
  /** „Gilt für“ alle Einrichtungen (also later ones), like print_templates.all_facilities. */
  allFacilities: integer('all_facilities', { mode: 'boolean' }).notNull().default(false),
}, table => [index('knowledge_entries_facility').on(table.facilityId), index('knowledge_entries_category').on(table.categoryId)])

/** „Gilt für“ of an entry per facility, like print_template_targets. */
export const knowledgeEntryTargets = sqliteTable('knowledge_entry_targets', {
  entryId: integer('entry_id').notNull().references(() => knowledgeEntries.id, { onDelete: 'cascade' }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  allGroups: integer('all_groups', { mode: 'boolean' }).notNull().default(true),
}, table => [primaryKey({ columns: [table.entryId, table.facilityId] }), index('knowledge_entry_targets_facility').on(table.facilityId)])

/** The groups an entry is limited to, like print_template_target_groups. */
export const knowledgeEntryTargetGroups = sqliteTable('knowledge_entry_target_groups', {
  entryId: integer('entry_id').notNull().references(() => knowledgeEntries.id, { onDelete: 'cascade' }),
  groupId: integer('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
}, table => [primaryKey({ columns: [table.entryId, table.groupId] }), index('knowledge_entry_target_groups_group').on(table.groupId)])

/**
 * „Gelesen und verstanden“: one row per entry and person (the employee – at the tablet the one who entered the PIN,
 * with an own account its linked employee), the last confirmation with the version then confirmed. Personal data: goes
 * with the employee's immediate data after leaving (server/services/employeeDeletion.ts) and with the entry.
 */
export const knowledgeConfirmations = sqliteTable('knowledge_confirmations', {
  entryId: integer('entry_id').notNull().references(() => knowledgeEntries.id, { onDelete: 'cascade' }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  entryVersion: integer('entry_version').notNull(),
  confirmedAt: text('confirmed_at').notNull(),
  via: text('via', { enum: ['tablet', 'account'] }).notNull(),
}, table => [primaryKey({ columns: [table.entryId, table.employeeId] }), index('knowledge_confirmations_employee').on(table.employeeId)])

/**
 * The starter categories and links of „Wissen“ (shared/domain/knowledge.ts) a facility has been given, one row per key:
 * each comes once, a deleted or renamed one does not come back, and a starter new in a later version still arrives.
 */
export const knowledgeStarterSeeds = sqliteTable('knowledge_starter_seeds', {
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  starterKey: text('starter_key').notNull(),
  seededAt: text('seeded_at').notNull(),
}, table => [primaryKey({ columns: [table.facilityId, table.starterKey] })])

/**
 * The order of the entries of „Wissen“ per facility (▲/▼), like print_template_order: an entry of the Träger can sit
 * differently in each facility it shows in. Within a list (a subcategory, the entries directly in a category, or „Vom
 * Träger“) the entries with a row come first by `sortOrder`, then those without one by title. Rows are written when
 * someone orders a list or an entry is filed there anew; they go with the facility or the entry. (The entries' own
 * `sort_order` column is no longer read; the migration copied it here.)
 */
export const knowledgeEntryOrder = sqliteTable('knowledge_entry_order', {
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  entryId: integer('entry_id').notNull().references(() => knowledgeEntries.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull(),
}, table => [primaryKey({ columns: [table.facilityId, table.entryId] }), index('knowledge_entry_order_entry').on(table.entryId)])

/**
 * Schulbezirke: a street list that says which primary school district a house number belongs to. One own list per
 * facility (`facilityId`), plus at most one list of the Träger for all facilities (`facilityId` null); a facility's own
 * list wins over the Träger's. The lists hold no personal data; children are matched on read
 * (server/services/schoolDistricts.ts). Saving replaces the whole list.
 */
export const schoolDistrictLists = sqliteTable('school_district_lists', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: integer('facility_id').references(() => facilities.id, { onDelete: 'cascade' }),
  name: text('name').notNull().default(''),
  /** „Stand“ as written (a date or a year). */
  asOf: text('as_of').notNull().default(''),
  createdAt: text('created_at').notNull(),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: text('updated_at').notNull(),
  updatedBy: integer('updated_by').references(() => users.id, { onDelete: 'set null' }),
  // One list per facility, and one with facility_id null (written without a comma: drizzle-kit splits index expressions there).
}, table => [uniqueIndex('school_district_lists_scope').on(sql`(case when ${table.facilityId} is null then 0 else ${table.facilityId} end)`)])

/**
 * A row of a list: the street as written plus its compare key (shared/domain/schoolDistricts.ts `streetKey`), the house
 * numbers (null/null = the whole street; suffix '' or one lower case letter), the side and the district code. `flags`
 * names the doubts about the source row („unclear,reversed“), `note` what was in the source then.
 */
export const schoolDistrictRows = sqliteTable('school_district_rows', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  listId: integer('list_id').notNull().references(() => schoolDistrictLists.id, { onDelete: 'cascade' }),
  street: text('street').notNull(),
  streetKey: text('street_key').notNull(),
  fromNo: integer('from_no'),
  fromSuffix: text('from_suffix').notNull().default(''),
  toNo: integer('to_no'),
  toSuffix: text('to_suffix').notNull().default(''),
  side: text('side', { enum: ['odd', 'even', 'all'] }).notNull().default('all'),
  district: text('district').notNull(),
  flags: text('flags').notNull().default(''),
  note: text('note').notNull().default(''),
}, table => [index('school_district_rows_list_street').on(table.listId, table.streetKey)])

/** The districts of a list: code, the school's name and, optionally, the school in the address book (Kontakte). */
export const schoolDistricts = sqliteTable('school_districts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  listId: integer('list_id').notNull().references(() => schoolDistrictLists.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  name: text('name').notNull().default(''),
  contactId: integer('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
}, table => [uniqueIndex('school_districts_list_code').on(table.listId, table.code), index('school_districts_contact').on(table.contactId)])

/**
 * „Zum Unterschreiben senden“: a PDF the Leitung sends to employees to sign in the app (server/services/signRequests.ts).
 * The file is the snapshot taken when it was sent (a template or a personnel document, possibly filled in before), so
 * every recipient signs exactly that version (`fileSha256` stays as the record of it). Deleting a request (the sender,
 * or the Träger under Löschfristen one year after the last recipient finished) drops the file and hides the request;
 * the row stays as long as recipient rows with the record of a signature or a decline refer to it. A personnel
 * document's folder and employee are kept (`sourceFolder`, `sourceEmployeeId`): only who may use that folder sees the
 * request, and the file goes when that employee's data is deleted. A template's visibility where it showed for the
 * sender is kept (`sourceVisibility`): once the template is deleted, it still decides who sees the request. The signed
 * copies are documents of the personnel file in `targetFolder`.
 */
export const signRequests = sqliteTable('sign_requests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull(),
  title: text('title').notNull(),
  sourceKind: text('source_kind', { enum: ['template', 'document'] }).notNull(),
  sourceTemplateId: integer('source_template_id').references(() => printTemplates.id, { onDelete: 'set null' }),
  sourceDocumentId: integer('source_document_id').references(() => employeeDocuments.id, { onDelete: 'set null' }),
  fileData: blob('file_data', { mode: 'buffer' }),
  fileSize: integer('file_size').notNull(),
  fileSha256: text('file_sha256').notNull(),
  sourceFolder: text('source_folder', { enum: EMPLOYEE_DOCUMENT_FOLDERS }),
  sourceVisibility: text('source_visibility', { enum: TEMPLATE_VISIBILITIES }),
  sourceEmployeeId: integer('source_employee_id').references(() => employees.id, { onDelete: 'set null' }),
  deletedAt: text('deleted_at'),
  targetFolder: text('target_folder', { enum: EMPLOYEE_DOCUMENT_FOLDERS }).notNull(),
  dueDate: text('due_date'),
  note: text('note').notNull().default(''),
}, table => [index('sign_requests_facility').on(table.facilityId), index('sign_requests_source_employee').on(table.sourceEmployeeId)])

/**
 * One employee of a request: open until they sign (the signed copy in their personnel file, its SHA-256 for the
 * record), decline (with a reason) or the sender withdraws it. `remindedAt`: the sender's last reminder.
 */
export const signRequestRecipients = sqliteTable('sign_request_recipients', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  requestId: integer('request_id').notNull().references(() => signRequests.id, { onDelete: 'cascade' }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  status: text('status', { enum: ['open', 'signed', 'declined', 'withdrawn'] }).notNull().default('open'),
  signedAt: text('signed_at'),
  declinedAt: text('declined_at'),
  declineReason: text('decline_reason'),
  withdrawnAt: text('withdrawn_at'),
  signedDocumentId: integer('signed_document_id').references(() => employeeDocuments.id, { onDelete: 'set null' }),
  signedHash: text('signed_hash'),
  remindedAt: text('reminded_at'),
}, table => [
  uniqueIndex('sign_request_recipients_request_employee').on(table.requestId, table.employeeId),
  index('sign_request_recipients_employee').on(table.employeeId, table.status),
])

/**
 * „Zu unterschreiben“ at the tablet: the person who entered their PIN there, for signing only (never the child records,
 * which have terminal_unlocks). One per tablet; short-lived (shared/domain/signRequests.ts SIGN_UNLOCK_IDLE_MS and
 * SIGN_UNLOCK_MAX_MS, no windows without the automatic lock). The token lives in the tablet's session.
 */
export const signUnlocks = sqliteTable('sign_unlocks', {
  id: text('id').primaryKey(),
  terminalUserId: integer('terminal_user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
  lastActiveAt: text('last_active_at').notNull(),
})
