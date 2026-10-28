import { todayIso } from '../../../shared/domain/dates'
import { idParams } from '../../schemas'
import { getChild } from '../../services/children'

export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.view')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const now = new Date()
  return getChild(useDb(), viewer, id, todayIso(now), now)
})
