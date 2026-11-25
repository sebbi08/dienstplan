import { helpoutPairSchema } from '../../schemas'
import { setHelpoutPair } from '../../services/helpoutPairs'

/** The Träger allows or ends help-outs between two facilities (mutual); across all facilities. */
export default defineServiceHandler(async (event) => {
  const actor = await requirePermission(event, 'facilities.manage', { facility: 'none' })
  const { facilityId, otherFacilityId, paired } = await readValidatedBody(event, helpoutPairSchema.parse)
  setHelpoutPair(useDb(), actor, facilityId, otherFacilityId, paired)
  return { ok: true }
})
