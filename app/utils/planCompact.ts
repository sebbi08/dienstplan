import type { DayRowDto, ReleaseNotificationStatusDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { eventDayText } from './calendarLanes'

/**
 * The compact plan page (editing view): the toggle „Info-Spalten ausblenden“ remembered per device, the summary of the
 * one notices line above the plan and the marker of a day whose Info columns are hidden.
 */

const INFO_HIDDEN_KEY = 'dienstplan.planInfoHidden'

/** „Info-Spalten ausblenden“, remembered per browser (storage may be unavailable or throw: then the columns show). */
export function readInfoHidden(): boolean {
  try {
    return localStorage.getItem(INFO_HIDDEN_KEY) === '1'
  }
  catch {
    return false
  }
}

export function writeInfoHidden(hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(INFO_HIDDEN_KEY, '1')
    else localStorage.removeItem(INFO_HIDDEN_KEY)
  }
  catch {
    // Not remembered; the toggle still works on this page.
  }
}

/** Who was told about the latest release: in all, how many have not read it yet, how many have no account. */
export interface NotificationCounts { total: number; unread: number; noAccount: number }

export function notificationCounts(rows: readonly ReleaseNotificationStatusDto[]): NotificationCounts {
  return {
    total: rows.length,
    unread: rows.filter(row => row.hasAccount && !row.readAt).length,
    noAccount: rows.filter(row => !row.hasAccount).length,
  }
}

/**
 * The parts of the collapsed notices line, in order: „Was noch fehlt“ (open setup points), the release („Freigegeben am …
 * von …“) and the notifications of the latest release. Empty when there is nothing to say (the line is then not shown).
 */
export function noticesSummary(input: {
  setupOpen: number
  release: { at: string; by: string } | null
  notifications: NotificationCounts | null
}): string[] {
  const t = de.planNotices
  const parts: string[] = []
  if (input.setupOpen > 0) parts.push(t.setup(input.setupOpen))
  if (input.release) parts.push(de.plan.releasedAt(input.release.at, input.release.by))
  const counts = input.notifications
  if (counts && counts.total > 0) parts.push(t.notifications(counts.total, counts.unread, counts.noAccount))
  return parts
}

/** Info texts, appointments or automatic events on the day: with the Info columns hidden its date gets a small marker. */
export function dayInfoLines(day: Pick<DayRowDto, 'date' | 'info1' | 'info2' | 'events' | 'autoEvents'>): string[] {
  return [
    day.info1 ? `${de.plan.info1}: ${day.info1}` : '',
    day.info2 ? `${de.plan.info2}: ${day.info2}` : '',
    ...day.events.map(event => eventDayText(event, day.date)),
    ...day.autoEvents,
  ].filter(Boolean)
}

/** What escapeClosesOverview needs of the element Escape was pressed in. */
interface EscapeTarget { tagName?: string; isContentEditable?: boolean; closest?: (selector: string) => unknown }

/**
 * Escape closes the day overview beside the plan (`[data-day-overview]`), wherever the focus is, except in a field of the
 * plan being typed in (an Info text, a search): there Escape belongs to the field (it puts the saved text back).
 */
export function escapeClosesOverview(target: EscapeTarget | null): boolean {
  if (!target || target.closest?.('[data-day-overview]')) return true
  const tag = target.tagName?.toLowerCase()
  return !(tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable)
}
