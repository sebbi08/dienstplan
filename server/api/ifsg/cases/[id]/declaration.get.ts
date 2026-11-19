import { idParams } from '../../../../schemas'
import { ifsgDeclaration } from '../../../../services/ifsg'

/** The parents' declaration of a case to print; the service lets the child's own group and the managers. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.attendance')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return ifsgDeclaration(useDb(), viewer, id)
})
