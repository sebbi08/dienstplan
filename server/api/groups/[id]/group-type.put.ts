import { groupTypeSchema, idParams } from '../../../schemas'
import { setGroupType } from '../../../services/groups'

/** The Leitung (or Träger) of the facility sets the group type (Gruppenart) of one of its groups (null = none). */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { groupType } = await readValidatedBody(event, groupTypeSchema.parse)
  setGroupType(useDb(), admin.facilityId, id, groupType)
  return { ok: true }
})
