import { z } from 'zod'
import { isValidIsoDate } from '../shared/domain/dates'
import { MAX_REQUIREMENT_INTERVAL_MONTHS } from '../shared/domain/requirements'
import { BREAK_MODES, STAMP_CHANNELS } from '../shared/domain/stamping'
import { JOB_KEYS, PAY_GROUPS } from '../shared/domain/tvoed'
import { COLOR_KEYS, CONSENT_KEYS, REVIEW_SECTIONS, type ConsentKey, type MeetingKind } from '../shared/types/api'

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isValidIsoDate)
export const minutes = z.number().int().min(0).max(1440)

export const loginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
})

export const passwordChangeSchema = z.object({
  currentPassword: z.string().max(200),
  newPassword: z.string().max(200),
})

const nullableMinutes = minutes.nullable().optional()
const label = z.string().max(100)

export const idParams = z.object({ id: z.coerce.number().int().positive() })
/** The format (exactly six digits) is checked by setPin, so the form shows „Die PIN muss aus 6 Ziffern bestehen.“. */
export const pinSchema = z.object({ pin: z.string().max(20) })
export const terminalStampSchema = z.object({ employeeId: z.number().int(), pin: z.string().max(10), action: z.enum(['in', 'out']) })
/** Unlocking the child records at the tablet: the person and the PIN (checked by the service). */
export const tabletUnlockSchema = z.object({ employeeId: z.number().int(), pin: z.string().max(10) })
export const dateParams = z.object({ date: isoDate })
export const monthParams = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
})
export const yearQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100) })
export const employeeYearParams = idParams.extend({ year: z.coerce.number().int().min(2000).max(2100) })

export const entryInputSchema = z.object({
  kind: z.enum(['shift', 'special', 'code', 'break']),
  templateId: z.number().int().nullable().optional(),
  codeId: z.number().int().nullable().optional(),
  start: nullableMinutes,
  end: nullableMinutes,
  breakStart: nullableMinutes,
  breakEnd: nullableMinutes,
  note: z.string().max(200).nullable().optional(),
  groupId: z.number().int().positive().nullable().optional(),
})
export const applyEntriesSchema = z.object({
  cells: z.array(z.object({ employeeId: z.number().int(), date: isoDate })).min(1).max(1000),
  mode: z.enum(['replace', 'add', 'clear']),
  entry: entryInputSchema.nullable(),
})
export const dayNoteSchema = z.object({ field: z.enum(['info1', 'info2']), value: z.string().max(200) })
export const revertSchema = z.object({ keys: z.array(z.string().max(40)).min(1).max(2000) })
export const entryTimesSchema = z.object({ start: minutes, end: minutes, breakStart: minutes.nullable(), breakEnd: minutes.nullable() })
export const entryGroupSchema = z.object({ groupId: z.number().int().positive().nullable() })

const weeklyMinutes = z.number().int().min(0).max(80 * 60)
const workdays = z.number().int().min(1).max(127)
/** A group of the facility, or null for none (Springer). */
export const groupIdSchema = z.number().int().positive().nullable()
export const employeeCreateSchema = z.object({
  name: label, shortName: z.string().max(10), weeklyMinutes, validFrom: isoDate, workdays: workdays.optional(),
  vacationDays: z.number().min(0).max(100).nullable().optional(), carriedOverDays: z.number().min(0).max(100).nullable().optional(),
  openingBalanceMinutes: z.number().int().min(-200_000).max(200_000).nullable().optional(),
  stampVia: z.enum(STAMP_CHANNELS).optional(), breakMode: z.enum(BREAK_MODES).optional(),
  groupId: groupIdSchema.optional(),
})
/** groupId and birthday left out keep them; the birthday (MM-DD) is checked by the service (employee_birthday_invalid). */
export const employeeUpdateSchema = z.object({
  name: label, shortName: z.string().max(10), leftOn: isoDate.nullable(), groupId: groupIdSchema.optional(),
  birthday: z.string().max(10).nullable().optional(),
  // Staffing ratio; left out = unchanged, checked by the service (qualification_invalid, staffing_share_invalid).
  qualification: z.string().max(20).nullable().optional(),
  staffingShare: z.number().nullable().optional(),
})
export const moveSchema = z.object({ direction: z.enum(['up', 'down']) })
/** Deleting a left employee: `confirm` is the name typed by hand (anything else, or nothing, is 400 employee_delete_confirm_mismatch). */
export const employeeDeleteSchema = z.object({ confirm: z.string().max(200).catch('') }).catch({ confirm: '' })
export const hoursSchema = z.object({ weeklyMinutes, validFrom: isoDate, workdays: workdays.optional() })
export const adjustmentSchema = z.object({ date: isoDate, minutes: z.number().int().min(-200_000).max(200_000), reason: z.string().max(200) })
export const entitlementSchema = z.object({ days: z.number().min(0).max(100), carriedOverDays: z.number().min(0).max(100) })

