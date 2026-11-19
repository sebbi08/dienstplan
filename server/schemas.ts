import { z } from 'zod'
import { BEM_ANSWERS, BEM_LIMITS, BEM_MEASURE_STATUSES, BEM_STEP_KINDS } from '../shared/domain/bem'
import { CHILD_SORTS } from '../shared/domain/childSort'
import { isValidIsoDate } from '../shared/domain/dates'
import { LEAVE_FORFEIT_TEXT_MAX } from '../shared/domain/leaveForfeit'
import { EMPLOYMENT_BAN_KINDS, MATERNITY_NOTE_MAX } from '../shared/domain/maternity'
import { OFFLINE_BATCH_MAX } from '../shared/domain/offlineStamps'
import { EMPLOYEE_DOCUMENT_FOLDERS } from '../shared/domain/personnel'
import { MAX_REQUIREMENT_INTERVAL_MONTHS } from '../shared/domain/requirements'
import { BREAK_MODES, STAMP_CHANNELS } from '../shared/domain/stamping'
import { TEMPLATE_VISIBILITIES } from '../shared/domain/templateCategories'
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
/**
 * The tablet's offline queue (docs/BETRIEB.md „Stempeln ohne Netz am Tablet“): its clock now, and per stamp the random
 * client id, the person, the PIN, Kommt/Geht and the tablet's clock at the tap (ISO with offset); at most 50 per request.
 */
export const offlineStampsSchema = z.object({
  clientNow: z.iso.datetime({ offset: true }),
  stamps: z.array(z.object({
    clientId: z.string().regex(/^[\w-]{8,64}$/),
    employeeId: z.number().int(),
    pin: z.string().max(10),
    action: z.enum(['in', 'out']),
    stampedAt: z.iso.datetime({ offset: true }),
  })).max(OFFLINE_BATCH_MAX),
})
/** Unlocking the child records at the tablet: the person and the PIN (checked by the service). */
export const tabletUnlockSchema = z.object({ employeeId: z.number().int(), pin: z.string().max(10) })
export const dateParams = z.object({ date: isoDate })
export const monthParams = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
})
export const yearQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100) })
/** „Alle Anträge und Urlaube“: the year and the filters (empty or missing = all). */
export const leaveYearListQuery = yearQuery.extend({
  employeeId: z.preprocess(value => (value === '' ? undefined : value), z.coerce.number().int().positive().optional()),
  kind: z.preprocess(value => (value === '' ? undefined : value), z.enum(['vacation', 'special_leave', 'overtime_off']).optional()),
  status: z.preprocess(value => (value === '' ? undefined : value), z.enum(['open', 'approved', 'rejected', 'withdrawn', 'direct']).optional()),
})
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
  homeOffice: z.boolean().optional(),
  employeeChildId: z.number().int().positive().nullable().optional(),
  // Sonderurlaub: key and text are checked by the service (special_leave_reason_invalid, special_leave_text_*).
  specialLeaveReason: z.string().max(40).nullable().optional(),
  specialLeaveText: z.string().max(1000).nullable().optional(),
})
export const applyEntriesSchema = z.object({
  cells: z.array(z.object({ employeeId: z.number().int(), date: isoDate })).min(1).max(1000),
  mode: z.enum(['replace', 'add', 'clear']),
  entry: entryInputSchema.nullable(),
})
export const dayNoteSchema = z.object({ field: z.enum(['info1', 'info2']), value: z.string().max(200) })
export const revertSchema = z.object({ keys: z.array(z.string().max(40)).min(1).max(2000) })
export const entryTimesSchema = z.object({
  start: minutes, end: minutes, breakStart: minutes.nullable(), breakEnd: minutes.nullable(), homeOffice: z.boolean().optional(),
})
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
  /** MM-DD, checked by the service (employee_birthday_invalid); left out = none. */
  birthday: z.string().max(10).nullable().optional(),
})
/** The closure leave preview of the create form: the fields of employeeCreateSchema it reads (weekly hours optional). */
export const closurePreviewSchema = employeeCreateSchema
  .pick({ validFrom: true, workdays: true, vacationDays: true, carriedOverDays: true })
  .extend({ weeklyMinutes: weeklyMinutes.optional() })
