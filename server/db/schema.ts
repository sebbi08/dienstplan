import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/** A facility (Einrichtung) of the Träger; the existing data became facility 1 "Kindergarten". */
export const facilities = sqliteTable('facilities', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  sortOrder: integer('sort_order').notNull().default(0),
  /** Start of time tracking in this facility (ISO date; null = plan only). */
  timeTrackingFrom: text('time_tracking_from'),
  /** At most this many employees of the facility on leave at the same time (null = no limit). */
  leaveMaxConcurrent: integer('leave_max_concurrent'),
})

/** The owning facility of a row (default 1 only until every insert passes it explicitly). */
const facilityId = () => integer('facility_id').notNull().default(1).references(() => facilities.id)

/** A group (Gruppe) of a facility; its name is unique within the facility, compared case-insensitively. */
export const groups = sqliteTable('groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facilityId: integer('facility_id').notNull().references(() => facilities.id),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
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
