import { assertUploadLength, parseUploadParts } from '../../../lib/documentHttp'
import { attachmentFields, formIdParams } from '../../../schemas'
import { addEmployeeAccidentAttachment } from '../../../services/accidents'

/** Attaches a photo or PDF to an employee's accident report; the service checks the edit right and the file. */
export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  // Reject before the body is read into memory.
  assertUploadLength(getRequestHeader(event, 'content-length'))
  const { file } = parseUploadParts((await readMultipartFormData(event)) ?? [], attachmentFields)
  return { id: addEmployeeAccidentAttachment(useDb(), accidentActor(event, user), formId, file) }
})
