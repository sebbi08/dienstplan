import { documentResponseHeaders } from '../../../../lib/documentHttp'
import { idParams } from '../../../../schemas'
import { accountSigner, readMySignRequestFile } from '../../../../services/signRequests'

/** The PDF to sign, as it was sent (only the own open request; 404 otherwise). */
export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const file = readMySignRequestFile(useDb(), accountSigner(user).employeeId, id)
  setResponseHeaders(event, documentResponseHeaders({ mimeType: 'application/pdf', fileName: file.fileName }, false))
  return file.data
})
