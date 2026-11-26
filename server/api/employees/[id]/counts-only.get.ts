import { idParams } from '../../../schemas'
import { getCountsOnly } from '../../../services/countsOnly'

/** „Nur Kinderzahlen“ of the employee for the tab „Zugang“; who sees and sets it decides the service. */
export default defineServiceHandler(async (event) => {
  const actor = await requirePermission(event, 'users.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return getCountsOnly(useDb(), actor, id)
})
