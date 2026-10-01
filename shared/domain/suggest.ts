import type { Minutes } from './types'

export interface SuggestTemplate {
  id: number
  start: Minutes
  end: Minutes
  breakStart: Minutes | null
  breakEnd: Minutes | null
  countsAsStaff: boolean
}

export interface ShiftSuggestion {
  templateId: number
  start: Minutes
  end: Minutes
  breakStart: Minutes | null
  breakEnd: Minutes | null
}

/**
 * Suggests the fixed (care staff) shift that, started at `start` (e.g. right after VZ), comes closest to the
 * missing minutes of the day. The shift keeps its end time and its break if the break still lies inside.
 */
export function suggestShiftAfter(start: Minutes, missingMinutes: number, templates: SuggestTemplate[]): ShiftSuggestion | null {
  let best: { suggestion: ShiftSuggestion; distance: number } | null = null
  for (const template of templates) {
    if (!template.countsAsStaff || template.end <= start || template.start > start) continue
    const keepsBreak = template.breakStart !== null && template.breakEnd !== null
      && template.breakStart >= start && template.breakEnd <= template.end
    const net = template.end - start - (keepsBreak ? template.breakEnd! - template.breakStart! : 0)
    const distance = Math.abs(net - missingMinutes)
    if (!best || distance < best.distance) {
      best = {
        distance,
        suggestion: {
          templateId: template.id, start, end: template.end,
          breakStart: keepsBreak ? template.breakStart : null, breakEnd: keepsBreak ? template.breakEnd : null,
        },
      }
    }
  }
  return best?.suggestion ?? null
}
