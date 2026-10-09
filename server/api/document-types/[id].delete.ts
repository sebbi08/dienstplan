import { idParams } from '../../schemas'
import { deleteDocumentType } from '../../services/documentTypes'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteDocumentType(useDb(), admin.facilityId, id)
  return { ok: true }
})
