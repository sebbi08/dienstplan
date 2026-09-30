import { idParams } from '../../schemas'
import { deleteCoverageRule } from '../../services/settings'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteCoverageRule(useDb(), id)
  return { ok: true }
})