export const closureSchema = z.object({ startDate: isoDate, endDate: isoDate, label, mode: z.enum(['vacation', 'closure_day']) })

export const templateSchema = z.object({
  shortLabel: z.string().max(10), label, start: minutes, end: minutes,
  breakStart: minutes.nullable(), breakEnd: minutes.nullable(), countsAsStaff: z.boolean(),
  pairsWithPrepTime: z.boolean(), sortOrder: z.number().int(),
})
export const codeUpdateSchema = z.object({ label, color: z.enum(COLOR_KEYS), creditMode: z.enum(['daily_target', 'timed', 'none']) })
/** groupId: the group the rule applies to (null = the whole facility); left out = the whole facility, on update unchanged. */
export const coverageRuleSchema = z.object({
  label, start: minutes, end: minutes.nullable(), minCount: z.number().int().min(1).max(20), active: z.boolean(),
  groupId: z.number().int().positive().nullable().optional(),
  /** Weekday mask Mo = 1 … Fr = 16; left out on update keeps the rule's weekdays, on create means all. */
  weekdays: z.number().int().min(1).max(31).optional(),
})

/** One weekday's opening hours; the service checks the times, the number of days and the minimum counts. */
const dayHoursSchema = z.object({ open: z.number().nullable(), close: z.number().nullable(), closed: z.boolean() })
const openingHoursSchema = z.object({ days: z.array(dayHoursSchema).max(20), minAtOpening: z.number(), minAtClosing: z.number() })
/** `hours: null` removes the hours (a group falls back to the facility's). */
export const openingHoursBodySchema = z.object({ hours: openingHoursSchema.nullable() })

export const userCreateSchema = z.object({
  username: z.string().max(50), password: z.string().max(200),
  role: z.enum(['provider', 'admin', 'observer', 'terminal']), employeeId: z.number().int().nullable(),
})
export const userUpdateSchema = z.object({
  role: z.enum(['provider', 'admin', 'observer', 'terminal']), employeeId: z.number().int().nullable(), active: z.boolean(),
  canEditChildren: z.boolean(),
})
export const passwordResetSchema = z.object({ password: z.string().max(200) })
export const appSettingsSchema = z.object({ timeTrackingFrom: isoDate.nullable() })