/** groupId and birthday left out keep them; the birthday (MM-DD) is checked by the service (employee_birthday_invalid). */
export const employeeUpdateSchema = z.object({
  name: label, shortName: z.string().max(10), leftOn: isoDate.nullable(), groupId: groupIdSchema.optional(),
  birthday: z.string().max(10).nullable().optional(),
  // Staffing ratio; left out = unchanged, checked by the service (qualification_invalid, staffing_share_invalid).
  qualification: z.string().max(20).nullable().optional(),
  staffingShare: z.number().nullable().optional(),
  // Personnel file blocks: left out = unchanged; the service checks the keys (403) and the formats (400 with the code).
  personal: z.object({
    birthYear: z.number().nullable(), street: z.string().max(200).nullable(), postalCode: z.string().max(20).nullable(),
    city: z.string().max(100).nullable(), phone: z.string().max(50).nullable(), email: z.string().max(200).nullable(),
  }).optional(),
  sensitive: z.object({
    nationality: z.string().max(100).nullable(), disability: z.boolean(), disabilityDegree: z.number().nullable(),
    disabilityEqual: z.boolean(), disabilityUntil: z.string().max(10).nullable(),
  }).optional(),
})
export const moveSchema = z.object({ direction: z.enum(['up', 'down']) })
/** Deleting a left employee: `confirm` in the body is the name typed by hand (anything else, or nothing, is 400 employee_delete_confirm_mismatch). */
export const employeeDeleteSchema = z.object({ confirm: z.string().max(200).catch('') }).catch({ confirm: '' })
export const hoursSchema = z.object({ weeklyMinutes, validFrom: isoDate, workdays: workdays.optional() })
/** „Stundenkonto ab“; the date itself is checked by setBalanceFrom, so the form shows its German message. */
export const balanceFromSchema = z.object({ balanceFrom: z.string().max(10).nullable() })
export const adjustmentSchema = z.object({
  date: isoDate, minutes: z.number().int().min(-200_000).max(200_000), reason: z.string().max(200),
  /** „ausgezahlt“ (default no): kept for the longer retention period after the employee left. */
  paidOut: z.boolean().optional(),
})
export const adjustmentParams = z.object({
  id: z.coerce.number().int().positive(), adjustmentId: z.coerce.number().int().positive(),
})
/** Only the „ausgezahlt“ mark of a booked adjustment changes. */
export const adjustmentPaidOutSchema = z.object({ paidOut: z.boolean() })
export const entitlementSchema = z.object({ days: z.number().min(0).max(100), carriedOverDays: z.number().min(0).max(100) })

export const closureSchema = z.object({ startDate: isoDate, endDate: isoDate, label, mode: z.enum(['vacation', 'closure_day']) })

