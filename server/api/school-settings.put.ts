import { schoolSettingsSchema } from '../schemas'
import { setSchoolCutoff } from '../services/schoolChildren'

/**
 * The Träger sets the school cutoff of the active facility. Answers the settings as they are afterwards: another cutoff
 * switches the automatic leaving off (`autoLeave`).
 */
export default defineServiceHandler(async (event) => {
  const provider = await requireProvider(event)
  const facilityId = requireFacility(event, provider)
  return setSchoolCutoff(useDb(), facilityId, await readValidatedBody(event, schoolSettingsSchema.parse))
})
