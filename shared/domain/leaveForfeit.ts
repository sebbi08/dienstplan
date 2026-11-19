import { daysInMonth, toIsoDate } from './dates'
import type { IsoDate } from './types'

/**
 * The notice on remaining leave with its forfeiture date (BUrlG §7(3), BAG 19.02.2019 – 9 AZR 423/16: the employer has
 * to tell each employee in good time how much leave is left and that it lapses when not taken). Per facility: the day
 * the carried-over leave lapses in the following year and the text of the notice.
 */

/**
 * The text when the facility has not set its own (the server cannot read app/locales/de.ts, so it lives here).
 * Placeholders: ‹Tage› (the days left), ‹Jahr› (the year they come from), ‹Verfall› (the forfeiture date in the year
 * after, e.g. 31.03.2027).
 */
export const DEFAULT_LEAVE_FORFEIT_TEXT = 'Du hast noch ‹Tage› Tage Urlaub aus ‹Jahr›. Bitte plane sie rechtzeitig ein. '
  + 'Urlaub, der bis zum ‹Verfall› nicht genommen ist, verfällt.'
export const DEFAULT_LEAVE_FORFEIT_DAY = 31
export const DEFAULT_LEAVE_FORFEIT_MONTH = 3
/** The notice starts on 1 October; the forfeiture date lies in January to September so the windows never overlap. */
export const LEAVE_FORFEIT_NOTICE_MONTH = 10
export const LEAVE_FORFEIT_TEXT_MAX = 1000

export interface LeaveForfeitDate { day: number; month: number }

/** A day of January to September (29 February never: it does not exist every year). */
export function isValidForfeitDate({ day, month }: LeaveForfeitDate): boolean {
  if (!Number.isInteger(day) || !Number.isInteger(month) || month < 1 || month >= LEAVE_FORFEIT_NOTICE_MONTH) return false
  // 2027 is no leap year: February has 28 days.
  return day >= 1 && day <= daysInMonth(2027, month)
}

/**
 * A text of the facility's own has to name the days and the forfeiture date (‹Tage› and ‹Verfall›): the receipt has to
 * prove a concrete notice. Empty means the default text.
 */
export function isValidForfeitText(text: string): boolean {
  const trimmed = text.trim()
  return trimmed === '' || (trimmed.includes('‹Tage›') && trimmed.includes('‹Verfall›'))
}

/** The day the leave of `year` lapses: the forfeiture day in the year after. */
export function forfeitDateOf(year: number, setting: LeaveForfeitDate): IsoDate {
  return toIsoDate(year + 1, setting.month, setting.day)
}

/**
 * The year whose remaining leave the notice is about on `today` (the Berlin date): from 1 October of a year until its
 * forfeiture date in the year after (inclusive); null outside.
 */
export function leaveForfeitNoticeYear(today: IsoDate, setting: LeaveForfeitDate): number | null {
  const year = Number(today.slice(0, 4))
  if (Number(today.slice(5, 7)) >= LEAVE_FORFEIT_NOTICE_MONTH) return year
  return today <= forfeitDateOf(year - 1, setting) ? year - 1 : null
}

/** dd.mm.yyyy */
function germanDate(iso: IsoDate): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
}

/**
 * The notice text with its placeholders filled: ‹Tage› as a German number (2,5), ‹Jahr›, ‹Verfall› as dd.mm.yyyy.
 * „‹Tage› Tage“ for a single day reads „1 Tag“.
 */
export function fillLeaveForfeitText(template: string, values: { days: number; year: number; forfeitDate: IsoDate }): string {
  const days = values.days.toLocaleString('de-DE')
  return template
    .replaceAll('‹Tage› Tage', values.days === 1 ? '1 Tag' : `${days} Tage`)
    .replaceAll('‹Tage›', days)
    .replaceAll('‹Jahr›', String(values.year))
    .replaceAll('‹Verfall›', germanDate(values.forfeitDate))
}