export const timeRecordCreateSchema = z.object({ employeeId: z.number().int(), date: isoDate, start: minutes, end: minutes })
export const timeRecordUpdateSchema = z.object({ start: minutes, end: minutes })
export const earlyClosureSchema = z.object({ date: isoDate, closedFrom: minutes, reason: z.string().max(200) })
export const calendarEventSchema = z.object({
  date: isoDate, start: minutes.nullable(), end: minutes.nullable(), title: z.string().max(200), visibleToStaff: z.boolean(),
})
/** leftAt is checked by the service (invalid_time), so a wrong time gets its own message. */
export const earlySickLeaveSchema = z.object({
  employeeId: z.number().int().positive(), date: isoDate, leftAt: z.number().nullable(), note: z.string().max(200).nullable().optional(),
})
export const timeDayNoteSchema = z.object({ employeeId: z.number().int(), date: isoDate, note: z.string().max(200) })
export const stampSchema = z.object({ action: z.enum(['in', 'out']) })
export const timeMonthQuery = monthParams.extend({ employeeId: z.coerce.number().int().positive() })
/** groupId: the group the template is for (null or left out = the whole facility). */
export const weekTemplateSaveSchema = z.object({ name: label, weekStart: isoDate, groupId: groupIdSchema.optional() })
export const weekTemplateRenameSchema = z.object({ name: label })
export const weekTemplateApplySchema = z.object({ weekStart: isoDate })
/** Saving a changed service: applyFrom = also give existing shifts from that day on the new times (null = only new entries). */
export const templateChangeSchema = templateSchema.extend({ applyFrom: isoDate.nullable().optional() })
export const contractSchema = z.object({
  personnelNumber: z.string().max(30).nullable(),
  employedSince: isoDate.nullable(), jobKey: z.enum(JOB_KEYS).nullable(), jobOther: z.string().max(100).nullable(),
  payGroup: z.enum(PAY_GROUPS).nullable(), payLevel: z.number().int().min(1).max(6).nullable(),
})
export const contractVisibilitySchema = z.object({ visible: z.boolean() })
export const stampingSchema = z.object({ stampVia: z.enum(STAMP_CHANNELS), breakMode: z.enum(BREAK_MODES) })
export const notificationsReadSchema = z.object({ ids: z.array(z.number().int().positive()).max(500) })
export const leaveModuleSchema = z.object({ enabled: z.boolean(), plannerIds: z.array(z.number().int().positive()).max(50) })
export const leaveMaxSchema = z.object({ value: z.number().int().min(1).max(100).nullable() })
export const leaveRangeQuery = z.object({ from: isoDate, to: isoDate })
export const leaveRequestSchema = z.object({ from: isoDate, to: isoDate, note: z.string().max(300) })
export const leaveDecisionSchema = z.object({ approve: z.boolean(), note: z.string().max(300), overwrite: z.boolean() })
export const pdfQuery = z.object({ path: z.string().max(200), name: z.string().regex(/^[\w.-]{1,80}$/) })
/** The state code is checked only by the service, so every unknown value answers 400 state_invalid. */
export const facilityCreateSchema = z.object({ name: z.string().max(80), state: z.string().optional() })
export const facilityUpdateSchema = facilityCreateSchema.extend({ assumptionDay: z.boolean().optional() })
export const activeFacilitySchema = z.object({ facilityId: z.number().int().positive() })
export const employeeFacilitySchema = z.object({ facilityId: z.number().int().positive() })
export const childFacilitySchema = z.object({ facilityId: z.number().int().positive() })
export const childLeaveSchema = z.object({ leftOn: isoDate })
/** The range (whole years 1-10) is checked by the service, which answers invalid_retention. */
export const childRetentionSchema = z.object({ years: z.number() })
/**
 * The Träger's staffing overrides, path → number; the service checks the paths and the values (staffing_override_invalid)
 * and whether the rules stay usable (staffing_rules_invalid).
 */
