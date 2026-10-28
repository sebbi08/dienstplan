import { docSettingsSchema, idParams } from '../../../schemas'
import { setGroupDocSettings } from '../../../services/reminderSettings'

/** The Leitung (or Träger) of the facility sets the development documentation reminder of one of its groups. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  setGroupDocSettings(useDb(), admin.facilityId, id, await readValidatedBody(event, docSettingsSchema.parse))
  return { ok: true }
})
