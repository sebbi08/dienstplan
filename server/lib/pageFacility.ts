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
