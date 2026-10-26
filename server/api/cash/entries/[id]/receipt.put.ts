import { checkpointWal } from '../../../../db/client'
import { assertUploadLength, parseUploadParts } from '../../../../lib/documentHttp'
import { idParams, noFields } from '../../../../schemas'
import { setReceipt } from '../../../../services/cashReceipts'

/** Attaches or replaces the receipt (JPG, PNG, PDF) of an entry of the active facility (both rows of a transfer). */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  // Reject before the body is read into memory.
  assertUploadLength(getRequestHeader(event, 'content-length'))
  const { file } = parseUploadParts((await readMultipartFormData(event)) ?? [], noFields)
  const receiptId = setReceipt(useDb(), admin, admin.facilityId, id, file)
  // A replaced receipt must not linger in the write-ahead log either.
  checkpointWal(useSqlite())
  return { receiptId }
})
