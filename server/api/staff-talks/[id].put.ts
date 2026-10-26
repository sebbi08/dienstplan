import { idParams, staffTalkHeaderSchema } from '../../schemas'
import { updateTalk } from '../../services/staffTalks'

/** Changes date, time, participants and period of a talk. */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, staffTalkHeaderSchema.parse)
  updateTalk(useDb(), admin.facilityId, id, body)
  return { ok: true }
})
