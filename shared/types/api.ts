import type { HolidayKey } from '../domain/holidays'
import type { LeaveAccount, LeaveRange } from '../domain/leave'
import type { CodeKey, CreditMode, DomainEntry, EntryKind, IsoDate, Minutes } from '../domain/types'
import type { Warning } from '../domain/warnings'

export const COLOR_KEYS = ['neutral', 'gray', 'green', 'yellow', 'blue', 'red', 'violet', 'orange'] as const
export type ColorKey = typeof COLOR_KEYS[number]

export type Role = 'admin' | 'observer' | 'terminal'
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
}

export interface EntryDto extends DomainEntry {
  id: number
  templateId: number | null
  codeId: number | null
  note: string | null
  label: string
  shortLabel: string | null
  color: ColorKey
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
}

export interface SnapshotDayDto {
  date: IsoDate
  info1: string
  info2: string
  closureLabel: string | null
}

/** What observers see of a month, frozen at release time. */
export interface SnapshotData {
  employees: EmployeeColumnDto[]
  entries: EntryDto[]
  days: SnapshotDayDto[]
}

export interface WeekSummaryDto {
  weekStart: IsoDate
  weekEnd: IsoDate
  weekNumber: number
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

export interface MonthPlanAdminDto {
  warnings: Warning[]
  weeks: WeekSummaryDto[]
  balances: BalanceDto[]
  /** Draft changes not yet released, keyed by cellKey / noteKey. */
  pendingChanges: Record<string, PendingChangeDto>
}

export interface MonthPlanDto {
  year: number
  month: number
  release: ReleaseDto
  days: DayRowDto[]
  employees: EmployeeColumnDto[]
  entries: EntryDto[]
  /** Keyed by cellKey(employeeId, date) or noteKey(field, date). */
  changes: Record<string, ChangeDto[]>
  templates: TemplateDto[]
  codes: CodeDto[]
  admin: MonthPlanAdminDto | null
}

export interface MyPlanDayDto extends DayRowDto {
  entries: EntryDto[]
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
  ranges: LeaveRange[]
}

export interface EmployeeListItemDto {
  id: number
  name: string
  shortName: string
  sortOrder: number
  leftOn: IsoDate | null
  currentWeeklyMinutes: number | null
}

export interface EmployeeDetailDto extends EmployeeListItemDto {
  hours: { id: number; weeklyMinutes: number; validFrom: IsoDate }[]
  adjustments: { id: number; date: IsoDate; minutes: number; reason: string }[]
  entitlements: { id: number; year: number; days: number; carriedOverDays: number }[]
}

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
