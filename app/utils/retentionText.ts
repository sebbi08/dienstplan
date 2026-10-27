import { retentionDueDates, type RetentionSettings } from '#shared/domain/retention'
import type { IsoDate } from '#shared/domain/types'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

const CATEGORIES = ['immediate', 'time', 'assessment', 'paidOvertime'] as const

const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase('de-DE') + text.slice(1)

/** „A“, „A und B“, „A, B und C“. */
function listOf(labels: string[]): string {
  return labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} und ${labels.at(-1)}`
}

/**
 * The line in the staff page's archive for a person who left on `leftOn` (shared/domain/retention.ts): „Persönliche
 * Daten dürfen schon gelöscht werden (vom Träger unter Mehr → Löschfristen). Zeitdaten dürfen ab … gelöscht werden,
 * Beurteilungen ab …, ausgezahlte Überstunden ab …; danach der Eintrag.“ The dates in their order (the personal data
 * the day after leaving); a category due today or earlier may be deleted already and is named before (the Träger
 * deletes on the page „Löschfristen“, nothing goes by itself). Without paid-out adjustments (`hasPaidOut` false) that
 * period is left out: the entry goes with the others.
 */
export function archiveRetentionText(leftOn: IsoDate, settings: RetentionSettings, today: IsoDate, hasPaidOut = true): string {
  const t = de.retention.archive
  const due = retentionDueDates(leftOn, settings)
  const dated = CATEGORIES.filter(category => hasPaidOut || category !== 'paidOvertime')
    .map(category => ({ label: t.labels[category], date: due[category] }))
    .sort((a, b) => a.date.localeCompare(b.date))
  const done = dated.filter(entry => entry.date <= today)
  const open = dated.filter(entry => entry.date > today)
  if (open.length === 0) return t.allDone
  const [first, ...rest] = open
  const sentence = [t.first(first!.label, formatDate(first!.date)), ...rest.map(entry => t.next(entry.label, formatDate(entry.date)))]
    .join(', ') + t.last
  return done.length === 0 ? capitalize(sentence) : `${capitalize(t.done(listOf(done.map(entry => entry.label))))} ${capitalize(sentence)}`
}
