import { documentResponseHeaders } from '../../../../lib/documentHttp'
import { idParams } from '../../../../schemas'
import { readMySignRequestFile } from '../../../../services/signRequests'
import { tabletSigner } from '../../../../services/signUnlock'

/** The PDF to sign, for the person who unlocked the tablet for signing (only their own open request). */
export default defineServiceHandler(async (event) => {
  const terminal = await requireTerminal(event)
  const signer = tabletSigner(useDb(), terminal, await signUnlockToken(event))
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const file = readMySignRequestFile(useDb(), signer, id)
  setResponseHeaders(event, documentResponseHeaders({ mimeType: 'application/pdf', fileName: file.fileName }, false))
  return file.data
})
