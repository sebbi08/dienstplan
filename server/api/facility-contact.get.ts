import type { FacilityContactDto } from '../../shared/domain/facilityContact'
import { getFacilityContact } from '../services/facilityContact'

/** The contact data of the facility the manager works in (the Träger on the settings pages: the one edited there). */
export default defineServiceHandler(async (event): Promise<FacilityContactDto> => {
  const user = await requirePermission(event, 'settings.facility')
  return getFacilityContact(useDb(), user, user.facilityId)
})