export const staffingOverridesSchema = z.object({ overrides: z.record(z.string().max(200), z.unknown()) })
/** „Auf Vorgabe zurücksetzen“: without `path` every override goes, with it only that one. */
export const staffingResetQuery = z.object({ path: z.string().max(200).optional() })
/** A key of the state's group types (null = none); the service answers staffing_group_type_invalid for any other. */
export const groupTypeSchema = z.object({ groupType: z.string().max(40).nullable() })
/** Query of the retention preview; out-of-range values answer 400 as for any invalid query. */
export const childRetentionPreviewQuery = z.object({ years: z.coerce.number().int().min(1).max(10) })
export const helpOutSchema = z.object({
  employeeId: z.number().int().positive(),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
})
export const groupNameSchema = z.object({ name: z.string().max(80) })
/** The range (whole number 1-200 or null) is checked by the service, which answers invalid_capacity. */
export const groupCapacitySchema = z.object({ capacity: z.number().nullable() })
/** The range (whole number 1-999 or null) is checked by the service, which answers invalid_facility_capacity. */
export const facilityCapacitySchema = z.object({ capacity: z.number().nullable() })
/** A palette key of GROUP_COLORS (null = no colour); the service answers invalid_group_color for any other. */
export const groupColorSchema = z.object({ color: z.string().max(20).nullable() })
/** Whether the group is for school children (after-school care). */
export const groupSchoolChildrenSchema = z.object({ forSchoolChildren: z.boolean() })
/** The groups the staff of a group may also read; the service checks that they belong to its facility. */
export const groupReadAccessSchema = z.object({ readable: z.array(z.number().int().positive()).max(100) })
/** The values are checked by the service, which answers invalid_school_cutoff. */
export const schoolSettingsSchema = z.object({ cutoffMonth: z.number(), cutoffDay: z.number(), ageYears: z.number() })
/**
 * A documentation setting with the optional start („Beginn“) of interval mode; the numbers and the start are checked by
 * the service, which answers reminder_setting_invalid (reminder_date_invalid for the start).
 */
export const docSettingsSchema = z.object({
  mode: z.enum(['off', 'interval', 'birthday']), intervalMonths: z.number(), leadWeeks: z.number(), docSince: z.string().optional(),
})
/** The facility's reminder settings; the numbers are checked by the service, which answers reminder_setting_invalid. */
export const reminderSettingsSchema = z.object({
  noGroupDoc: docSettingsSchema, birthdayLeadDays: z.number(), staffBirthdayLeadDays: z.number(), leavingLeadWeeks: z.number(),
})
/** The tablet settings of a facility. The lock time is checked by the service, which answers tablet_lock_minutes_invalid. */
export const tabletSettingsSchema = z.object({ lockMinutes: z.number(), showWaitlist: z.boolean(), showFutureContracts: z.boolean() })
/**
 * Late / early marks of the time tracking. The tolerance is checked by the service, which answers mark_tolerance_invalid;
 * an emptied number field arrives as '' or null and passes here, so the user gets that German error.
 */
export const timeMarkSettingsSchema = z.object({ toleranceMinutes: z.union([z.number(), z.literal(''), z.null()]), markEarlyLeave: z.boolean() })
/**
 * The switch "deregister school children automatically". Switching on needs the children the preview showed, each
 * with its leaving day (`confirmed`; the preview's entries can be sent back as they are, further fields are dropped);
 * the service refuses when they are not the ones it would deregister now.
 */
export const autoLeaveSchema = z.object({
  value: z.boolean(),
  confirmed: z.array(z.object({ id: z.number().int().positive(), leftOn: isoDate })).max(5000).optional(),
})
/** The Kita year's start year; the range is checked by the service, which answers invalid_year. */
export const occupancyQuery = z.object({ year: z.coerce.number() })
/** intervalMonths: due again every … months (null = needed once). */
export const requirementTypeSchema = z.object({
  name: z.string().max(80), intervalMonths: z.number().int().min(1).max(MAX_REQUIREMENT_INTERVAL_MONTHS).nullable(),
})
export const requirementRecordSchema = z.object({
  typeId: z.number().int().positive(), date: isoDate, note: z.string().max(200).nullable().optional(),
})
export const trainingSchema = z.object({ date: isoDate, title: z.string().max(200), note: z.string().max(500).nullable().optional() })

