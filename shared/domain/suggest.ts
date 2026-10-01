import { workedMinutes, type WorkSpan } from './balance'
import type { CodeKey, Minutes } from './types'
import { isTargetGapCode } from './warnings'

export interface SuggestTemplate {
  id: number
  start: Minutes
  end: Minutes
  breakStart: Minutes | null
  breakEnd: Minutes | null
  pairsWithPrepTime: boolean
}

export type SuggestDayEntry = WorkSpan & { codeKey: CodeKey | null }

/**
 * Suggests the full fixed shift (one marked for VZ/Büro, e.g. F2, M, S) to enter around the VZ/Büro times
 * of a day: preferably one that encloses all of them, among those the one whose added working minutes come
 * closest to the missing minutes.
 */
export function suggestFullShift<T extends SuggestTemplate>(
  dayEntries: SuggestDayEntry[], missingMinutes: number, templates: T[],
): T | null {
  const gapSpans = dayEntries.filter(entry => isTargetGapCode(entry.codeKey) && entry.start !== null && entry.end !== null)
  const candidates = templates.filter(template => template.pairsWithPrepTime)
  const enclosing = candidates.filter(template => gapSpans.every(span => template.start <= span.start! && span.end! <= template.end))
  const before = workedMinutes(dayEntries)

  let best: { template: T; distance: number } | null = null
  for (const template of enclosing.length > 0 ? enclosing : candidates) {
    const added = workedMinutes([...dayEntries, { kind: 'shift', ...template }]) - before
    const distance = Math.abs(added - missingMinutes)
    if (!best || distance < best.distance) best = { template, distance }
  }
  return best?.template ?? null
}
