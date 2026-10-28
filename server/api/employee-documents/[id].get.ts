import { documentResponseHeaders } from '../../lib/documentHttp'
import { fileQuery, idParams } from '../../schemas'
import { readEmployeeDocumentFile } from '../../services/employeeDocuments'

/** The file of a personnel file document: shown in the browser (inline), saved with `?download=1`. */
export default defineServiceHandler(async (event) => {
  const actor = await requirePermission(event, 'employees.view')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const query = await getValidatedQuery(event, fileQuery.parse)
  const file = readEmployeeDocumentFile(useDb(), actor, actor.facilityId, id)
  setResponseHeaders(event, documentResponseHeaders(file, query.download === '1'))
  return file.data
})
