import { childFormCreateSchema, idParams } from '../../../../schemas'
import { createChildForm } from '../../../../services/childForms'

/** Starts an observation form for the child; the service lets managers and the key educator at the tablet. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildReader(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, childFormCreateSchema.parse)
  return { id: createChildForm(useDb(), viewer, id, body) }
})
