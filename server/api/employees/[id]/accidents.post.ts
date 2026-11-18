import { accidentCreateSchema, idParams } from '../../../schemas'
import { createEmployeeAccident } from '../../../services/accidents'

/** „Unfallanzeige ausfüllen“ in the Personalakte (Leitung/Träger); prefilled with what the actor may read. */
export default defineServiceHandler(async (event) => {
  const actor = await requirePermission(event, 'accidents.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, accidentCreateSchema.parse)
  return { id: createEmployeeAccident(useDb(), { user: actor, facilityId: actor.facilityId }, id, body) }
})
