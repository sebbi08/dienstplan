import { formTemplateQuery } from '../../schemas'
import { listTemplates } from '../../services/formTemplates'

/** The form templates of the active facility, optionally of one kind (Leitung and Träger). */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { kind } = await getValidatedQuery(event, formTemplateQuery.parse)
  return listTemplates(useDb(), admin.facilityId, kind)
})
