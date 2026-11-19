import { isPrivateCode, maskPrivateEntry } from '../../shared/domain/maternity'
import { can, type PermissionKey } from '../../shared/domain/permissions'
import type { CodeDto, SessionUser, SnapshotData } from '../../shared/types/api'

/**
 * Krank, Kind krank, Mutterschutz and Beschäftigungsverbot are health data (PRIVATE_CODE_KEYS). Only whoever has
 * employees.sickness sees them; everybody else, and always the tablet, sees the same neutral „abwesend“ for all of them
 * in every plan, release, change, calendar and time sheet (maskPrivateEntry), no „Im Dienst erkrankt“ marker, and cannot
 * book or change them (server/services/entries.ts). Hours and hints are computed from the real entries; only what is
 * sent is masked. The employee sees her or his own entries under „Mein Dienstplan“ as they are.
 */
export function seesProtectedCodes(viewer: Pick<SessionUser, 'role'> & { permissions: ReadonlySet<PermissionKey> }): boolean {
  return viewer.role !== 'terminal' && can(viewer.permissions, 'employees.sickness')
}

/** A plan's snapshot (draft or release) with the private codes as „abwesend“. */
export function maskSnapshot(data: SnapshotData): SnapshotData {
  return { ...data, entries: data.entries.map(maskPrivateEntry) }
}

/** The codes without the private ones (for the code lists of the plan, the calendar and the time page). */
export function withoutPrivateCodes(codes: CodeDto[]): CodeDto[] {
  return codes.filter(code => !isPrivateCode(code.key))
}
