import type { SessionUser } from '../../shared/types/api'
import { ServiceError } from './errors'

/**
 * A Träger's open page belongs to the facility that was active when it was loaded. When they switched facility in
 * another window since, a request from the old page would read or change the newly active facility instead: refuse it
 * with 409 `facility_changed`, and the page reloads. Requests without the header (the PDF rendering, other callers) and
 * everyone else (whose facility is fixed) are not checked.
 */
export function assertPageFacility(user: SessionUser, header: string | undefined): void {
  if (user.role !== 'provider' || header === undefined || header.trim() === '') return
  const pageFacility = Number(header)
  if (!Number.isInteger(pageFacility)) return
  if (pageFacility !== user.facilityId) throw new ServiceError(409, 'facility_changed')
}
