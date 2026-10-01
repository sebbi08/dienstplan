import type { ChangeDto, PendingChangeDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDateTime } from '~/utils/format'

/** One line per release in which the cell changed, oldest first. */
export function releasedChangeText(changes: ChangeDto[] | undefined): string | undefined {
  if (!changes?.length) return undefined
  return changes
    .map(change => de.plan.releasedChangeTooltip(
      formatDateTime(change.changedAt), change.changedBy, change.before || de.plan.empty, change.after || de.plan.empty,
    ))
    .join('\n')
}

export function pendingChangeText(change: PendingChangeDto | undefined): string | undefined {
  return change ? de.plan.pendingTooltip(change.before || de.plan.empty, change.after || de.plan.empty) : undefined
}
