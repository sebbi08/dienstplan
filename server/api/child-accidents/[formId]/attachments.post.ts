import { assertUploadLength, parseUploadParts, readUploadParts } from '../../../lib/documentHttp'
import { attachmentFields, formIdParams } from '../../../schemas'
import { addChildAccidentAttachment } from '../../../services/accidents'

/** Attaches a photo or PDF to an accident report; the service checks the edit right and the file (400/413). */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.attendance')
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  // Reject before the body is read into memory.
  assertUploadLength(getRequestHeader(event, 'content-length'))
  const { file } = parseUploadParts(await readUploadParts(event), attachmentFields)
  return { id: addChildAccidentAttachment(useDb(), viewer, formId, file) }
})
