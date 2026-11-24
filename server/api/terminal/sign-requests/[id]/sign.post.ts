import { assertUploadLength, parseUploadParts, readUploadParts } from '../../../../lib/documentHttp'
import { idParams, noFields } from '../../../../schemas'
import { signMyRequest, tabletSigner } from '../../../../services/signRequests'

/** „Unterschreiben“ at the tablet unlocked by the person: the signed PDF goes into their personnel file. */
export default defineServiceHandler(async (event) => {
  const terminal = await requireTerminal(event)
  const signer = tabletSigner(useDb(), terminal, await childUnlockToken(event))
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  assertUploadLength(getRequestHeader(event, 'content-length'))
  const { file } = parseUploadParts(await readUploadParts(event), noFields)
  const { documentId } = signMyRequest(useDb(), signer, id, file.data)
  return { documentId }
})
