import { idParams, staffTalkHeaderSchema } from '../../../schemas'
import { reuseTalk } from '../../../services/staffTalks'

/** „Für ein weiteres Gespräch verwenden“: a new talk with the same employee and copies of this talk's forms. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'talks.manage')
  // Never the manager's own talks: those are held by the Träger or another Leitung.
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, staffTalkHeaderSchema.parse)
  return { id: reuseTalk(useDb(), admin, scope, id, body) }
})