export const careTypeSchema = z.object({
  name: z.string().max(80),
  start: z.number().int(),
  end: z.number().int(),
  sortOrder: z.number().int().min(0).max(10000),
  // 1–7, checked by the service (care_type_invalid_days); left out = 5 for a new care type, unchanged on update.
  daysPerWeek: z.number().optional(),
})
export const documentTypeSchema = z.object({
  name: z.string().max(80),
  important: z.boolean(),
  required: z.boolean(),
  confidentialDefault: z.boolean(),
  sortOrder: z.number().int().min(0).max(10000),
  // Left out = unchanged: a client that does not know the flag must not take it away.
  careContract: z.boolean().optional(),
})

const triState = z.boolean().nullable()
const optionalDate = isoDate.nullable()
const nullableId = z.number().int().positive().nullable()
const childMasterFields = z.object({
  lastName: z.string().max(100),
  firstName: z.string().max(100),
  birthDate: isoDate,
  address: z.string().max(500),
  groupId: nullableId,
  careTypeId: nullableId,
  entryDate: optionalDate,
  plannedEntryDate: optionalDate,
  // Required: an old client omitting it must not silently turn a waitlist child into a contract child.
  admissionStatus: z.enum(['waitlist', 'contract']),
  waitlistedOn: optionalDate.default(null),
  infoMeetingDate: optionalDate,
  schoolStartDate: optionalDate,
  primarySchool: z.string().max(200),
  schoolDistrict: z.string().max(100),
  keyEducatorId: nullableId,
  note: z.string().max(2000),
})
/**
 * Saving the master data of an existing child. `baseGroupId` is the group the form was loaded with and is required:
 * an old client omitting it must not silently undo a group change that was applied while its form was open.
 */
export const childMasterSchema = childMasterFields.extend({
  baseGroupId: nullableId,
  // Left out = the stored one stays: the forms of those who may not change it (only Leitung and Träger) omit it.
  schoolStartDate: optionalDate.optional(),
})
/** A planned group change: the new group, the change day and per section whether it is kept (false = confirm again). */
export const groupChangeSchema = z.object({
  groupId: z.number().int().positive(),
  date: isoDate,
  keep: z.object({
    contacts: z.boolean(), health: z.boolean(), consents: z.boolean(), documents: z.boolean(), careType: z.boolean(),
    keyEducator: z.boolean(),
  }),
  // "A further care contract has been concluded": the service requires it for a group for school children.
  newContract: z.boolean().optional(),
})
/** Taking a leaving back; the new school start is only needed when the child's school start is already reached. */
export const childUnleaveSchema = z.object({ schoolStartDate: isoDate.optional() })
/** The section of a child's record to confirm again after a group change. */
export const confirmSectionSchema = z.object({ section: z.enum(REVIEW_SECTIONS) })
/** A new child may omit the admission status (a contract child). */
export const childCreateSchema = childMasterFields.extend({
  admissionStatus: z.enum(['waitlist', 'contract']).default('contract'),
})
export const childHealthSchema = z.object({
  measlesProof: triState,
  measlesProofDate: optionalDate,
  infectionBriefingDate: optionalDate,
  allergies: z.string().max(2000),
  mayTakeTemperature: triState,
  mayApplySunscreen: triState,
  mayApplyPlaster: triState,
})
export const childConsentsSchema = z.object(
  Object.fromEntries(CONSENT_KEYS.map(key => [key, triState])) as Record<ConsentKey, typeof triState>,
)
export const childContactSchema = z.object({
  name: z.string().max(100),
  relation: z.string().max(100),
  phoneHome: z.string().max(50),
  phoneMobile: z.string().max(50),
  phoneWork: z.string().max(50),
  isGuardian: z.boolean(),
  mayPickUp: z.boolean(),
  emergencyRank: z.number().int().min(1).max(20).nullable(),
  contactBan: z.boolean(),
  contactBanNote: z.string().max(500),
  note: z.string().max(1000),
})
export const contactOrderSchema = z.object({ ids: z.array(z.number().int().positive()).max(100) })
export const childListQuery = z.object({ status: z.literal('active') })
/** The text fields of the multipart upload (everything arrives as a string). */
export const childDocumentFields = z.object({
  typeId: z.coerce.number().int().positive(),
  title: z.string().max(200),
  documentDate: isoDate,
  confidential: z.enum(['true', 'false']).transform(value => value === 'true'),
})
export const childDocumentSchema = z.object({
  typeId: z.number().int().positive(),
  title: z.string().max(200),
  documentDate: isoDate,
  confidential: z.boolean(),
})
export const fileQuery = z.object({ download: z.enum(['1']).optional() })
// Print templates: the form fields of the upload (multipart, so all text) and the change of title and category.
export const printTemplateSchema = z.object({ title: z.string().max(200), category: z.string().max(60) })
export const printTemplateFields = printTemplateSchema.extend({ scope: z.enum(['facility', 'all']).default('facility') })
/** Replacing the file sends the file alone. */
export const noFields = z.object({})

