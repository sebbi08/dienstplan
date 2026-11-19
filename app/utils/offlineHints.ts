import type { OfflineStampHintDto } from '#shared/types/api'
import { de } from '../locales/de'
import { formatDate } from './format'

const pad = (value: number) => String(value).padStart(2, '0')

/**
 * A line of the review list of offline stamps around the person's name: „Offline-Stempel mit falscher PIN – bitte
 * prüfen: “ ‹Name› „, 19.11.2026 07:58“ (the reminders box links the name; the time page writes it out).
 */
export function offlineHintParts(hint: Pick<OfflineStampHintDto, 'reason' | 'date' | 'minutes'>): { before: string; after: string } {
  const reason = de.time.offlineReasons[hint.reason] ?? de.time.offlineReasonOther
  const time = `${pad(Math.floor(hint.minutes / 60))}:${pad(hint.minutes % 60)}`
  return { before: `${reason}${de.time.offlineCheck}`, after: `, ${formatDate(hint.date)} ${time}` }
}

export function offlineHintText(hint: Pick<OfflineStampHintDto, 'reason' | 'date' | 'minutes' | 'name'>): string {
  const parts = offlineHintParts(hint)
  return `${parts.before}${hint.name}${parts.after}`
}
