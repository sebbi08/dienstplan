import { idParams } from '../../../schemas'
import { confirmationOverview } from '../../../services/knowledge'

/** Who of the facility confirmed the entry and who not yet (also the printed „Nachweis“). */
export default defineServiceHandler(async (event) => {
  const manager = await requirePermission(event, 'knowledge.manage', { facility: 'active' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return confirmationOverview(useDb(), await withHomeGroup(event, manager), id)
})
