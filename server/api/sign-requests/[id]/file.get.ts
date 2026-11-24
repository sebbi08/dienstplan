import { documentResponseHeaders } from '../../../lib/documentHttp'
import { idParams } from '../../../schemas'
import { readSignRequestFile } from '../../../services/signRequests'

/** The PDF of a request as it was sent (shown in the browser). */
export default defineServiceHandler(async (event) => {
  const sender = await requirePermission(event, 'signRequests.manage', { facility: 'active' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const file = readSignRequestFile(useDb(), await withHomeGroup(event, sender), id)
  setResponseHeaders(event, documentResponseHeaders({ mimeType: 'application/pdf', fileName: file.fileName }, false))
  return file.data
})
