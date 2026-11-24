import { assertUploadLength, parseOptionalUploadParts, readUploadParts } from '../../lib/documentHttp'
import { signRequestFields } from '../../schemas'
import { createSignRequest } from '../../services/signRequests'

/**
 * „Zum Unterschreiben senden“: the fields as multipart text, optionally the PDF as filled in before sending (else the
 * template or document as it is). The service checks the source, the folder, the recipients and the file.
 */
export default defineServiceHandler(async (event) => {
  const sender = await requirePermission(event, 'signRequests.manage', { facility: 'active' })
  // Reject before the body is read into memory.
  assertUploadLength(getRequestHeader(event, 'content-length'))
  const { file, fields } = parseOptionalUploadParts(await readUploadParts(event), signRequestFields)
  const { recipients, ...rest } = fields
  return { id: createSignRequest(useDb(), await withHomeGroup(event, sender), { ...rest, recipientIds: recipients }, file?.data ?? null) }
})
