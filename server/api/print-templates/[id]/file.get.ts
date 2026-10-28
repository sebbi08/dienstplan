import { documentResponseHeaders } from '../../../lib/documentHttp'
import { idParams } from '../../../schemas'
import { readTemplateFile } from '../../../services/printTemplates'

export default defineServiceHandler(async (event) => {
  // Blank forms, no child data: also the facility's tablet without an unlock and Mitarbeiter accounts (read only), always
  // in the active facility; each sees the categories of their level.
  const reader = await requirePermission(event, 'printTemplates.view', { allowTerminal: true, facility: 'active' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const file = readTemplateFile(useDb(), reader, id)
  // Shown in the browser (also at the tablet: a blank form, no child data), which prints it.
  setResponseHeaders(event, documentResponseHeaders(file, false))
  return file.data
})
