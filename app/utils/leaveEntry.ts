import type { LeaveEntryResultDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * The toast after „Urlaub eintragen“ (`kind`: the kind inside a sentence, de.leaveEntry.kindNames). Something written
 * shows in green, with the kept absences if there are any. When nothing was written the toast is neutral: either the
 * period was already entered, or only kept absences remain.
 */
export function leaveEntryToast(result: LeaveEntryResultDto, kind: string): { title: string; color: 'success' | 'neutral' } {
  if (result.booked === 0 && result.reasonUpdated) return { title: de.specialLeave.reasonUpdated(result.reasonUpdated), color: 'success' }
  if (result.booked === 0) {
    return { title: result.keptAbsences ? de.leaveEntry.nothingKept(result.keptAbsences, kind) : de.leaveEntry.alreadyEntered, color: 'neutral' }
  }
  return {
    title: result.keptAbsences
      ? de.leaveEntry.bookedKept(result.booked, result.keptAbsences, kind)
      : de.leaveEntry.booked(result.booked, kind),
    color: 'success',
  }
}

/** The question before removing a period: one with days before today warns that empty past days count as minus hours. */
export function leaveRemovalQuestion(kind: string, from: string, to: string, today: string, format: (date: string) => string): string {
  return from < today
    ? de.leaveEntry.removePastConfirm(kind, format(from), format(to))
    : de.leaveEntry.removeConfirm(kind, format(from), format(to))
}
