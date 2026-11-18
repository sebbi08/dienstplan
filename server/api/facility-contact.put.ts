import type { FacilityContactDto } from '../../shared/domain/facilityContact'
import { facilityContactSchema } from '../schemas'
import { getFacilityContact, setFacilityContact } from '../services/facilityContact'

/**
 * The Träger stores the contact data of the facility (on the settings pages: the one edited there); 400 with a German
 * code for an invalid PLZ, website, e-mail or phone number. Answers the data as stored.
 */
export default defineServiceHandler(async (event): Promise<FacilityContactDto> => {
  const user = await requirePermission(event, 'facilities.manage')
  const body = await readValidatedBody(event, facilityContactSchema.parse)
  const db = useDb()
  setFacilityContact(db, user, user.facilityId, body as FacilityContactDto)
  return getFacilityContact(db, user, user.facilityId)
})
