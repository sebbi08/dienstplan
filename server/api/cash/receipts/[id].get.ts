import { documentResponseHeaders } from '../../../lib/documentHttp'
import { idParams } from '../../../schemas'
import { readReceipt } from '../../../services/cashReceipts'

/** A receipt of the active facility, shown in the browser (inline) or, with `?download=1`, saved. */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const file = readReceipt(useDb(), admin.facilityId, id)
  setResponseHeaders(event, documentResponseHeaders(file, getQuery(event).download === '1'))
  return file.data
})
