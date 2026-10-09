import { documentResponseHeaders } from '../../../lib/documentHttp'
import { fileQuery, idParams } from '../../../schemas'
import { readDocumentFile } from '../../../services/childDocuments'

export default defineServiceHandler(async (event) => {
  const viewer = await requireChildReader(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const query = await getValidatedQuery(event, fileQuery.parse)
  const file = readDocumentFile(useDb(), viewer, viewer.facilityId, id)
  setResponseHeaders(event, documentResponseHeaders(file, query.download === '1'))
  return file.data
})
