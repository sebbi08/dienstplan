import { idParams } from '../../../../schemas'
import { listChildForms } from '../../../../services/childForms'

/** The child's observation forms with the viewer's right on each (whoever sees the record reads them). */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildReader(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return listChildForms(useDb(), viewer, id)
})
