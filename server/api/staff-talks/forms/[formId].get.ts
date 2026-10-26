import { formIdParams } from '../../../schemas'
import { getTalkForm } from '../../../services/staffTalks'

/** One form of the facility's talks with its talk and the names for the printout (Leitung and Träger). */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  // Never the manager's own talks: those are held by the Träger or another Leitung.
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  return getTalkForm(useDb(), scope, formId)
})
