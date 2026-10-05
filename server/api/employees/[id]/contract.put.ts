import { contractSchema, idParams } from '../../../schemas'
import { setContract } from '../../../services/employees'

export default defineServiceHandler(async (event) => {
  await requireProvider(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  setContract(useDb(), id, await readValidatedBody(event, contractSchema.parse))
  return { ok: true }
})
