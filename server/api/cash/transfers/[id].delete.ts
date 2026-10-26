import { checkpointWal } from '../../../db/client'
import { idParams } from '../../../schemas'
import { deleteTransfer } from '../../../services/cashEntries'

/** Deletes both rows of a transfer; `id` is its expense row's id. */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  // A receipt deleted along must not linger in the write-ahead log either.
  if (deleteTransfer(useDb(), admin, admin.facilityId, id)) checkpointWal(useSqlite())
  return { ok: true }
})
