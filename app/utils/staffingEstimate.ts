import type { RequirementLine } from '#shared/domain/staffing/types'
import type { StaffingEstimateAssumptionsDto, StaffingEstimatePresenceDto } from '#shared/types/api'
import { formatNumber } from './format'
// Relative, so the domain tests can load it without the Nuxt aliases.
import { de } from '../locales/de'

/** Texts of the Personalschlüssel estimate in the group settings (the server counts; these only word it). */

const t = de.staffing.estimate

function presencePart(rule: StaffingEstimatePresenceDto): string | null {
  const who: string[] = []
  if (rule.perChildren) {
    const { staff, fachkraft, children } = rule.perChildren
    who.push(t.staff(staff))
    if (fachkraft) who.push(t.ofThem(t.fachkraefte(fachkraft)))
    who[who.length - 1] += ` ${t.perChildren(children)}`
  } else if (rule.minStaff) {
    who.push(t.staff(rule.minStaff))
    if (rule.minFachkraft) who.push(t.ofThem(t.fachkraefte(rule.minFachkraft)))
  } else if (rule.minFachkraft) {
    who.push(t.fachkraefte(rule.minFachkraft))
  }
  if (who.length === 0) return null
  const when = [t.windows[rule.window], rule.minChildren ? t.fromChildren(rule.minChildren) : null].filter(Boolean).join(' ')
  return `${who.join(', ')} ${when}`
}

/** The presence rules as one sentence: „Mindestens 1 Fachkraft während der ganzen Öffnungszeit, 2 Fachkräfte in der Hauptbetreuungszeit.“ */
export function presenceSentence(rules: StaffingEstimatePresenceDto[]): string | null {
  const parts = rules.map(presencePart).filter((part): part is string => part !== null)
  return parts.length === 0 ? null : `${t.presenceStart} ${parts.join(', ')}.`
}

/** The assumptions of the estimate in one line: hours per place, and the children under 3 or school children. */
export function assumptionText(assumptions: StaffingEstimateAssumptionsDto): string {
  const hours = assumptions.weeklyHoursPerChild
  const base = hours === null || assumptions.hoursSource === 'none'
    ? t.assumedNone
    : assumptions.hoursSource === 'reference' ? t.assumedReference(formatNumber(hours)) : t.assumedOpening(formatNumber(hours))
  const ages = assumptions.u3 > 0 && assumptions.u3 === assumptions.children
    ? t.assumedAllU3
    : assumptions.u3 > 0 ? t.assumedSomeU3(assumptions.u3) : assumptions.school > 0 ? t.assumedSchool : null
  return ages === null ? base : `${base}; ${ages}`
}

/** The lines besides the base demand: surcharges counted in the FTE, and lines only shown (Leitungszeit); zero lines left out. */
export function estimateLines(lines: RequirementLine[]): { included: RequirementLine[]; shown: RequirementLine[] } {
  const others = lines.filter(line => line.key !== 'demand' && line.fte > 0)
  return { included: others.filter(line => line.counts), shown: others.filter(line => !line.counts) }
}
