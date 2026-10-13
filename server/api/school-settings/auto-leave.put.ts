import { autoLeaveSchema } from '../../schemas'
import { setAutoLeave } from '../../services/schoolChildren'

/**
 * The Träger switches the automatic leaving of school children of the active facility on or off. The daily run does
 * the deregistering (within the hour); the preview route says beforehand whom it takes.
 */
export default defineServiceHandler(async (event) => {
  const provider = await requireProvider(event)
  const facilityId = requireFacility(event, provider)
  const { autoLeave } = await readValidatedBody(event, autoLeaveSchema.parse)
  setAutoLeave(useDb(), facilityId, autoLeave)
  return { ok: true }
})