// Child attendance: clock times are minutes of the day (0–1439); the rules (planned pickup, pickup person) are the service's,
// so a missing planned pickup or pickup person passes here and gets the service's own hint.
const clockTime = z.number().int().min(0).max(1439)
const attendanceChild = { childId: z.number().int().positive(), date: isoDate }
const pickupChoice = z.union([
  z.object({ kind: z.enum(['contact', 'announcement']), id: z.number().int().positive() }),
  // A person typed by hand; an empty name passes here and gets the service's pickup_person_required.
  z.object({ kind: z.literal('other'), name: z.string().max(100), confirmedWith: z.string().max(100).optional() }),
])
/**
 * A parent meeting. The end after the start, the kind and the text lengths (trimmed) are the service's checks, so they
 * get its own hints; `note` is only accepted from Leitung and Träger (also the service's).
 */
export const parentMeetingSchema = z.object({
  date: isoDate,
  start: clockTime,
  end: clockTime.nullable(),
  // Checked by the service (400 meeting_kind_invalid), so a stale client gets its hint.
  kind: z.string().max(40).transform(value => value as MeetingKind),
  participants: z.string().max(1000),
  note: z.string().max(10_000).optional(),
})
export const attendanceDayQuery = z.object({ date: isoDate })
export const attendanceHistoryQuery = z.object({ childId: z.coerce.number().int().positive(), date: isoDate })
export const attendanceArriveSchema = z.object({
  ...attendanceChild, time: clockTime, plannedPickup: clockTime.nullish(), broughtBy: z.string().max(100).optional(),
})
export const attendanceLeaveSchema = z.object({ ...attendanceChild, time: clockTime, pickup: pickupChoice.nullish() })
export const attendanceAnnouncementSchema = z.object({
  ...attendanceChild, name: z.string().max(100), announcedBy: z.string().max(100).default(''),
})
export const attendanceAbsenceSchema = z.object({
  childId: z.number().int().positive(), from: isoDate, to: isoDate, kind: z.enum(['sick', 'vacation', 'excused']).nullable(),
})
export const attendanceDaySchema = z.object({
  ...attendanceChild,
  plannedPickup: clockTime.optional(),
  broughtBy: z.string().max(100).optional(),
  note: z.string().max(2000).optional(),
  // Ticks by meal id (JSON keys are text); whether the meal is one of the day is checked by the service.
  meals: z.record(z.string().regex(/^[1-9]\d{0,9}$/), z.boolean().nullable()).optional(),
})
export const attendanceStaySchema = z.object({ arrived: clockTime, left: clockTime.nullable(), pickup: pickupChoice.optional() })
export const attendanceMonthQuery = monthParams
export const attendanceMonthRemarkSchema = z.object({
  childId: z.number().int().positive(), month: z.string().regex(/^\d{4}-\d{2}$/), remark: z.string().max(500),
})
/** The attendance settings of a facility. The recording start is checked by the service, which answers invalid_date. */
export const attendanceSettingsSchema = z.object({ recordBroughtBy: z.boolean(), attendanceSince: z.string().nullable() })
/**
 * A new meal or a change of one from a day on. Name, time and day are checked by the service (meal_name_required,
 * meal_name_too_long, attendance_time_invalid, invalid_date, meal_valid_from_past), so the answers are in German.
 */
