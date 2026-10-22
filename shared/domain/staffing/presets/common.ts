import type { AddOn, Qualification } from '../types'

/**
 * Default counting shares in percent. Without a value from the research: Fachkraft and
 * Ergänzungskraft 100, trainees/interns 0 (never overstate the planned staff), `none` 0.
 */
export function shares(over: Partial<Record<Qualification, number>> = {}): Record<Qualification, number> {
  return {
    fachkraft: 100, ergaenzung: 100, azubi_1: 0, azubi_2: 0, azubi_3: 0, praktikant: 0, none: 0, ...over,
  }
}

/** Leitung add-on: once per facility, shown only (not checked against the plan in this step). */
export function leitung(addOn: Omit<AddOn, 'key' | 'label' | 'scope' | 'counts'>): AddOn {
  return { key: 'leitung', label: 'Leitungszeit', scope: 'facility', counts: false, ...addOn }
}
