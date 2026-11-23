import { listOverviewSheets } from '../../services/childOverviewSheets'

/** The facility's overview tabs for the settings; the overview itself brings them with its data. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  return listOverviewSheets(useDb(), admin.facilityId)
})
