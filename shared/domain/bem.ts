import { addDays } from './dates'
import type { IsoDate } from './types'

/**
 * Betriebliches Eingliederungsmanagement (§ 167 Abs. 2 SGB IX): an employee who was unable to work for more than six
 * weeks within twelve months is offered a BEM. Pure rules shared by the server (counting, reminder, invitation) and the
 * employee page.
 */

export const BEM_STATUSES = ['invited', 'accepted', 'declined', 'no_answer', 'completed'] as const
export type BemStatus = typeof BEM_STATUSES[number]
/** What the employee answered (or that no answer came). */
export const BEM_ANSWERS = ['accepted', 'declined', 'no_answer'] as const
export type BemAnswer = typeof BEM_ANSWERS[number]
export const BEM_STEP_KINDS = ['meeting', 'measure', 'note'] as const
export type BemStepKind = typeof BEM_STEP_KINDS[number]
export const BEM_MEASURE_STATUSES = ['planned', 'done', 'dropped'] as const
export type BemMeasureStatus = typeof BEM_MEASURE_STATUSES[number]

/** The invitation asks for an answer within this many days of the letter's date. */
export const BEM_ANSWER_DAYS = 14
export const BEM_LIMITS = { participants: 300, text: 4000, invitationText: 6000 } as const
/** Six weeks of working days. */
const BEM_WEEKS = 6

/** A process that is still running: invited (no answer yet) or accepted. Declined, no answer and completed end it. */
export function isBemOpen(status: BemStatus): boolean {
  return status === 'invited' || status === 'accepted'
}

/** The day an ended process ended (its completion, decline or „keine Antwort“ day); null while it is open. */
export function bemEndDate(process: { status: BemStatus; completedOn: IsoDate | null }): IsoDate | null {
  return isBemOpen(process.status) ? null : process.completedOn
}

/** The day the invitation asks the answer by: the letter's date plus 14 days. */
export function bemAnswerBy(letterDate: IsoDate): IsoDate {
  return addDays(letterDate, BEM_ANSWER_DAYS)
}

/**
 * „Mehr als 6 Wochen“ as working days: 6 × the working days per week of the hours period valid today (5 → 30, 3 → 18),
 * half values rounded up (2,5 → 15). A BEM is due once the count is above it.
 */
export function bemLimit(workdaysPerWeek: number): number {
  return Math.ceil(BEM_WEEKS * workdaysPerWeek - 1e-9)
}

/**
 * The days counted: the last 12 months (today − 365 days + 1 up to today), but only after the last BEM that was
 * declined, went unanswered or was completed (`restartAfter`, its end day): counting starts afresh after it.
 */
export function bemWindow(today: IsoDate, restartAfter: IsoDate | null): { from: IsoDate; to: IsoDate } {
  const rolling = addDays(today, -364)
  const restart = restartAfter === null ? null : addDays(restartAfter, 1)
  return { from: restart !== null && restart > rolling ? restart : rolling, to: today }
}

/**
 * The sick working days in the window: the days of „Krank“ entries (each day once) that are working days of the
 * employee (`isWorkday`: employed, a contract day, no public holiday), as the sick days page counts them. „Kind krank“
 * is no incapacity of the employee and „im Dienst erkrankt“ no sick day: the caller passes only „Krank“ days.
 */
export function countBemSickDays(
  sickDates: readonly IsoDate[], isWorkday: (date: IsoDate) => boolean, window: { from: IsoDate; to: IsoDate },
): number {
  let count = 0
  for (const date of new Set(sickDates)) if (date >= window.from && date <= window.to && isWorkday(date)) count++
  return count
}

/** The line „Krankheitstage letzte 12 Monate“: amber from 80 % of the limit, red above it. */
export function bemSickLevel(days: number, limit: number): 'ok' | 'warn' | 'over' {
  if (days > limit) return 'over'
  return days >= limit * 0.8 ? 'warn' : 'ok'
}

/**
 * The invitation's text when the facility has not set its own (the server cannot read app/locales/de.ts, so it lives
 * here). Placeholders: ‹Name› (the employee), ‹Antwort bis› (the letter's date plus 14 days), ‹Jahre› (the retention
 * period of the BEM records in years).
 */
export const BEM_DEFAULT_INVITATION_TEXT = [
  'Guten Tag ‹Name›,',
  'Sie waren in den letzten zwölf Monaten länger als sechs Wochen arbeitsunfähig. In diesem Fall bieten wir Ihnen nach '
  + '§ 167 Abs. 2 SGB IX ein Betriebliches Eingliederungsmanagement (BEM) an.',
  'Im BEM klären wir gemeinsam mit Ihnen, wie die Arbeitsunfähigkeit möglichst überwunden werden kann, wie erneuter '
  + 'Arbeitsunfähigkeit vorgebeugt werden kann und wie Ihr Arbeitsplatz erhalten bleibt.',
  'Die Teilnahme ist freiwillig. Wenn Sie das Angebot ablehnen, hat das für Sie keine Nachteile. Ihre Zustimmung können '
  + 'Sie jederzeit widerrufen.',
  'Auf Ihren Wunsch und nur mit Ihrer Zustimmung können weitere Stellen beteiligt werden, zum Beispiel der Betriebsarzt, '
  + 'die Personalvertretung und – bei Schwerbehinderung oder Gleichstellung – die Schwerbehindertenvertretung.',
  'Datenschutz: Gesundheitsdaten, die wir im BEM erfahren, verwenden wir nur für das BEM. Die BEM-Unterlagen werden '
  + 'getrennt von der Personalakte aufbewahrt und ‹Jahre› Jahre nach Abschluss des BEM gelöscht.',
  'Bitte teilen Sie uns bis zum ‹Antwort bis› mit, ob Sie am BEM teilnehmen möchten. Sie können dafür den Abschnitt '
  + 'unten verwenden.',
].join('\n\n')

function germanDate(iso: IsoDate): string {
  const [year, month, day] = iso.split('-')
  return `${day}.${month}.${year}`
}

/** The text with the placeholders filled in. */
export function fillBemInvitationText(template: string, values: { name: string; answerBy: IsoDate; years: number }): string {
  return template
    .replaceAll('‹Name›', values.name)
    .replaceAll('‹Antwort bis›', germanDate(values.answerBy))
    .replaceAll('‹Jahre›', String(values.years))
}
