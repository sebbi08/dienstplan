import { templateSchema } from '../../schemas'
import { createTemplate } from '../../services/settings'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  return createTemplate(useDb(), admin.facilityId, await readValidatedBody(event, templateSchema.parse))
})
