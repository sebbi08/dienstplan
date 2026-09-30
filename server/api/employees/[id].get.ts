import { todayIso } from '../../../shared/domain/dates'
import { idParams } from '../../schemas'
import { getEmployee } from '../../services/employees'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return getEmployee(useDb(), id, todayIso())
})
