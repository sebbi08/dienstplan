import type { FacilityContactDto } from '../../shared/domain/facilityContact'
import { facilityContactQuery } from '../schemas'
import { getFacilityContact } from '../services/facilityContact'

/**
 * The contact data of a facility: `?facilityId=` names it (a facility card on the settings page), otherwise the one the
 * manager works in (the Träger on the settings pages: the one edited there). The Träger reads every facility's, the
 * Leitung only the own one (403 otherwise); 404 for an unknown facility.
 */
export default defineServiceHandler(async (event): Promise<FacilityContactDto> => {
  const user = await requirePermission(event, 'settings.facility')
  const { facilityId } = await getValidatedQuery(event, facilityContactQuery.parse)
  return getFacilityContact(useDb(), user, facilityId ?? user.facilityId)
})
