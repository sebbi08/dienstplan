import { idParams, userRightsSchema } from '../../../schemas'
import { saveUserRights } from '../../../services/rights'

/**
 * Replaces a person's exceptions. The Träger any of them; the Leitung only „eintragen und Akten ändern“ of a
 * Mitarbeiter of its facility (the service answers 403 for anything else).
 */
export default defineServiceHandler(async (event) => {
  const actor = await requirePermission(event, 'users.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { overrides } = await readValidatedBody(event, userRightsSchema.parse)
  return saveUserRights(useDb(), actor, id, overrides)
})
