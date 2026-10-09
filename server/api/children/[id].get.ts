import { todayIso } from '../../../shared/domain/dates'
import { idParams } from '../../schemas'
import { getChild } from '../../services/children'

export default defineServiceHandler(async (event) => {
  const viewer = await requireChildReader(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return getChild(useDb(), viewer, id, todayIso())
})
