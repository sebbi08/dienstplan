import type { CodeDto, EntryInput } from '#shared/types/api'

/**
 * How a duty entered into the plan meets what its cells hold: shifts, special shifts, breaks and timed codes with times
 * (Büro, VZ) are added next to it; full-day codes (Urlaub, Krank, Fortbildung …) and codes without times replace it.
 * The server lets an added duty replace a full-day absence of the cell.
 */
export function entryApplyMode(entry: EntryInput, codes: CodeDto[]): 'add' | 'replace' {
  if (entry.kind !== 'code') return 'add'
  const code = codes.find(candidate => candidate.id === entry.codeId)
  const hasTimes = entry.start != null && entry.end != null
  return code?.creditMode === 'timed' && hasTimes ? 'add' : 'replace'
}
