import type { FacilityContactDto } from '../../shared/domain/facilityContact'
import { facilityContactQuery, facilityContactSchema } from '../schemas'
import { writeFacilityContact } from '../services/facilityContact'

/**
 * The Träger stores the contact data of a facility: `?facilityId=` names it (a facility card on the settings page),
 * otherwise the one edited on the settings pages. 400 with a German code for an invalid PLZ, website, e-mail or phone
 * number, 404 for an unknown facility. Answers the data as stored.
 */
export default defineServiceHandler(async (event): Promise<FacilityContactDto> => {
  const user = await requirePermission(event, 'facilities.manage')
  const { facilityId } = await getValidatedQuery(event, facilityContactQuery.parse)
  const body = await readValidatedBody(event, facilityContactSchema.parse)
  return writeFacilityContact(useDb(), user, facilityId, body as FacilityContactDto)
})
