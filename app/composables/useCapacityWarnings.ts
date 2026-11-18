import type { AgeLimitWarningDto, CapacityWarningDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { ageLimitWarningText } from '~/utils/ageLimits'

/** The hint lines, e.g. „Bären hat dann 21 von 20 Plätzen (ab November 2026).“ */
export function capacityWarningLines(warnings: CapacityWarningDto[]): string[] {
  return warnings.map((warning) => {
    const from = `${de.months[warning.month - 1]} ${warning.year}`
    return warning.kind === 'group'
      ? de.capacity.group(warning.name, warning.count, warning.capacity, from)
      : de.capacity.facility(warning.count, warning.capacity, from)
  })
}

/** The age limit lines, e.g. „Achtung: In Bären sind ab März 2027 zu viele Kinder unter 3 Jahren (6 von 5).“ */
export function ageLimitWarningLines(warnings: AgeLimitWarningDto[]): string[] {
  return warnings.map(warning => de.ageLimits.attention(ageLimitWarningText(warning)))
}

/**
 * Shows the yellow hint after a save that took a group or the facility over its Höchstzahl Kinder, and the one for a
 * group's age limits it takes over in the coming twelve months (the save happened anyway). Nothing for an answer
 * without warnings. A toast, so it stays visible when the page changes after the save.
 */
export function useCapacityWarnings() {
  const toast = useToast()
  return (answer: unknown) => {
    const result = answer as { capacityWarnings?: CapacityWarningDto[]; ageLimitWarnings?: AgeLimitWarningDto[] } | null
    const warnings = result?.capacityWarnings ?? []
    if (warnings.length > 0) {
      toast.add({
        title: de.capacity.warningTitle, description: capacityWarningLines(warnings).join(' '), color: 'warning',
        icon: 'i-lucide-triangle-alert', duration: 15000,
      })
    }
    const ageWarnings = result?.ageLimitWarnings ?? []
    if (ageWarnings.length > 0) {
      toast.add({
        title: de.ageLimits.saveTitle, description: ageLimitWarningLines(ageWarnings).join(' '), color: 'warning',
        icon: 'i-lucide-triangle-alert', duration: 15000,
      })
    }
    // The hint on the Kinder page follows every such save (it may also have ended a violation).
    void refreshNuxtData('children-age-limit-warnings')
  }
}
