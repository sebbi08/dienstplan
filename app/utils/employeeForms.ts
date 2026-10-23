import type { Qualification } from '#shared/domain/staffing/types'
import type { EmployeeDetailDto } from '#shared/types/api'

/** The select's value for "qualification not entered" ('none' is a qualification of its own). */
export const NO_QUALIFICATION = 'unset'

/**
 * The fields of the tab „Stammdaten“. groupId 0 = Springer (the select needs a non-null value); birthdayDay /
 * birthdayMonth 0 = no birthday.
 */
export interface MasterFields {
  name: string
  shortName: string
  leftOn: string
  groupId: number
  birthdayDay: number
  birthdayMonth: number
}

/** The fields of the tab „Qualifikation“; an empty share means the state's default. */
export interface QualificationFields {
  qualification: Qualification | typeof NO_QUALIFICATION
  staffingShare: string
}

type Saved = Pick<EmployeeDetailDto, 'name' | 'shortName' | 'leftOn' | 'groupId' | 'birthday' | 'qualification' | 'staffingShare'>

export function masterFieldsOf(saved: Saved): MasterFields {
  const [month = 0, day = 0] = saved.birthday ? saved.birthday.split('-').map(Number) : []
  return {
    name: saved.name, shortName: saved.shortName, leftOn: saved.leftOn ?? '', groupId: saved.groupId ?? 0,
    birthdayDay: day, birthdayMonth: month,
  }
}

export function qualificationFieldsOf(saved: Saved): QualificationFields {
  return { qualification: saved.qualification ?? NO_QUALIFICATION, staffingShare: saved.staffingShare === null ? '' : String(saved.staffingShare) }
}

/** MM-DD, null without a birthday, undefined when only the day or only the month is chosen. */
export function birthdayValue(fields: Pick<MasterFields, 'birthdayDay' | 'birthdayMonth'>): string | null | undefined {
  const { birthdayDay: day, birthdayMonth: month } = fields
  if (!day && !month) return null
  if (!day || !month) return undefined
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** null = empty field (the state's default), undefined = not a whole number from 0 to 100. */
export function shareValue(text: string): number | null | undefined {
  const trimmed = String(text).trim()
  if (!trimmed) return null
  const value = Number(trimmed)
  return Number.isInteger(value) && value >= 0 && value <= 100 ? value : undefined
}

export const qualificationValue = (fields: QualificationFields): Qualification | null =>
  (fields.qualification === NO_QUALIFICATION ? null : fields.qualification)

/** The body of PUT /api/employees/:id; left-out optional fields stay as they are. */
export interface EmployeeUpdateBody {
  name: string
  shortName: string
  leftOn: string | null
  groupId?: number | null
  birthday?: string | null
  qualification?: Qualification | null
  staffingShare?: number | null
}

type Update = { body: EmployeeUpdateBody } | { error: 'employee_birthday_invalid' | 'staffing_share_invalid' }

/**
 * Saving „Stammdaten“: only that tab's fields; the qualification and share are left out, so whatever is typed (and not
 * saved) in the tab „Qualifikation“ is never sent. The group only when the facility has groups.
 */
export function masterUpdate(fields: MasterFields, hasGroups: boolean): Update {
  const birthday = birthdayValue(fields)
  if (birthday === undefined) return { error: 'employee_birthday_invalid' }
  return {
    body: {
      name: fields.name, shortName: fields.shortName, leftOn: fields.leftOn || null, birthday,
      ...(hasGroups ? { groupId: fields.groupId || null } : {}),
    },
  }
}

/**
 * Saving „Qualifikation“: the qualification and share from the tab; name, Kürzel and „ausgeschieden am“ (which the route
 * needs) as saved, group and birthday left out – unsaved edits in „Stammdaten“ are never sent.
 */
export function qualificationUpdate(saved: Saved, fields: QualificationFields): Update {
  const staffingShare = shareValue(fields.staffingShare)
  if (staffingShare === undefined) return { error: 'staffing_share_invalid' }
  return {
    body: { name: saved.name, shortName: saved.shortName, leftOn: saved.leftOn, qualification: qualificationValue(fields), staffingShare },
  }
}

/** Same values, numbers and their text alike (a number input may hand back 40 for '40'). */
const asText = (_key: string, value: unknown) => (typeof value === 'number' ? String(value) : value)
const same = (a: object, b: object) => JSON.stringify(a, asText) === JSON.stringify(b, asText)

/**
 * A tab's form after the employee was (re)loaded: the loaded values when the form still shows what was loaded before
 * (nothing typed), on the first load, or right after that tab was saved (`force`); otherwise the unsaved edits stay.
 */
export function reloadedFields<T extends object>(current: T, loadedBefore: T | null, loadedNow: T, force: boolean): T {
  return force || loadedBefore === null || same(current, loadedBefore) ? { ...loadedNow } : { ...current }
}
