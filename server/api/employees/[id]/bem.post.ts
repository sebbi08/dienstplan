import { idParams } from '../../../schemas'
import { startBem } from '../../../services/bem'

/** „BEM einleiten“ for the facility's employee (409 bem_open_exists while one is running); answers its id. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.sickness')
  // Never the viewer's own BEM: a Leitung's is run by the Träger.
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return { id: startBem(useDb(), admin, scope, id) }
})
