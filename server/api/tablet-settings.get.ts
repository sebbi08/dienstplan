import { getTabletSettings } from '../services/tabletSettings'

/** The tablet settings of the facility the manager works in. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  return getTabletSettings(useDb(), admin.facilityId)
})
