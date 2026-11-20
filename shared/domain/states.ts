import type { SchoolCutoff } from './schoolStart'

export const GERMAN_STATES = [
  'BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV', 'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH',
] as const

export type GermanState = typeof GERMAN_STATES[number]

export function isGermanState(value: string): value is GermanState {
  return (GERMAN_STATES as readonly string[]).includes(value)
}

/**
 * The last birthday [month, day] that still makes a child of school age in the state (schoolStart.ts: born on or before
 * that day, six years before the school start). BW 30 June (user decision 20.11.2026: „letzter Stichtag ist 30. Juni“).
 * BY (Art. 37 BayEUG „bis zum 30. September sechs Jahre alt werden“) and NW (§ 35 SchulG „bis zum Beginn des
 * 30. September … vollendet“) 30 September, TH (§ 18 Abs. 1 ThürSchulG „am 1. August eines Jahres sechs Jahre alt“)
 * 1 August, HH (§ 38 Abs. 1 HmbSG „vor dem 1. Juli das 6. Lebensjahr vollendet“) 1 July. The values from before the
 * reading „vollendet bis zum Ende des Stichtags“ (706ad70, reversed by 0110_school_cutoff_birthday).
 */
const SCHOOL_CUTOFF_DAY: Record<GermanState, readonly [number, number]> = {
  BW: [6, 30], BY: [9, 30], BE: [9, 30], BB: [9, 30], HB: [6, 30], HH: [7, 1], HE: [6, 30], MV: [6, 30],
  NI: [9, 30], NW: [9, 30], RP: [8, 31], SL: [6, 30], SN: [6, 30], ST: [6, 30], SH: [6, 30], TH: [8, 1],
}

/** The school cutoff the law of the state names (spec section 4). */
export function schoolCutoffOf(state: GermanState): SchoolCutoff {
  const [month, day] = SCHOOL_CUTOFF_DAY[state]
  return { month, day, ageYears: 6 }
}
