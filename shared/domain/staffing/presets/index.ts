import type { GermanState } from '../../states'
import type { IsoDate } from '../../types'
import { sameLawValue, type SameLawValue } from '../overrides'
import type { StaffingRuleSet } from '../types'
import { BB } from './bb'
import { BE } from './be'
import { BW } from './bw'
import { BY } from './by'
import { HB } from './hb'
import { HE } from './he'
import { HH } from './hh'
import { MV } from './mv'
import { NI } from './ni'
import { NW } from './nw'
import { RP } from './rp'
import { SH } from './sh'
import { SL } from './sl'
import { SN } from './sn'
import { ST } from './st'
import { TH } from './th'

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

/** The versions of every state's staffing preset, ascending by `validFrom`; read-only. */
const PRESETS: Record<GermanState, readonly StaffingRuleSet[]> = deepFreeze({
  BW, BY, BE, BB, HB, HH, HE, MV, NI, NW, RP, SL, SN, ST, SH, TH,
})

/** All versions of a state's preset, oldest first. */
export function presetVersions(land: GermanState): readonly StaffingRuleSet[] {
  return PRESETS[land]
}

const lawValues = new WeakMap<StaffingRuleSet, SameLawValue>()

/**
 * The law-value comparison for applyOverrides on `version` of the state (corrections keep overrides; cached). A version
 * that is not one of the state's compares equal numbers only.
 */
export function sameLawValueOf(land: GermanState, version: StaffingRuleSet): SameLawValue {
  let same = lawValues.get(version)
  if (!same) {
    same = sameLawValue(PRESETS[land], version)
    if (PRESETS[land].includes(version)) lawValues.set(version, same)
  }
  return same
}

/**
 * The preset version valid on `date` (the latest `validFrom` ≤ date). Before the first version the
 * oldest known version applies. The result is frozen: overrides must build a new object.
 */
export function presetFor(land: GermanState, date: IsoDate): StaffingRuleSet {
  const versions = PRESETS[land]
  let found = versions[0]!
  for (const version of versions) {
    if (version.validFrom <= date) found = version
  }
  return found
}
