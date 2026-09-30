import { monthParams } from '../../../../schemas'
import { unreleaseMonth } from '../../../../services/release'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { year, month } = await getValidatedRouterParams(event, monthParams.parse)
  unreleaseMonth(useDb(), year, month)
  return { ok: true }
})
