import { checkpointWal } from '../../../../db/client'
import { idParams } from '../../../../schemas'
import { removeReceipt } from '../../../../services/cashReceipts'

/** Removes the receipt of an entry of the active facility (both rows of a transfer). */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  removeReceipt(useDb(), admin, admin.facilityId, id)
  // The removed receipt must not linger in the write-ahead log either.
  checkpointWal(useSqlite())
  return { ok: true }
})
