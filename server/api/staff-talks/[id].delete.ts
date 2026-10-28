import { idParams } from '../../schemas'
import { deleteTalk } from '../../services/staffTalks'

/** Deletes a talk with all its forms. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'talks.manage')
  // Never the manager's own talks: those are held by the Träger or another Leitung.
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteTalk(useDb(), scope, id)
  return { ok: true }
})
