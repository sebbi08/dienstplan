import { countsOnlySchema, idParams } from '../../../schemas'
import { setCountsOnly } from '../../../services/countsOnly'

/** Switches „Nur Kinderzahlen“ of the employee (Leitung for Mitarbeiter of her facility, Träger; checked in the service). */
export default defineServiceHandler(async (event) => {
  const actor = await requirePermission(event, 'users.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { countsOnly } = await readValidatedBody(event, countsOnlySchema.parse)
  return setCountsOnly(useDb(), actor, id, countsOnly)
})
