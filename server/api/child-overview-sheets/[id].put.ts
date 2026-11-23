import { idParams, overviewSheetSchema } from '../../schemas'
import { updateOverviewSheet } from '../../services/childOverviewSheets'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return updateOverviewSheet(useDb(), admin.facilityId, id, await readValidatedBody(event, overviewSheetSchema.parse))
})
