import type { CapacityWarningDto } from '#shared/types/api'
import { de } from '~/locales/de'

/** The hint lines, e.g. „Bären hat dann 21 von 20 Plätzen (ab November 2026).“ */
export function capacityWarningLines(warnings: CapacityWarningDto[]): string[] {
  return warnings.map((warning) => {
    const from = `${de.months[warning.month - 1]} ${warning.year}`
    return warning.kind === 'group'
      ? de.capacity.group(warning.name, warning.count, warning.capacity, from)
      : de.capacity.facility(warning.count, warning.capacity, from)
  })
}

/**
 * Shows the yellow hint after a save that took a group or the facility over its Höchstzahl Kinder (the save happened
 * anyway). Nothing for an answer without warnings. A toast, so it stays visible when the page changes after the save.
 */
export function useCapacityWarnings() {
  const toast = useToast()
  return (answer: unknown) => {
    const warnings = (answer as { capacityWarnings?: CapacityWarningDto[] } | null)?.capacityWarnings ?? []
    if (warnings.length === 0) return
    toast.add({
      title: de.capacity.warningTitle, description: capacityWarningLines(warnings).join(' '), color: 'warning',
      icon: 'i-lucide-triangle-alert', duration: 15000,
    })
  }
}
