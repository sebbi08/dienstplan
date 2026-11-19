import { checkpointWal } from '../../../db/client'
import { idParams } from '../../../schemas'
import { deleteIfsgDocument } from '../../../services/ifsgLocal'

/** Deletes a document of the health office; Leitung and Träger. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteIfsgDocument(useDb(), admin.facilityId, id)
  checkpointWal(useSqlite())
  return { ok: true }
})
