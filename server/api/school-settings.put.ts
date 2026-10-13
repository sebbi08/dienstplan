import { schoolSettingsSchema } from '../schemas'
import { setSchoolCutoff } from '../services/schoolChildren'

/** The Träger sets the school cutoff of the active facility. */
export default defineServiceHandler(async (event) => {
  const provider = await requireProvider(event)
  const facilityId = requireFacility(event, provider)
  setSchoolCutoff(useDb(), facilityId, await readValidatedBody(event, schoolSettingsSchema.parse))
  return { ok: true }
})
