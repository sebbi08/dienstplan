import { assertUploadLength, parseUploadParts } from '../../lib/documentHttp'
import { printTemplateFields } from '../../schemas'
import { uploadTemplate } from '../../services/printTemplates'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  // Reject before the body is read into memory.
  assertUploadLength(getRequestHeader(event, 'content-length'))
  const { file, fields } = parseUploadParts((await readMultipartFormData(event)) ?? [], printTemplateFields)
  return { id: uploadTemplate(useDb(), admin, fields, file) }
})
