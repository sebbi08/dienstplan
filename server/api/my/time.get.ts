import { monthParams } from '../../schemas'
import { getMyTime } from '../../services/myTime'

export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  const { year, month } = await getValidatedQuery(event, monthParams.parse)
  return getMyTime(useDb(), user, year, month)
})
