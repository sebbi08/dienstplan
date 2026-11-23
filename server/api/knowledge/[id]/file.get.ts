import { documentResponseHeaders } from '../../../lib/documentHttp'
import { idParams } from '../../../schemas'
import { readKnowledgeFile } from '../../../services/knowledge'

export default defineServiceHandler(async (event) => {
  // Like the print templates: no personal data, so also the facility's tablet without an unlock, in the active facility.
  const reader = await requirePermission(event, 'knowledge.view', { allowTerminal: true, facility: 'active' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const file = readKnowledgeFile(useDb(), await withHomeGroup(event, reader), id)
  // Shown in the browser, which prints it.
  setResponseHeaders(event, documentResponseHeaders(file, false))
  return file.data
})
