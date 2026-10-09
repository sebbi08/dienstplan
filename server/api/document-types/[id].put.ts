import { documentTypeSchema, idParams } from '../../schemas'
import { updateDocumentType } from '../../services/documentTypes'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return updateDocumentType(useDb(), admin.facilityId, id, await readValidatedBody(event, documentTypeSchema.parse))
})