export const templateSchema = z.object({
  shortLabel: z.string().max(10), label, start: minutes, end: minutes,
  breakStart: minutes.nullable(), breakEnd: minutes.nullable(), countsAsStaff: z.boolean(),
  pairsWithPrepTime: z.boolean(), homeOffice: z.boolean().optional(), sortOrder: z.number().int().optional(),
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
  role: z.enum(['provider', 'admin', 'group_lead', 'observer', 'terminal']), employeeId: z.number().int().nullable(),
})
export const userUpdateSchema = z.object({
  role: z.enum(['provider', 'admin', 'group_lead', 'observer', 'terminal']), employeeId: z.number().int().nullable(), active: z.boolean(),
  // Gone: „darf Kinderakten pflegen“ is an exception of the rights API now; a stale client sending it gets 400 use_rights_api.
  canEditChildren: z.unknown().optional(),
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
/** A whole template from its editor; the weekday (0 = Monday … 4 = Friday) is checked by the service (invalid_weekday). */
export const weekTemplateInputSchema = z.object({
  name: label,
  groupId: groupIdSchema,
  entries: z.array(entryInputSchema.omit({ groupId: true }).extend({
    employeeId: z.number().int(), weekday: z.number().int(), countsAsStaff: z.boolean().optional(),
  })).max(2000),
})
/** Saving a changed service: applyFrom = also give existing shifts from that day on the new times (null = only new entries). */
export const templateChangeSchema = templateSchema.extend({ applyFrom: isoDate.nullable().optional() })
export const contractSchema = z.object({
  personnelNumber: z.string().max(30).nullable(),
  employedSince: isoDate.nullable(), jobKey: z.enum(JOB_KEYS).nullable(), jobOther: z.string().max(100).nullable(),
  payGroup: z.enum(PAY_GROUPS).nullable(), payLevel: z.number().int().min(1).max(6).nullable(),
  /** „befristet bis“; left out = unchanged. */
  fixedTermUntil: isoDate.nullable().optional(),
  /** „Ausbildung/Studium hier bis“; left out = unchanged, checked by the service (training_until_invalid). */
  trainingUntil: z.string().max(10).nullable().optional(),
  /** „Anerkennungsjahr zählt als Stufe 1“; left out = unchanged. */
  recognitionYearCounts: z.boolean().optional(),
})
/** Lohn und Steuer; the formats are the service's (400 iban_invalid, tax_id_invalid, sv_number_invalid, tax_class_invalid). */
export const payrollSchema = z.object({
  taxId: z.string().max(30).nullable(), taxClass: z.number().nullable(), svNumber: z.string().max(30).nullable(),
  healthInsurer: z.string().max(100).nullable(), iban: z.string().max(50).nullable(), accountHolder: z.string().max(100).nullable(),
  denomination: z.string().max(50).nullable(),
})
/** The section „Kinder“ saved at once; the birth dates are checked by the service (child_birth_date_invalid). */
export const employeeChildrenSchema = z.object({
  singleParent: z.boolean(),
  children: z.array(z.object({
    id: z.number().int().positive().nullable().optional(),
    firstName: z.string().max(100).nullable(),
    birthDate: z.string().max(10),
    disabledDependent: z.boolean(),
  })).max(50),
})
/** Kinderkrankentage; the ranges are the service's (400 child_sick_settings_invalid). */
const settingsDays = z.union([z.number(), z.string().max(10)])
export const childSickSettingsSchema = z.object({
  // An emptied field comes as '' and is refused by the service with its own message (not as a generic 400).
  perChild: settingsDays, maxPerYear: settingsDays, singleParentPerChild: settingsDays, singleParentMax: settingsDays,
})

/** A Mutterschutz case (MuSchG); the order of the days and the note's length again in the service. */
export const maternityCaseSchema = z.object({
  notifiedOn: isoDate, expectedBirth: isoDate, actualBirth: isoDate.nullable(), extendedAfter: z.boolean(),
  breastfeedingUntil: isoDate.nullable(), authorityNotifiedOn: isoDate.nullable(), riskAssessmentOn: isoDate.nullable(),
  employmentBan: z.enum(EMPLOYMENT_BAN_KINDS), banFrom: isoDate.nullable(), banTo: isoDate.nullable(),
  banNote: z.string().max(MATERNITY_NOTE_MAX + 100), endedOn: isoDate.nullable(),
})
/** „Schutzfristen eintragen“ / „Beschäftigungsverbot eintragen“; `overwrite` replaces planned duties. */
export const maternityBookingSchema = z.object({ kind: z.enum(['protection', 'ban']), overwrite: z.boolean() })

/** The rights page: bundle ids and scopes stay strings here; the rights service answers 400 with a code for bad ones. */
export const rightsRoleParams = z.object({ role: z.string().max(40) })
export const roleRightsSchema = z.object({
  bundles: z.array(z.object({ id: z.string().max(60), enabled: z.boolean(), scope: z.string().max(20).nullable().optional() })).max(100),
})
export const userRightsSchema = z.object({
  overrides: z.array(z.object({
    bundle: z.string().max(60), effect: z.string().max(20), scope: z.string().max(20).nullable().optional(),
  })).max(100),
})
export const stampingSchema = z.object({ stampVia: z.enum(STAMP_CHANNELS), breakMode: z.enum(BREAK_MODES) })
export const notificationsReadSchema = z.object({ ids: z.array(z.number().int().positive()).max(500) })
export const leaveModuleSchema = z.object({ enabled: z.boolean(), plannerIds: z.array(z.number().int().positive()).max(50) })
export const leaveMaxSchema = z.object({ value: z.number().int().min(1).max(100).nullable() })
export const leaveCountingSchema = z.object({ christmasEveHalfLeave: z.boolean() })
// The notice on remaining leave: the date is checked by the service (invalid_forfeit_date), so the answer is in German.
export const leaveForfeitSettingsSchema = z.object({
  day: z.number().int().min(1).max(31), month: z.number().int().min(1).max(12), text: z.string().max(LEAVE_FORFEIT_TEXT_MAX),
})
export const leaveForfeitReadSchema = z.object({ year: z.number().int().min(2000).max(2100) })
const leaveRequestKind = z.enum(['vacation', 'overtime_off']).default('vacation')
export const leaveRangeQuery = z.object({ from: isoDate, to: isoDate, kind: leaveRequestKind })
export const leaveRequestSchema = z.object({ from: isoDate, to: isoDate, note: z.string().max(300), kind: leaveRequestKind })
export const leaveDecisionSchema = z.object({ approve: z.boolean(), note: z.string().max(300), overwrite: z.boolean() })
const leaveEntryKind = z.enum(['vacation', 'special_leave', 'overtime_off'])
/** „Urlaub eintragen“ for an employee; `overwrite` replaces duties on the days (asked first). */
export const leaveEntrySchema = z.object({
  from: isoDate, to: isoDate, kind: leaveEntryKind, overwrite: z.boolean().default(false),
  // Sonderurlaub: the reason, checked by the service like in the plan.
  specialLeaveReason: z.string().max(40).nullable().optional(),
  specialLeaveText: z.string().max(1000).nullable().optional(),
})
/** „Entfernen“ of a listed leave period. */
export const leaveEntryRemovalQuery = z.object({ from: isoDate, to: isoDate, kind: leaveEntryKind })
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
/** An item of the Träger's retention overview by its key; the service checks the format (400 retention_key_invalid). */
export const retentionItemSchema = z.object({ key: z.string().max(100) })
/** „Alle fälligen löschen“: the keys shown on the page, at most 1000. */
export const retentionDueSchema = z.object({ keys: z.array(z.string().max(100)).max(1000) })
/**
 * The Träger's staffing overrides, path → number; the service checks the paths and the values (staffing_override_invalid)
 * and whether the rules stay usable (staffing_rules_invalid).
 */
export const staffingOverridesSchema = z.object({ overrides: z.record(z.string().max(200), z.unknown()) })
/** „Auf Vorgabe zurücksetzen“: without `path` every override goes, with it only that one. */
export const staffingResetQuery = z.object({ path: z.string().max(200).optional() })
/**
 * The live estimate while a group is created or edited: the group type ('' or left out = none; an unknown key gives the
 * reason unknown_group_type), the places (left out = none) and the group being edited (left out = a new group).
 */
export const staffingEstimatePreviewQuery = z.object({
  groupType: z.string().max(40).optional().transform(value => (value ? value : null)),
  capacity: z.coerce.number().int().min(1).max(200).optional().transform(value => value ?? null),
  groupId: z.coerce.number().int().positive().optional().transform(value => value ?? null),
})
/** A key of the state's group types (null = none); the service answers staffing_group_type_invalid for any other. */
export const groupTypeSchema = z.object({ groupType: z.string().max(40).nullable() })
export const helpOutSchema = z.object({
  employeeId: z.number().int().positive(),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
})
export const groupNameSchema = z.object({ name: z.string().max(80) })
/** The range (whole number 1-200 or null) is checked by the service, which answers invalid_capacity. */
export const groupCapacitySchema = z.object({ capacity: z.number().nullable() })
/**
 * A group's age limits as a whole list; the ranges, duplicates and the number of rules (at most 20) are checked by the
 * service, which answers the German codes (so no length limit here, which would answer a non-German error).
 */
export const groupAgeLimitsSchema = z.object({
  rules: z.array(z.object({ fromYears: z.number(), toYears: z.number(), maxChildren: z.number() })),
})
/** The range (whole number 1-999 or null) is checked by the service, which answers invalid_facility_capacity. */
export const facilityCapacitySchema = z.object({ capacity: z.number().nullable() })
/** The facility's contact data; the formats and lengths are checked by the service, which answers the German codes. */
export const facilityContactSchema = z.object({
  street: z.string(), postalCode: z.string(), city: z.string(), website: z.string(), operator: z.string(), manager: z.string(),
  contacts: z.array(z.object({ kind: z.string(), value: z.string(), belongsTo: z.string(), label: z.string().optional() })),
})
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
/**
 * The tablet settings of a facility. The lock time and the windows without the automatic lock are checked by the service
 * (tablet_lock_minutes_invalid, tablet_windows_too_many …); windows left out stay as they are.
 */
export const tabletSettingsSchema = z.object({
  lockMinutes: z.number(), showWaitlist: z.boolean(), showFutureContracts: z.boolean(),
  noLockWindows: z.array(z.object({ start: z.number(), end: z.number() })).max(50).optional(),
})
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
export const emergencyContactSchema = z.object({
  name: z.string().max(100),
  relation: z.string().max(100),
  phone: z.string().max(50),
  phone2: z.string().max(50),
  note: z.string().max(500),
})
export const emergencyConsentSchema = z.object({ consent: z.boolean(), date: isoDate.optional() })
export const myEmergencyConsentSchema = z.object({ consent: z.boolean() })

export const careTypeSchema = z.object({
  name: z.string().max(80),
  start: z.number().int(),
  end: z.number().int(),
  // Ignored (care types are listed by start, end and name); old clients may still send it.
  sortOrder: z.number().int().min(0).max(10000).optional(),
  // 1–7, checked by the service (care_type_invalid_days); left out = 5 for a new care type, unchanged on update.
  daysPerWeek: z.number().optional(),
})
export const documentTypeSchema = z.object({
  name: z.string().max(80),
  important: z.boolean(),
  required: z.boolean(),
  confidentialDefault: z.boolean(),
  // Ignored (document types are listed alphabetically); old clients may still send it.
  sortOrder: z.number().int().min(0).max(10000).optional(),
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
/** An attachment of an accident report: only the file (its name is kept as shown), no further fields. */
export const attachmentFields = z.object({})
// Personnel file documents: the form fields of the upload (multipart, all text) and the change of folder and details alike.
export const employeeDocumentSchema = z.object({
  folder: z.enum(EMPLOYEE_DOCUMENT_FOLDERS),
  title: z.string().max(200),
  documentDate: isoDate,
  note: z.string().max(1000).default(''),
})
// Print templates: the change of title and category, and the form fields of the upload (multipart, so all text).
export const printTemplateSchema = z.object({ title: z.string().max(200), categoryId: z.number().int().positive() })
export const printTemplateFields = z.object({
  title: z.string().max(200),
  categoryId: z.coerce.number().int().positive(),
  scope: z.enum(['facility', 'all']).default('facility'),
})
// Their categories (the same for every facility).
export const templateCategorySchema = z.object({ name: z.string().max(60), visibility: z.enum(TEMPLATE_VISIBILITIES) })
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
/** A note in a child's record; the text's length and the educator are checked by the service, so a stale client gets its hint. */
export const childNoteSchema = z.object({
  date: isoDate,
  text: z.string().max(10_000),
  educatorEmployeeId: z.union([z.number().int().positive(), z.literal('keep')]).nullable(),
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
export const groupMergeSchema = z.object({ date: isoDate, groupIds: z.array(z.number().int().positive()).max(50) })
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
/** § 34 IfSG: a new case. The disease, its kind and the date rule are checked against the facility's rules by the service. */
export const ifsgCaseSchema = z.object({
  childId: z.number().int().positive(), date: isoDate, disease: z.string().min(1).max(60),
  kind: z.enum(['sick', 'carrier', 'household']), onsetDate: isoDate, ruleVariant: z.string().max(60).nullable(),
  ruleDate: isoDate.nullable(),
})
/** § 34 IfSG: a change of a case (left out = kept). */
export const ifsgCaseUpdateSchema = z.object({
  onsetDate: isoDate.optional(), ruleVariant: z.string().max(60).nullable().optional(), ruleDate: isoDate.nullable().optional(),
  healthOfficeNotifiedOn: isoDate.nullable().optional(), physicianReported: z.boolean().optional(), ended: z.boolean().optional(),
})
/** § 34 IfSG: the readmission's form fields (multipart, as text). */
export const ifsgReadmitFields = z.object({
  readmittedOn: isoDate, note: z.string().max(1000).default(''),
  confirmEarly: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
})
/** § 34 IfSG: the facility's setting and its health office. */
export const ifsgSettingsSchema = z.object({
  requireAttest: z.boolean(), healthOfficeName: z.string().max(200).default(''), healthOfficePhone: z.string().max(100).default(''),
})
/** § 34 IfSG: a local rule of the health office (null or left out = the RKI value); proof and rules checked by the service too. */
export const ifsgLocalRuleSchema = z.object({
  name: z.string().max(200).nullish(), notifiable: z.boolean().nullish(), text: z.string().max(2000).nullish(),
  rules: z.array(z.object({
    anchor: z.enum(['onset', 'rash', 'antibiotic', 'symptom_end', 'jaundice', 'gland_swelling', 'treatment', 'last_contact', 'prophylaxis']),
    days: z.number().int().min(0).max(365), label: z.string().max(100).default(''), condition: z.string().max(200).optional(),
  })).max(3).nullish(),
  proof: z.enum(['none', 'parent_declaration', 'medical_certificate', 'health_office']).nullish(), notify: z.boolean().nullish(),
  householdText: z.string().max(2000).nullish(), householdExclusion: z.boolean().nullish(), note: z.string().max(2000).nullish(),
  hint: z.string().max(1000).nullish(),
})
/** § 34 IfSG: the key of a disease of the rules (RKI or local). */
export const ifsgKeyParams = z.object({ key: z.string().regex(/^[a-z0-9_]{1,60}$/) })
/** § 34 IfSG: apply a preset; existing local rows only with `overwrite`. */
export const ifsgPresetSchema = z.object({ preset: z.enum(['rki', 'rnk_2024']), overwrite: z.boolean().default(false) })
/** § 34 IfSG: the health office was informed of a cluster of this disease on that day. */
export const ifsgClusterAckSchema = z.object({ disease: z.string().regex(/^[a-z0-9_]{1,60}$/), acknowledgedOn: isoDate })
/** § 34 IfSG: the form field of a health office document upload. */
export const ifsgDocumentFields = z.object({ title: z.string().max(200).default('') })
/** The sort order of the child lists of a facility. */
export const childSortSchema = z.object({ sort: z.enum(CHILD_SORTS) })
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
/** „Endgültig löschen“ of an archived box: `confirm` is the box name typed by hand (anything else, or nothing, is 400 cash_box_confirm_mismatch). */
export const cashBoxPurgeSchema = z.object({ confirm: z.string().max(200).catch('') }).catch({ confirm: '' })
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
const formKind = z.enum(['staff', 'child', 'team', 'accident'])
export const formTemplateQuery = z.object({ kind: formKind.optional() })
/** `subject` is required for an accident template; the service checks it (form_subject_invalid). */
export const formTemplateSchema = z.object({
  kind: formKind, name: z.string().max(200), selfAssessment: z.boolean().default(false), subject: z.string().max(20).nullish(),
})
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
/** The header of an accident report; the service checks it (date valid and not in the future, start 0–1439 …). */
const accidentHeaderSchema = z.object({
  date: z.string().max(20),
  start: z.number().int().nullable(),
  doctor: z.boolean(),
  unfit: z.boolean(),
  reportedOn: z.string().max(20).nullable(),
})
/** A new accident report from a template of the person's subject. */
export const accidentCreateSchema = accidentHeaderSchema.extend({ templateId: z.number().int() })
/** Saving an accident report: header and all answers, with the form's updatedAt the client loaded. */
export const accidentSaveSchema = accidentHeaderSchema.extend({ answers: z.unknown(), expectedUpdatedAt: z.string().max(40) })
/** Saving a child form: header and all answers, with the form's updatedAt the client loaded. */
export const childFormSaveSchema = childFormHeaderSchema.extend({
  answers: z.unknown(),
  expectedUpdatedAt: z.string().max(40),
})
/**
 * The header of a team meeting; the limits (date, start 0–1439, text lengths, the group, the chosen participants) are
 * checked by the service.
 */
const teamMeetingHeaderSchema = z.object({
  date: z.string().max(20),
  start: z.number().int().nullable(),
  groupId: z.number().int().nullable(),
  participants: z.string().max(2000),
  recorder: z.string().max(1000),
  participantIds: z.array(z.number().int()).max(200),
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
/**
 * A note of the facility; text (1–1000 after trimming), „gilt bis“, the group and whether the writer may choose the
 * visibility „Sichtbar für“ are checked by the service. No default for the visibility: absent, a new note is for all
 * and a change keeps the stored level (a page from before the field must not widen a restricted note).
 */
export const noteInputSchema = z.object({
  groupId: z.number().int().nullable(),
  validUntil: z.string().max(20).nullable(),
  text: z.string().max(5000),
  visibility: z.enum(TEMPLATE_VISIBILITIES).optional(),
})
/**
 * The notes page: `group` (absent or empty = all, `facility` = only the whole facility, else a group id; that group's
 * notes and the facility's), `q` the search (trimmed, at most 100 chars; empty = no search).
 */
export const notesQuery = z.object({
  group: z.preprocess(
    value => (value === undefined || value === '' ? 'all' : value),
    z.union([z.enum(['all', 'facility']), z.coerce.number().int().positive()]),
  ),
  q: z.string().trim().max(100).default(''),
})
/** „Wieder öffnen“: the reason (1–200 chars) is checked by the service (team_meeting_reason_invalid). */
export const teamMeetingReopenSchema = z.object({ reason: z.string().max(1000) })
/** „Unterzeichnen“: at the tablet the person and their PIN (checked by the service); an account sends nothing. */
export const teamMeetingSignSchema = z.object({ employeeId: z.number().int().optional(), pin: z.string().max(20).optional() })
/** „Mitarbeiter freischalten“: the employees unlocked for the form from now on (all others are revoked). */
export const childFormEditorsSchema = z.object({ employeeIds: z.array(z.number().int()).max(500) })

// BEM (§ 167 Abs. 2 SGB IX): the lengths again in the service (trimmed), the order of the days there as well.
export const bemSentSchema = z.object({ invitedOn: isoDate })
export const bemAnswerSchema = z.object({ answer: z.enum(BEM_ANSWERS), date: isoDate })
export const bemCompleteSchema = z.object({ date: isoDate })
export const bemStepSchema = z.object({
  date: isoDate, participants: z.string().max(BEM_LIMITS.participants + 100), text: z.string().max(BEM_LIMITS.text + 100),
  status: z.enum(BEM_MEASURE_STATUSES).nullable(),
})
export const bemStepCreateSchema = bemStepSchema.extend({ kind: z.enum(BEM_STEP_KINDS) })
export const bemSettingsSchema = z.object({ text: z.string().max(BEM_LIMITS.invitationText + 100) })
