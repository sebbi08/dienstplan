import { groupColorSchema, idParams } from '../../../schemas'
import { setGroupColor } from '../../../services/groups'

/** The Leitung (or Träger) of the facility sets the colour of one of its groups in the year calendar (null = none). */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { color } = await readValidatedBody(event, groupColorSchema.parse)
  setGroupColor(useDb(), admin.facilityId, id, color)
  return { ok: true }
})
