import { z } from 'zod'
import { isValidIsoDate } from '../shared/domain/dates'
import { COLOR_KEYS } from '../shared/types/api'

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
})
export const applyEntriesSchema = z.object({
  cells: z.array(z.object({ employeeId: z.number().int(), date: isoDate })).min(1).max(1000),
  mode: z.enum(['replace', 'add', 'clear']),
  entry: entryInputSchema.nullable(),
})
export const dayNoteSchema = z.object({ field: z.enum(['info1', 'info2']), value: z.string().max(200) })
export const revertSchema = z.object({ keys: z.array(z.string().max(40)).min(1).max(2000) })
export const entryTimesSchema = z.object({ start: minutes, end: minutes, breakStart: minutes.nullable(), breakEnd: minutes.nullable() })

const weeklyMinutes = z.number().int().min(0).max(80 * 60)
export const employeeCreateSchema = z.object({ name: label, shortName: z.string().max(10), weeklyMinutes, validFrom: isoDate })
export const employeeUpdateSchema = z.object({ name: label, shortName: z.string().max(10), leftOn: isoDate.nullable() })
export const moveSchema = z.object({ direction: z.enum(['up', 'down']) })
export const hoursSchema = z.object({ weeklyMinutes, validFrom: isoDate })
export const adjustmentSchema = z.object({ date: isoDate, minutes: z.number().int().min(-200_000).max(200_000), reason: z.string().max(200) })
export const entitlementSchema = z.object({ days: z.number().min(0).max(100), carriedOverDays: z.number().min(0).max(100) })

export const closureSchema = z.object({ startDate: isoDate, endDate: isoDate, label, mode: z.enum(['vacation', 'closure_day']) })

export const templateSchema = z.object({
  shortLabel: z.string().max(10), label, start: minutes, end: minutes,
  breakStart: minutes.nullable(), breakEnd: minutes.nullable(), countsAsStaff: z.boolean(),
  pairsWithPrepTime: z.boolean(), sortOrder: z.number().int(),
})
export const codeUpdateSchema = z.object({ label, color: z.enum(COLOR_KEYS), creditMode: z.enum(['daily_target', 'timed', 'none']) })
export const coverageRuleSchema = z.object({
  label, start: minutes, end: minutes.nullable(), minCount: z.number().int().min(1).max(20), active: z.boolean(),
})

export const userCreateSchema = z.object({
  username: z.string().max(50), password: z.string().max(200),
  role: z.enum(['admin', 'observer', 'terminal']), employeeId: z.number().int().nullable(),
})
export const userUpdateSchema = z.object({
  role: z.enum(['admin', 'observer', 'terminal']), employeeId: z.number().int().nullable(), active: z.boolean(),
})
export const passwordResetSchema = z.object({ password: z.string().max(200) })
export const appSettingsSchema = z.object({ timeTrackingFrom: isoDate.nullable() })

export const timeRecordCreateSchema = z.object({ employeeId: z.number().int(), date: isoDate, start: minutes, end: minutes })
export const timeRecordUpdateSchema = z.object({ start: minutes, end: minutes })
export const earlyClosureSchema = z.object({ date: isoDate, closedFrom: minutes, reason: z.string().max(200) })
export const calendarEventSchema = z.object({ date: isoDate, start: minutes.nullable(), end: minutes.nullable(), title: z.string().max(200) })
export const timeDayNoteSchema = z.object({ employeeId: z.number().int(), date: isoDate, note: z.string().max(200) })
export const stampSchema = z.object({ action: z.enum(['in', 'out']) })
export const timeMonthQuery = monthParams.extend({ employeeId: z.coerce.number().int().positive() })
