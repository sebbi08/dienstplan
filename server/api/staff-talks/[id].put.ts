import { idParams, staffTalkHeaderSchema } from '../../schemas'
import { updateTalk } from '../../services/staffTalks'

/** Changes date, time, participants and period of a talk. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'talks.manage')
  // Never the manager's own talks: those are held by the Träger or another Leitung.
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, staffTalkHeaderSchema.parse)
  updateTalk(useDb(), scope, id, body)
  return { ok: true }
})
