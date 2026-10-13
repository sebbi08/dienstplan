import { z } from 'zod'
import { isValidIsoDate } from '../shared/domain/dates'
import { MAX_REQUIREMENT_INTERVAL_MONTHS } from '../shared/domain/requirements'
import { BREAK_MODES, STAMP_CHANNELS } from '../shared/domain/stamping'
import { JOB_KEYS, PAY_GROUPS } from '../shared/domain/tvoed'
import { COLOR_KEYS, CONSENT_KEYS, REVIEW_SECTIONS, type ConsentKey } from '../shared/types/api'

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
export const pinSchema = z.object({ pin: z.string().regex(/^\d{4}$/) })
export const terminalStampSchema = z.object({ employeeId: z.number().int(), pin: z.string().max(10), action: z.enum(['in', 'out']) })
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
/** groupId left out keeps the employee's group. */
export const employeeUpdateSchema = z.object({
  name: label, shortName: z.string().max(10), leftOn: isoDate.nullable(), groupId: groupIdSchema.optional(),
})
export const moveSchema = z.object({ direction: z.enum(['up', 'down']) })
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
})

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
export const facilityNameSchema = z.object({ name: z.string().max(80) })
export const activeFacilitySchema = z.object({ facilityId: z.number().int().positive() })
export const employeeFacilitySchema = z.object({ facilityId: z.number().int().positive() })
export const childFacilitySchema = z.object({ facilityId: z.number().int().positive() })
export const childLeaveSchema = z.object({ leftOn: isoDate })
/** The range (whole years 1-10) is checked by the service, which answers invalid_retention. */
export const childRetentionSchema = z.object({ years: z.number() })
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
/** Whether the group is for school children (after-school care). */
export const groupSchoolChildrenSchema = z.object({ forSchoolChildren: z.boolean() })
/** The values are checked by the service, which answers invalid_school_cutoff. */
export const schoolSettingsSchema = z.object({ cutoffMonth: z.number(), cutoffDay: z.number(), ageYears: z.number() })
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
export const childMasterSchema = z.object({
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
export const childCreateSchema = childMasterSchema.extend({
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
