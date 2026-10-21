import { documentResponseHeaders } from '../../../lib/documentHttp'
import { idParams } from '../../../schemas'
import { readTemplateFile } from '../../../services/printTemplates'

export default defineServiceHandler(async (event) => {
  const reader = await requireTemplateReader(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const file = readTemplateFile(useDb(), reader.facilityId, id)
  // Shown in the browser (also at the tablet: a blank form, no child data), which prints it.
  setResponseHeaders(event, documentResponseHeaders(file, false))
  return file.data
})
