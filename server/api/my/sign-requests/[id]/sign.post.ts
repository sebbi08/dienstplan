import { assertUploadLength, parseUploadParts, readUploadParts } from '../../../../lib/documentHttp'
import { idParams, noFields } from '../../../../schemas'
import { accountSigner, signMyRequest } from '../../../../services/signRequests'

/** „Unterschreiben“ with the own account: the signed PDF goes into the personnel file (the request's folder). */
export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  const signer = accountSigner(user)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  assertUploadLength(getRequestHeader(event, 'content-length'))
  const { file } = parseUploadParts(await readUploadParts(event), noFields)
  const { documentId } = signMyRequest(useDb(), signer, id, file.data)
  return { documentId }
})
