import type { WeekSummaryDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDateTime } from './format'

/** The day of an ISO time in Berlin without the year: „02.10.“. */
function dayMonthOf(timestamp: string): string {
  return `${new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit' }).format(new Date(timestamp))}`
}

/**
 * The small hint in a plan week row which week template filled the week: „Vorlage: Woche A (eingesetzt am 02.10.)“,
 * with „ – danach angepasst“ when the week's plan changed since; the title lists every use („Woche A – 02.10.2026
 * 10:05 von leitung“), the latest first. Null for a week without any.
 */
export function templateUseHint(week: Pick<WeekSummaryDto, 'templateUses' | 'templateChangedSince'>): { text: string; title: string } | null {
  const latest = week.templateUses[0]
  if (!latest) return null
  const t = de.weekTemplates
  return {
    text: t.used(latest.templateName, dayMonthOf(latest.appliedAt), week.templateChangedSince),
    title: week.templateUses.map(use => t.useLine(use.templateName, formatDateTime(use.appliedAt).replace(', ', ' '), use.appliedBy)).join('\n'),
  }
}
