import { checkpointWal } from '../../../db/client'
import { idParams } from '../../../schemas'
import { deleteEntry } from '../../../services/cashEntries'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  // A receipt deleted along must not linger in the write-ahead log either.
  if (deleteEntry(useDb(), admin, admin.facilityId, id)) checkpointWal(useSqlite())
  return { ok: true }
})
