import { ServiceError } from './errors'

/**
 * Trimmed, non-empty name no other row of the facility uses (compared case-insensitively, umlauts included).
 * `existing` are the facility's rows; `exceptId` is the row being renamed. 400 requiredCode / 409 takenCode otherwise.
 */
export function uniqueName(
  existing: { id: number; name: string }[], name: string, exceptId: number | null,
  codes: { required: string; taken: string },
): string {
  const trimmed = name.trim()
  if (!trimmed) throw new ServiceError(400, codes.required)
  // In JS, not SQLite's lower(), which only folds ASCII letters (Ä ≠ ä).
  const folded = (value: string) => value.trim().toLocaleLowerCase('de')
  if (existing.some(row => row.id !== exceptId && folded(row.name) === folded(trimmed))) {
    throw new ServiceError(409, codes.taken)
  }
  return trimmed
}
