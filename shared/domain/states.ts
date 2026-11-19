import type { SchoolCutoff } from './schoolStart'

export const GERMAN_STATES = [
  'BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV', 'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH',
] as const

export type GermanState = typeof GERMAN_STATES[number]

export function isGermanState(value: string): value is GermanState {
  return (GERMAN_STATES as readonly string[]).includes(value)
}

/**
 * Cutoff day [month, day] by the end of which a child must have completed its 6th year to be of school age in the state
 * (schoolStart.ts: a child born on the day after it still belongs to it). Most laws say „bis zum … das sechste
 * Lebensjahr vollendet“, which is the day itself. HH „vor dem 1. Juli vollendet“ = 30 June. BY (Art. 37 BayEUG „bis zum
 * 30. September sechs Jahre alt werden“) and NW (§ 35 SchulG „bis zum Beginn des 30. September … vollendet“) take
 * children born up to 30 September only, so their 6th year must be completed on 29 September.
 */
const SCHOOL_CUTOFF_DAY: Record<GermanState, readonly [number, number]> = {
  BW: [6, 30], BY: [9, 29], BE: [9, 30], BB: [9, 30], HB: [6, 30], HH: [6, 30], HE: [6, 30], MV: [6, 30],
  NI: [9, 30], NW: [9, 29], RP: [8, 31], SL: [6, 30], SN: [6, 30], ST: [6, 30], SH: [6, 30], TH: [8, 1],
}

/** The school cutoff the law of the state names (spec section 4). */
export function schoolCutoffOf(state: GermanState): SchoolCutoff {
  const [month, day] = SCHOOL_CUTOFF_DAY[state]
  return { month, day, ageYears: 6 }
}