export const mealSchema = z.object({ name: z.string().max(200), time: z.number(), validFrom: z.string() })
/** The day from which a meal is gone (body or query). */
export const mealRemoveSchema = z.object({ validFrom: z.string() })

// Group book (weekly overview): the date rules (Monday to Friday) and the group rights are the service's.
const groupBookText = z.string().max(5000)
/** Without `groupId` the viewer's own group (or the first one the viewer sees). */
export const groupBookWeekQuery = z.object({ groupId: z.coerce.number().int().positive().optional(), date: isoDate })
export const groupBookWeekSchema = z.object({ groupId: z.number().int().positive(), weekStart: isoDate, text: groupBookText })
export const groupBookDaySchema = z.object({ groupId: z.number().int().positive(), date: isoDate, text: groupBookText })
export const groupBookHistoryQuery = z.object({
  groupId: z.coerce.number().int().positive(), field: z.enum(['week', 'day']), date: isoDate,
})

/** „Zur Kenntnis genommen“ of plan warnings (a condensed line marks all its days); the key's format is checked by the service. */
const warningAckKey = z.string().min(1).max(300)
export const warningAcksSchema = z.object({
  items: z.array(z.object({ key: warningAckKey, signature: z.string().max(100) })).min(1).max(1000),
})
export const warningAckKeysSchema = z.object({ keys: z.array(warningAckKey).min(1).max(1000) })

/** The key of an item of „Was noch fehlt“ in the address; the service checks that it is known. */
export const setupItemParams = z.object({ key: z.string().min(1).max(60) })

// Cash book (Kasse): amounts are integer cents (the client parses „12,50“). Name, start balance, date, amount and
// purpose are checked by the services (cash_box_name_required, cash_amount_invalid, cash_date_future …), so the answers
// are in German.
const cashFacts = { date: z.string().max(20), cents: z.number(), purpose: z.string().max(1000) }
export const cashBoxSchema = z.object({
  name: z.string().max(200),
  kind: z.enum(['cash', 'account']),
  groupId: z.number().int().positive().nullable(),
  startYear: z.number().int().min(2000).max(2100),
  startMonth: z.number().int().min(1).max(12),
  startBalance: z.number(),
})
export const cashBoxUpdateSchema = cashBoxSchema.extend({ archived: z.boolean() })
export const cashMonthParams = idParams.extend(monthParams.shape)
export const cashEntrySchema = z.object({ boxId: z.number().int().positive(), direction: z.enum(['in', 'out']), ...cashFacts })
export const cashFactsSchema = z.object(cashFacts)
export const cashTransferSchema = z.object({
  fromBoxId: z.number().int().positive(), toBoxId: z.number().int().positive(), ...cashFacts,
})
export const cashPurposeQuery = z.object({ q: z.string().max(200).default('') })
/** Closing a month; whether it may be closed is checked by the service (cash_close_not_over …). */
export const cashCloseSchema = z.object({ year: z.number().int().min(2000).max(2100), month: z.number().int().min(1).max(12) })
/** Reopening: the reason (1–200 chars) is checked by the service (cash_reopen_reason_invalid). */
export const cashReopenSchema = cashCloseSchema.extend({ reason: z.string().max(1000) })
/** The CSV file of a month or (without month) of the calendar year. */
export const cashCsvQuery = yearQuery.extend({ month: z.coerce.number().int().min(1).max(12).optional() })

