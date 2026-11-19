import { isProtectedCode, maskProtectedEntry } from '../../shared/domain/maternity'
import { can, type PermissionKey } from '../../shared/domain/permissions'
import type { CodeDto, SessionUser, SnapshotData } from '../../shared/types/api'

/**
 * Mutterschutz and Beschäftigungsverbot tell a pregnancy (health data). Only whoever may see the case
 * (employees.sickness) sees these codes; everybody else, and always the tablet, sees a neutral „abwesend“ in every plan,
 * release, change, calendar and time sheet (maskProtectedEntry), and cannot book or change them (server/services/entries.ts).
 * Hours and hints are computed from the real entries; only what is sent is masked.
 */
export function seesProtectedCodes(viewer: Pick<SessionUser, 'role'> & { permissions: ReadonlySet<PermissionKey> }): boolean {
  return viewer.role !== 'terminal' && can(viewer.permissions, 'employees.sickness')
}

/** A plan's snapshot (draft or release) with the protected codes as „abwesend“. */
export function maskSnapshot(data: SnapshotData): SnapshotData {
  return { ...data, entries: data.entries.map(maskProtectedEntry) }
}

/** The codes without the protected ones (for the code lists of the plan, the calendar and the time page). */
export function withoutProtectedCodes(codes: CodeDto[]): CodeDto[] {
  return codes.filter(code => !isProtectedCode(code.key))
}
