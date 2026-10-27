import { isManager } from '../../shared/domain/roles'
import type { SessionUser } from '../../shared/types/api'
import { ServiceError } from './errors'

/**
 * A manager's open page belongs to the facility that was active when it was loaded. When the Träger switched facility
 * in another window since (or a Leitung's account moved with its employee), a request from the old page would read or
 * change the new facility instead: refuse it with 409 `facility_changed`, and the page reloads. Requests without the
 * header (the PDF rendering, other callers) and Mitarbeiter/tablet accounts are not checked.
 */
export function assertPageFacility(user: SessionUser, header: string | undefined): void {
  if (!isManager(user.role) || header === undefined || header.trim() === '') return
  const pageFacility = Number(header)
  if (!Number.isInteger(pageFacility)) return
  if (pageFacility !== user.facilityId) throw new ServiceError(409, 'facility_changed')
}

/**
 * The facility whose settings a Träger edits from the settings pages without switching the active one (header
 * SETTINGS_FACILITY_HEADER): its id when the header names another facility than the active one, otherwise null (no
 * header, or the active facility itself). A header that names no existing facility answers 404 `facility_not_found`.
 * Every other role's header is ignored: the Leitung only ever edits its own facility.
 */
export function settingsFacilityOverride(
  user: SessionUser, header: string | undefined, exists: (facilityId: number) => boolean,
): number | null {
  if (user.role !== 'provider' || header === undefined || header.trim() === '') return null
  const facilityId = Number(header)
  if (!Number.isInteger(facilityId) || facilityId <= 0 || !exists(facilityId)) throw new ServiceError(404, 'facility_not_found')
  return facilityId === user.facilityId ? null : facilityId
}

/**
 * The facility a manager's request works in: first the page check against the active facility (so a settings page
 * showing another facility never gets a false 409), then the Träger's settings facility, if any, instead of the active one.
 */
export function requestFacility(
  user: SessionUser & { facilityId: number }, headers: { page?: string; settings?: string },
  exists: (facilityId: number) => boolean,
): number {
  assertPageFacility(user, headers.page)
  return settingsFacilityOverride(user, headers.settings, exists) ?? user.facilityId
}
