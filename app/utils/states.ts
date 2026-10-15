import type { GermanState } from '#shared/domain/states'
// Relative, so the domain tests can load it without the Nuxt aliases.
import { de } from '../locales/de'

/** "in Berlin", but "im Saarland": the state's name with the right preposition. */
export function inState(state: GermanState): string {
  return state === 'SL' ? `im ${de.states.SL}` : `in ${de.states[state]}`
}
