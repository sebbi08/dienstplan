import { childCreateSchema } from '../../schemas'
import { createChild } from '../../services/children'

export default defineServiceHandler(async (event) => {
  const actor = await requireChildEditor(event)
  const body = await readValidatedBody(event, childCreateSchema.parse)
  return { id: createChild(useDb(), actor, actor.facilityId, body) }
})
