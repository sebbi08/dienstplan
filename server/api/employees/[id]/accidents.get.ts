import { idParams } from '../../../schemas'
import { listEmployeeAccidents } from '../../../services/accidents'

/** The Personalakte's „Unfälle“: the employee's accident reports (Leitung/Träger; another facility's employee 404). */
export default defineServiceHandler(async (event) => {
  const actor = await requirePermission(event, 'accidents.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return listEmployeeAccidents(useDb(), { user: actor, facilityId: actor.facilityId }, id)
})
