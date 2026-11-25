import { documentResponseHeaders } from '../../lib/documentHttp'
import { fileQuery, idParams } from '../../schemas'
import { readVisitDocumentFile } from '../../services/visits'

/** The file of a visit's document (an info visit's needs visits.manage, checked by the service); `?download=1` saves it. */
export default defineServiceHandler(async (event) => {
  const actor = await requirePermission(event, 'visits.applicants.view')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const query = await getValidatedQuery(event, fileQuery.parse)
  const file = readVisitDocumentFile(useDb(), actor, id)
  setResponseHeaders(event, documentResponseHeaders(file, query.download === '1'))
  return file.data
})
