import type { HelpoutPairsDto } from '#shared/types/api'

/** The facilities paired with the facility for help-outs (mutual: either side of a pair). */
export function pairedWith(pairs: HelpoutPairsDto | null, facilityId: number): Set<number> {
  const ids = new Set<number>()
  for (const [a, b] of pairs?.pairs ?? []) {
    if (a === facilityId) ids.add(b)
    else if (b === facilityId) ids.add(a)
  }
  return ids
}
