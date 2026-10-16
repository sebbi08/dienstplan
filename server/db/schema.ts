import { sql } from 'drizzle-orm'
import { blob, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { GermanState } from '../../shared/domain/states'

/** A facility (Einrichtung) of the Träger; the existing data became facility 1 "Kindergarten". */
export const facilities = sqliteTable('facilities', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  sortOrder: integer('sort_order').notNull().default(0),
  /** Start of time tracking in this facility (ISO date; null = plan only). */
  timeTrackingFrom: text('time_tracking_from'),
  /** At most this many employees of the facility on leave at the same time (null = no limit). */
  leaveMaxConcurrent: integer('leave_max_concurrent'),
  /** School cutoff (Stichtag): a child is of school age when it reaches `schoolAgeYears` on or before this day of the year. */
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
  /** Child attendance: the times (minutes after midnight) at which snack and lunch are counted. */
  snackTime: integer('snack_time').notNull().default(570),
  lunchTime: integer('lunch_time').notNull().default(720),
  /** Child attendance: whether arriving asks who brought the child. */
  recordBroughtBy: integer('record_brought_by', { mode: 'boolean' }).notNull().default(false),
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
  /** The home group in the home facility (null = Springer, or the facility has no groups). */
  groupId: groupId(),
  name: text('name').notNull(),
  shortName: text('short_name').notNull().default(''),
  sortOrder: integer('sort_order').notNull().default(0),
  leftOn: text('left_on'),
  /** Hash of the 4-digit stamp PIN for the shared tablet (null = no PIN). */
  pinHash: text('pin_hash'),
  pinFailed: integer('pin_failed').notNull().default(0),
  pinLockedUntil: text('pin_locked_until'),
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
})

export const leaveEntitlements = sqliteTable('leave_entitlements', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  year: integer('year').notNull(),
  days: real('days').notNull(),
  carriedOverDays: real('carried_over_days').notNull().default(0),
}, table => [uniqueIndex('leave_entitlements_employee_year').on(table.employeeId, table.year)])

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['provider', 'admin', 'observer', 'terminal'] }).notNull(),
  employeeId: integer('employee_id').references(() => employees.id, { onDelete: 'set null' }).unique(),
  mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
  failedLogins: integer('failed_logins').notNull().default(0),
  lockedUntil: text('locked_until'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  /** Leitung and tablet: their facility. Träger: the active facility selection. Mitarbeiter: null (follows the employee). */
  facilityId: integer('facility_id').references(() => facilities.id),
  /** Besides the Träger and the Leitung: may this account edit child records? */
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
})

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
}, table => [index('time_records_employee_date').on(table.employeeId, table.date)])

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
}, table => [index('week_template_entries_template').on(table.weekTemplateId)])

/** Which template a plan week came from or was saved as (latest wins); its name is shown in the plan's week row. */
export const weekTemplateMarks = sqliteTable('week_template_marks', {
  facilityId: facilityId(),
  weekStart: text('week_start').notNull(),
  weekTemplateId: integer('week_template_id').notNull().references(() => weekTemplates.id, { onDelete: 'cascade' }),
  /** The group's week (0 = the whole facility; no foreign key, as 0 is no group). */
  groupId: integer('group_id').notNull().default(0),
}, table => [primaryKey({ columns: [table.facilityId, table.groupId, table.weekStart] })])

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
  createdAt: text('created_at').notNull(),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  decidedAt: text('decided_at'),
  decidedBy: integer('decided_by').references(() => users.id, { onDelete: 'set null' }),
  decisionNote: text('decision_note').notNull().default(''),
}, table => [index('leave_requests_employee').on(table.employeeId), index('leave_requests_status').on(table.status)])

/** Accounts (Träger/Leitung) the Träger made responsible for leave planning. */
export const leavePlanners = sqliteTable('leave_planners', {
  userId: integer('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
})

/**
 * A kind of mandatory appointment or proof (Pflichttermin) of a facility. Its name is unique within the facility,
 * compared case-insensitively. Every facility has the four built-in kinds (see shared/domain/requirements.ts).
 */
export const requirementTypes = sqliteTable('requirement_types', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id),
  name: text('name').notNull(),
  /** Due again every this many months (null = needed once). */
  intervalMonths: integer('interval_months'),
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
  leftOn: text('left_on'),
  // Health
  measlesProof: integer('measles_proof', { mode: 'boolean' }),
  measlesProofDate: text('measles_proof_date'),
  infectionBriefingDate: text('infection_briefing_date'),
  allergies: text('allergies').notNull().default(''),
  mayTakeTemperature: integer('may_take_temperature', { mode: 'boolean' }),
  mayApplySunscreen: integer('may_apply_sunscreen', { mode: 'boolean' }),
  mayApplyPlaster: integer('may_apply_plaster', { mode: 'boolean' }),
  // Consents (Einwilligungen)
  consentArtworkDisplay: integer('consent_artwork_display', { mode: 'boolean' }),
  consentPhotosDisplay: integer('consent_photos_display', { mode: 'boolean' }),
  consentPhotosForeignPortfolios: integer('consent_photos_foreign_portfolios', { mode: 'boolean' }),
  consentPhotosInternalEvents: integer('consent_photos_internal_events', { mode: 'boolean' }),
  consentPhotosWhatsapp: integer('consent_photos_whatsapp', { mode: 'boolean' }),
  consentPhotosNamesBirthdaysDisplay: integer('consent_photos_names_birthdays_display', { mode: 'boolean' }),
  consentGroupWorkWithNames: integer('consent_group_work_with_names', { mode: 'boolean' }),
  consentWhatsappContact: integer('consent_whatsapp_contact', { mode: 'boolean' }),
  consentWhatsappPhotos: integer('consent_whatsapp_photos', { mode: 'boolean' }),
  consentWhatsappParentGroup: integer('consent_whatsapp_parent_group', { mode: 'boolean' }),
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
}, table => [index('child_documents_child').on(table.childId)])

/**
 * A child on a date (Anwesenheitstag), created by the first entry of that day. `groupId` is the child's group on the
 * day, stored when the row was created. `snack`/`lunch`: null = counted automatically, true/false = set by hand.
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
  snack: integer('snack', { mode: 'boolean' }),
  lunch: integer('lunch', { mode: 'boolean' }),
}, table => [uniqueIndex('child_attendance_days_child_date').on(table.childId, table.date)])

/** One stay of a child on a day; `left` null while the child is still here. The pickup person's name as it was. */
export const childAttendanceStays = sqliteTable('child_attendance_stays', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  dayId: integer('day_id').notNull().references(() => childAttendanceDays.id, { onDelete: 'cascade' }),
  arrived: integer('arrived').notNull(),
  left: integer('left'),
  pickedUpBy: text('picked_up_by'),
  pickedUpContactId: integer('picked_up_contact_id').references(() => childContacts.id, { onDelete: 'set null' }),
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
 * The child records are unlocked at a facility's tablet by one person (name + PIN): at most one row per tablet account.
 * Locking deletes the row; the tablet's session holds its id. Valid until `lastActiveAt` plus the facility's lock time.
 */
export const terminalUnlocks = sqliteTable('terminal_unlocks', {
  id: text('id').primaryKey(),
  terminalUserId: integer('terminal_user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
  lastActiveAt: text('last_active_at').notNull(),
})
