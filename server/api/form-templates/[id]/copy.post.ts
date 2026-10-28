import { idParams } from '../../../schemas'
import { copyTemplate } from '../../../services/formTemplates'

/** A copy „‹Name› (Kopie)“ of a template, with new ids. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'formTemplates.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return { id: copyTemplate(useDb(), admin, admin.facilityId, id) }
})
