import type { MyOpenItemsDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { attendanceLink } from '~/utils/eventRequirements'

/** One line of „Offen für dich“: what is open (how many things), where it is done. */
export interface OpenItemLink {
  key: string
  label: string
  to: string
  icon: string
  count: number
}

/** The lines of „Offen für dich“ in a fixed order (signatures and confirmations first); none for kinds with nothing open. */
export function openItemLinks(items: MyOpenItemsDto): OpenItemLink[] {
  const t = de.openItems
  const lines: (OpenItemLink | false)[] = [
    items.sign > 0 && { key: 'sign', label: t.sign(items.sign, items.signOverdue), to: '/my/sign', icon: 'i-lucide-signature', count: items.sign },
    items.knowledge > 0 && { key: 'knowledge', label: t.knowledge(items.knowledge), to: '/documents?tab=knowledge', icon: 'i-lucide-book-check', count: items.knowledge },
    items.selfAssessments > 0 && { key: 'self', label: t.selfAssessments(items.selfAssessments), to: '/my/talks', icon: 'i-lucide-clipboard-pen', count: items.selfAssessments },
    items.leaveNotice && { key: 'leaveNotice', label: t.leaveNotice, to: '/my/leave', icon: 'i-lucide-info', count: 1 },
    items.leaveDecisions > 0 && { key: 'leave', label: t.leaveDecisions(items.leaveDecisions), to: '/my/leave', icon: 'i-lucide-plane', count: items.leaveDecisions },
    items.requirements > 0 && { key: 'requirements', label: t.requirements(items.requirements), to: '/my/requirements', icon: 'i-lucide-calendar-check', count: items.requirements },
    // Leitung and Träger: Pflichttermin appointments whose attendance is still to be confirmed (opens the first one).
    !!items.attendance && { key: 'attendance', label: de.eventRequirements.openItem(items.attendance.count), to: attendanceLink(items.attendance), icon: 'i-lucide-user-check', count: items.attendance.count },
  ]
  return lines.filter((line): line is OpenItemLink => line !== false)
}

/** „Offen (n)“ on the plan page: everything the card's lines count, added up (0 = the button is hidden). */
export function openItemsCount(links: readonly OpenItemLink[]): number {
  return links.reduce((sum, link) => sum + link.count, 0)
}
