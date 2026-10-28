import { idParams } from '../../../schemas'
import { getUserRights } from '../../../services/rights'

/**
 * A person's switches: from the role, the exceptions, what applies. The Träger for every Leitung and Mitarbeiter
 * account, the Leitung for the Mitarbeiter of its facility (the service checks).
 */
export default defineServiceHandler(async (event) => {
  const actor = await requirePermission(event, 'users.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return getUserRights(useDb(), actor, id)
})
