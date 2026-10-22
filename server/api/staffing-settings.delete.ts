import type { StaffingResetDto } from '../../shared/types/api'
import { staffingResetQuery } from '../schemas'
import { resetStaffingOverrides } from '../services/staffing'

/**
 * „Auf Vorgabe zurücksetzen“: the Träger deletes the staffing overrides of the active facility (`?path=` only that
 * one); answers the settings as they are afterwards.
 */
export default defineServiceHandler(async (event): Promise<StaffingResetDto> => {
  const provider = await requireProvider(event)
  const facilityId = requireFacility(event, provider)
  const { path } = await getValidatedQuery(event, staffingResetQuery.parse)
  return resetStaffingOverrides(useDb(), provider, facilityId, path ?? null)
})
