import { addDays } from './dates'
import type { IsoDate } from './types'

/**
 * Betriebliches Eingliederungsmanagement (§ 167 Abs. 2 SGB IX): an employee who was unable to work for more than six
 * weeks within twelve months is offered a BEM. Pure rules shared by the server (counting, reminder, invitation) and the
 * employee page.
 *
 * Since 30.07.2026 the law reads „länger als sechs Wochen ununterbrochen oder wiederholt arbeitsunfähig oder teilweise
 * arbeitsunfähig“ (Art. 2b of the law of 24.07.2026, BGBl. 2026 I Nr. 228). The partial incapacity (Teil-AU) itself only
 * exists from 01.01.2028; until then only „Krank“ is counted (countBemSickDays). A Teil-AU code must count then.
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
 * here). It gives what § 167 Abs. 2 SGB IX asks to point out before a BEM: aim, voluntariness, the kind and extent of the
 * data collected and used and who sees it, the Vertrauensperson of one's own choice, the possible participants (only
 * with consent). Placeholders: ‹Name› (the employee), ‹Antwort bis› (the letter's date plus 14 days), ‹Jahre› (the
 * retention period of the BEM records with its unit, „3 Jahre“ / „1 Jahr“).
 */
export const BEM_DEFAULT_INVITATION_TEXT = [
  'Guten Tag ‹Name›,',
  'Sie waren in den letzten zwölf Monaten länger als sechs Wochen ununterbrochen oder wiederholt arbeitsunfähig. In '
  + 'diesem Fall bieten wir Ihnen nach '
  + '§ 167 Abs. 2 SGB IX ein Betriebliches Eingliederungsmanagement (BEM) an.',
  'Im BEM klären wir gemeinsam mit Ihnen, wie die Arbeitsunfähigkeit möglichst überwunden werden kann, wie erneuter '
  + 'Arbeitsunfähigkeit vorgebeugt werden kann und wie Ihr Arbeitsplatz erhalten bleibt.',
  'Die Teilnahme ist freiwillig. Wenn Sie das Angebot ablehnen, hat das für Sie keine Nachteile. Ihre Zustimmung können '
  + 'Sie jederzeit widerrufen.',
  'Sie können zusätzlich eine Vertrauensperson Ihrer Wahl hinzuziehen (§ 167 Abs. 2 Satz 2 SGB IX). Auf Ihren Wunsch und '
  + 'nur mit Ihrer Zustimmung können weitere Stellen beteiligt werden: die Betriebsärztin oder der Betriebsarzt, die '
  + 'Personalvertretung und – bei Schwerbehinderung oder Gleichstellung – die Schwerbehindertenvertretung. Kommen '
  + 'Leistungen zur Teilhabe oder begleitende Hilfen im Arbeitsleben in Betracht, ziehen wir mit Ihrer Zustimmung die '
  + 'Rehabilitationsträger bzw. das Integrationsamt hinzu.',
  'Welche Daten: Im BEM erheben und verwenden wir nur, was dafür nötig ist – die Zahl Ihrer Fehltage, die Gesprächsnotizen '
  + 'und die vereinbarten Maßnahmen. Eine Diagnose müssen Sie nicht nennen. Angaben zu Ihrer Gesundheit und ihren '
  + 'Auswirkungen auf Ihre Arbeit halten wir nur fest, wenn Sie sie uns selbst mitteilen möchten.',
  'Wer die Daten sieht: Die BEM-Unterlagen sehen nur die Personen, die das BEM durchführen (die Leitung und der Träger), '
  + 'und nur mit Ihrer Zustimmung die Betriebsärztin oder der Betriebsarzt, die Personalvertretung und die '
  + 'Schwerbehindertenvertretung. Wir verwenden die Daten nur für das BEM. Die BEM-Unterlagen werden getrennt von der '
  + 'Personalakte aufbewahrt und ‹Jahre› nach Abschluss des BEM gelöscht.',
  'Bitte teilen Sie uns bis zum ‹Antwort bis› mit, ob Sie am BEM teilnehmen möchten. Sie können dafür den Abschnitt '
  + 'unten verwenden.',
].join('\n\n')

function germanDate(iso: IsoDate): string {
  const [year, month, day] = iso.split('-')
  return `${day}.${month}.${year}`
}

/**
 * The text with the placeholders filled in. ‹Jahre› becomes the period with its unit („3 Jahre“, „1 Jahr“); a text that
 * still writes the unit itself („‹Jahre› Jahre“, „nach ‹Jahre› Jahren“) gets the right form as well.
 */
export function fillBemInvitationText(template: string, values: { name: string; answerBy: IsoDate; years: number }): string {
  const one = values.years === 1
  return template
    .replaceAll('‹Name›', values.name)
    .replaceAll('‹Antwort bis›', germanDate(values.answerBy))
    .replaceAll('‹Jahre› Jahren', one ? '1 Jahr' : `${values.years} Jahren`)
    .replaceAll('‹Jahre› Jahre', one ? '1 Jahr' : `${values.years} Jahre`)
    .replaceAll('‹Jahre›', one ? '1 Jahr' : `${values.years} Jahre`)
}

/** A BEM still invited without „Verschickt am“ is reminded this many days after it was started. */
export const BEM_SEND_REMINDER_DAYS = 7