// Form templates („Bögen“): name (1–80, unique per kind) and content are checked by the service
// (form_template_name_too_long, form_content_invalid …), so the answers are in German.
const formKind = z.enum(['staff', 'child', 'team'])
export const formTemplateQuery = z.object({ kind: formKind.optional() })
export const formTemplateSchema = z.object({ kind: formKind, name: z.string().max(200), selfAssessment: z.boolean().default(false) })
/** Any subset; `content` is the whole content as the editor holds it (new sections, items and options without ids). */
export const formTemplateUpdateSchema = z.object({
  name: z.string().max(200).optional(),
  archived: z.boolean().optional(),
  selfAssessment: z.boolean().optional(),
  content: z.unknown().optional(),
  expectedUpdatedAt: z.string().max(40).optional(),
})

/** The header of a staff talk; the limits (date, start 0–1439, text lengths) are checked by the service. */
export const staffTalkHeaderSchema = z.object({
  date: z.string().max(20),
  start: z.number().int().nullable(),
  participants: z.string().max(2000),
  period: z.string().max(500),
})
export const staffTalkSchema = staffTalkHeaderSchema.extend({
  employeeId: z.number().int(),
  templateIds: z.array(z.number().int()).max(50),
})
export const staffTalkQuery = z.object({ employeeId: z.coerce.number().int().positive() })
export const talkFormAddSchema = z.object({ templateId: z.number().int() })
export const formIdParams = z.object({ formId: z.coerce.number().int().positive() })
/** The answers are checked against the form's own content; `expectedUpdatedAt` is the form's updatedAt the client loaded. */
export const formAnswersSchema = z.object({ answers: z.unknown(), expectedUpdatedAt: z.string().max(40) })
export const readReleaseSchema = z.object({ released: z.boolean() })
/** „Abgeben“ names the form's updatedAt the employee has seen (409 form_changed when the Leitung saved since). */
export const formSubmitSchema = z.object({ expectedUpdatedAt: z.string().max(40) })

/** The header of a child observation form; the limits (date, start 0–1439, text length) are checked by the service. */
const childFormHeaderSchema = z.object({
  date: z.string().max(20),
  start: z.number().int().nullable(),
  participants: z.string().max(2000),
})
/** A new child form: from a template with its header, or from a parent meeting of the child (its header is copied). */
export const childFormCreateSchema = z.union([
  z.object({ templateId: z.number().int(), parentMeetingId: z.number().int() }),
  childFormHeaderSchema.extend({ templateId: z.number().int() }),
])
/** Saving a child form: header and all answers, with the form's updatedAt the client loaded. */
export const childFormSaveSchema = childFormHeaderSchema.extend({
  answers: z.unknown(),
  expectedUpdatedAt: z.string().max(40),
})
/** The header of a team meeting; the limits (date, start 0–1439, text lengths, the group) are checked by the service. */
const teamMeetingHeaderSchema = z.object({
  date: z.string().max(20),
  start: z.number().int().nullable(),
  groupId: z.number().int().nullable(),
  participants: z.string().max(2000),
  recorder: z.string().max(1000),
})
export const teamMeetingCreateSchema = teamMeetingHeaderSchema.extend({ templateId: z.number().int() })
/** Saving a team meeting: header and all answers, with the form's updatedAt the client loaded. */
export const teamMeetingSaveSchema = teamMeetingHeaderSchema.extend({
  answers: z.unknown(),
  expectedUpdatedAt: z.string().max(40),
})
/**
 * The list: a year (default the current one) and `groupId` (absent or empty = all, 0 = only the whole facility, else
 * that group).
 */
export const teamMeetingQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  groupId: z.preprocess(value => (value === '' ? undefined : value), z.coerce.number().int().min(0).optional()),
})
/** „Wieder öffnen“: the reason (1–200 chars) is checked by the service (team_meeting_reason_invalid). */
export const teamMeetingReopenSchema = z.object({ reason: z.string().max(1000) })
/** „Mitarbeiter freischalten“: the employees unlocked for the form from now on (all others are revoked). */
export const childFormEditorsSchema = z.object({ employeeIds: z.array(z.number().int()).max(500) })
