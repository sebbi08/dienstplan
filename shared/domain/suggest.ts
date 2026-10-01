import type { CodeKey, Minutes } from './types'
import { isTargetGapCode } from './warnings'

export interface SuggestTemplate {
  start: Minutes
  end: Minutes
  pairsWithPrepTime: boolean
}

export interface SuggestDayEntry {
  codeKey: CodeKey | null
  start: Minutes | null
  end: Minutes | null
}

/**
 * The full fixed shifts (marked for VZ/Büro, e.g. F2, M, S) offered around the VZ/Büro times of a day:
 * every one that encloses all of them, or all marked shifts when none does. Keeps the template order.
 */
export function fullShiftOptions<T extends SuggestTemplate>(dayEntries: SuggestDayEntry[], templates: T[]): T[] {
  const gapSpans = dayEntries.filter(entry => isTargetGapCode(entry.codeKey) && entry.start !== null && entry.end !== null)
  const candidates = templates.filter(template => template.pairsWithPrepTime)
  const enclosing = candidates.filter(template => gapSpans.every(span => template.start <= span.start! && span.end! <= template.end))
  return enclosing.length > 0 ? enclosing : candidates
}
