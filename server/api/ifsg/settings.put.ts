import { ifsgSettingsSchema } from '../../schemas'
import { getIfsgSettings, setIfsgSettings } from '../../services/ifsg'

/** Leitung or Träger set the facility's § 34 IfSG setting; answers it as it is afterwards. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  setIfsgSettings(useDb(), admin.facilityId, await readValidatedBody(event, ifsgSettingsSchema.parse))
  return getIfsgSettings(useDb(), admin.facilityId)
})
