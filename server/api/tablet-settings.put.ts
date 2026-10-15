import { tabletSettingsSchema } from '../schemas'
import { getTabletSettings, setTabletSettings } from '../services/tabletSettings'

/** The Leitung or Träger sets the tablet settings of the facility they work in; answers them as they are afterwards. */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  setTabletSettings(useDb(), admin.facilityId, await readValidatedBody(event, tabletSettingsSchema.parse))
  return getTabletSettings(useDb(), admin.facilityId)
})
