export type Minutes = number
export type IsoDate = string

/** 'break' = an additional break that is subtracted from the working time of its day. */
export type EntryKind = 'shift' | 'special' | 'code' | 'break'
export type CreditMode = 'daily_target' | 'timed' | 'none'
export type CodeKey =
  | 'vacation' | 'special_leave' | 'sick' | 'training' | 'school' | 'other'
  | 'prep_time' | 'office' | 'holiday' | 'closure_day'

/** Minimal entry shape used by all domain calculations. */
export interface DomainEntry {
  employeeId: number
  date: IsoDate
  kind: EntryKind
  codeKey: CodeKey | null
  /** 'timed' for shifts and special shifts; the code's mode for codes. */
  creditMode: CreditMode
  start: Minutes | null
  end: Minutes | null
  breakStart: Minutes | null
  breakEnd: Minutes | null
  countsAsStaff: boolean
}
