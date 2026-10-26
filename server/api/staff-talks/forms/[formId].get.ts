import { formIdParams } from '../../../schemas'
import { getTalkForm } from '../../../services/staffTalks'

/** One form of the facility's talks with its talk and the names for the printout (Leitung and Träger). */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  return getTalkForm(useDb(), admin.facilityId, formId)
})
