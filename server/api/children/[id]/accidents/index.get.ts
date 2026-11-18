import { idParams } from '../../../../schemas'
import { listChildAccidents } from '../../../../services/accidents'

/** The child's accident reports with the viewer's right on each (whoever sees the record reads them). */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.view')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return listChildAccidents(useDb(), viewer, id)
})
