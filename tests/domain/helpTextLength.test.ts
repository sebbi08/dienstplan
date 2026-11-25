import { describe, expect, it } from 'vitest'
import { de } from '~/locales/de'

/**
 * Long hints (UX audit item 15): one short part stays visible, the details and legal background sit behind
 * „Mehr erfahren“ (MoreHint) under a key ending in `More`, next to the short one. Every other text in de.ts – what a
 * page shows without a click – stays at most HINT_LIMIT characters.
 */
const HINT_LIMIT = 300

/** Texts that are no hint shown by default: an error, a confirmation, or a warning only in a special case. */
const ALLOWED = new Set([
  'errors.would_deregister', // error message after a save
  'groups.deleteConfirm', // confirmation dialogs
  'employees.deleteEntitlementConfirm',
  'childLifecycle.confirmDeleteAccidents',
  'requirements.employmentBanHint', // warning only once the JArbSchG follow-up is overdue (legal text)
])
/** Keys that end in `More` but are ordinary texts (a menu entry, „… und 3 weitere“), not the hidden part of a hint. */
const NOT_A_MORE_PART = new Set(['plan.menuMore', 'parentalLeave.entriesMore'])

// Functions are called with sample arguments of each kind; the longest result counts.
const SAMPLES: unknown[][] = [['Musterperson', 'Musterperson', 'Musterperson'], [true, true, true], [false, false, false], [12, 12, 12]]
function longest(fn: (...args: unknown[]) => unknown): number {
  let max = 0
  for (const args of SAMPLES) {
    try {
      const text = fn(...args)
      if (typeof text === 'string') max = Math.max(max, text.length)
    } catch { /* not callable with these arguments */ }
  }
  return max
}

function collect(node: Record<string, unknown>, path: string, long: string[], pairs: string[]) {
  for (const [key, value] of Object.entries(node)) {
    const at = path ? `${path}.${key}` : key
    if (key.endsWith('More') && !NOT_A_MORE_PART.has(at)) {
      if (!(key.slice(0, -4) in node)) pairs.push(at)
      continue
    }
    if (typeof value === 'string' && value.length > HINT_LIMIT && !ALLOWED.has(at)) long.push(`${at} (${value.length})`)
    else if (typeof value === 'function' && !ALLOWED.has(at) && longest(value as (...args: unknown[]) => unknown) > HINT_LIMIT) long.push(at)
    else if (value && typeof value === 'object') collect(value as Record<string, unknown>, at, long, pairs)
  }
}

describe('help texts in de.ts', () => {
  const long: string[] = []
  const pairs: string[] = []
  collect(de as unknown as Record<string, unknown>, '', long, pairs)

  it(`shows at most ${HINT_LIMIT} characters without „Mehr erfahren“`, () => {
    expect(long).toEqual([])
  })

  it('keeps every „Mehr erfahren“ part next to its short part', () => {
    expect(pairs).toEqual([])
  })

  it('names the built-in Pflichttermine rules at their rows', () => {
    expect(Object.keys(de.requirements.builtinRules).sort()).toEqual(['company_doctor', 'ifsg_briefing', 'youth_followup', 'youth_initial'])
    expect(de.requirements.builtinRules.ifsg_briefing).toContain('§ 34 Abs. 5a IfSG')
    expect(de.requirements.builtinRules.company_doctor).toContain('ArbMedVV')
  })
})
