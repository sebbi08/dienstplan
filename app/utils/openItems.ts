import type { MyOpenItemsDto } from '#shared/types/api'
import { de } from '~/locales/de'

/** One line of „Offen für dich“: what is open, where it is done. */
export interface OpenItemLink {
  key: string
  label: string
  to: string
  icon: string
}

/** The lines of „Offen für dich“ in a fixed order (signatures and confirmations first); none for kinds with nothing open. */
export function openItemLinks(items: MyOpenItemsDto): OpenItemLink[] {
  const t = de.openItems
  const lines: (OpenItemLink | false)[] = [
    items.sign > 0 && { key: 'sign', label: t.sign(items.sign, items.signOverdue), to: '/my/sign', icon: 'i-lucide-signature' },
    items.knowledge > 0 && { key: 'knowledge', label: t.knowledge(items.knowledge), to: '/documents?tab=knowledge', icon: 'i-lucide-book-check' },
    items.selfAssessments > 0 && { key: 'self', label: t.selfAssessments(items.selfAssessments), to: '/my/talks', icon: 'i-lucide-clipboard-pen' },
    items.leaveNotice && { key: 'leaveNotice', label: t.leaveNotice, to: '/my/leave', icon: 'i-lucide-info' },
    items.leaveDecisions > 0 && { key: 'leave', label: t.leaveDecisions(items.leaveDecisions), to: '/my/leave', icon: 'i-lucide-plane' },
    items.requirements > 0 && { key: 'requirements', label: t.requirements(items.requirements), to: '/my/requirements', icon: 'i-lucide-calendar-check' },
  ]
  return lines.filter((line): line is OpenItemLink => line !== false)
}
