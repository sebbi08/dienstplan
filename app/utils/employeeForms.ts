import type { Qualification } from '#shared/domain/staffing/types'
import type { EmployeeDetailDto } from '#shared/types/api'
import { formatBirthday, parseBirthday } from './birthday'

/** The select's value for "qualification not entered" ('none' is a qualification of its own). */
export const NO_QUALIFICATION = 'unset'

/**
 * The fields of the tab „Stammdaten“. groupId 0 = Springer (the select needs a non-null value); birthday is the typed
 * text „TT.MM.“ or „TT.MM.JJJJ“ (empty = no birthday).
 */
export interface MasterFields {
  name: string
  shortName: string
  leftOn: string
  groupId: number
  birthday: string
}

/** The fields of the tab „Qualifikation“; an empty share means the state's default. */
export interface QualificationFields {
  qualification: Qualification | typeof NO_QUALIFICATION
  staffingShare: string
}

type Saved = Pick<EmployeeDetailDto, 'name' | 'shortName' | 'leftOn' | 'groupId' | 'birthday' | 'qualification' | 'staffingShare'>
  & { personal?: Pick<NonNullable<EmployeeDetailDto['personal']>, 'birthYear'> }

/** The birthday text shows the year when the viewer has the personal block (`personal` present). */
export function masterFieldsOf(saved: Saved): MasterFields {
  return {
    name: saved.name, shortName: saved.shortName, leftOn: saved.leftOn ?? '', groupId: saved.groupId ?? 0,
    birthday: formatBirthday(saved.birthday, saved.personal?.birthYear ?? null, saved.personal !== undefined),
  }
}

export function qualificationFieldsOf(saved: Saved): QualificationFields {
  return { qualification: saved.qualification ?? NO_QUALIFICATION, staffingShare: saved.staffingShare === null ? '' : String(saved.staffingShare) }
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
/** birthYear: the typed year (null = none), undefined where the viewer has no personal block. */
type MasterUpdate = { body: EmployeeUpdateBody, birthYear: number | null | undefined } | { error: 'employee_birthday_invalid' }

/**
 * Saving „Stammdaten“: only that tab's fields; the qualification and share are left out, so whatever is typed (and not
 * saved) in the tab „Qualifikation“ is never sent. The group only when the facility has groups.
 */
export function masterUpdate(
  fields: MasterFields, hasGroups: boolean, withYear: boolean, loadedBirthday: string, now: Date = new Date(),
): MasterUpdate {
  const base = {
    name: fields.name, shortName: fields.shortName, leftOn: fields.leftOn || null,
    ...(hasGroups ? { groupId: fields.groupId || null } : {}),
  }
  // The birthday field untouched: day, month and the stored year stay exactly as they are.
  if (fields.birthday === loadedBirthday) return { body: base, birthYear: undefined }
  const parsed = parseBirthday(fields.birthday, withYear, now.getFullYear())
  if (!parsed.ok) return { error: 'employee_birthday_invalid' }
  // A year stored without day and month (empty field) is kept; a year shown in the field and removed is cleared.
  const keepStoredYear = parsed.year === null && loadedBirthday.trim() === ''
  return { body: { ...base, birthday: parsed.birthday }, birthYear: withYear && !keepStoredYear ? parsed.year : undefined }
}

/**
 * The follow-up update that gives a just created employee the birth year (the create route has no personnel file
 * block): only the personal block, everything else of the master data as just created.
 */
export function birthYearOnlyUpdate(name: string, shortName: string, birthYear: number) {
  return {
    name, shortName, leftOn: null,
    personal: { birthYear, street: null, postalCode: null, city: null, phone: null, email: null },
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
