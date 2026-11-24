import { assertUploadLength, parseUploadParts, readUploadParts } from '../../../../lib/documentHttp'
import { idParams, noFields } from '../../../../schemas'
import { signMyRequest } from '../../../../services/signRequests'
import { lockSigning, tabletSigner } from '../../../../services/signUnlock'

/** „Unterschreiben“ at the tablet unlocked for signing: the signed PDF goes into the person's personnel file. */
export default defineServiceHandler(async (event) => {
  const terminal = await requireTerminal(event)
  const token = await signUnlockToken(event)
  tabletSigner(useDb(), terminal, token)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  assertUploadLength(getRequestHeader(event, 'content-length'))
  const { file } = parseUploadParts(await readUploadParts(event), noFields)
  // Checked again after the (possibly long) upload.
  const { documentId } = signMyRequest(useDb(), tabletSigner(useDb(), terminal, token), id, file.data)
  // Done: the tablet locks here too (not only when the page goes back to its start).
  lockSigning(useDb(), terminal.id, token)
  return { documentId }
})
