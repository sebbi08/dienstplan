import { overviewSheetSchema } from '../../schemas'
import { createOverviewSheet } from '../../services/childOverviewSheets'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  return createOverviewSheet(useDb(), admin.facilityId, await readValidatedBody(event, overviewSheetSchema.parse))
})
