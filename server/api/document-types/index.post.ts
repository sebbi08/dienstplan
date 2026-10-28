import { documentTypeSchema } from '../../schemas'
import { createDocumentType } from '../../services/documentTypes'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  return createDocumentType(useDb(), admin.facilityId, await readValidatedBody(event, documentTypeSchema.parse))
})
