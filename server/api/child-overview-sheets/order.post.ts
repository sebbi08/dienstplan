import { idOrderSchema } from '../../schemas'
import { reorderOverviewSheets } from '../../services/childOverviewSheets'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  const { ids } = await readValidatedBody(event, idOrderSchema.parse)
  reorderOverviewSheets(useDb(), admin.facilityId, ids)
  return { ok: true }
})
