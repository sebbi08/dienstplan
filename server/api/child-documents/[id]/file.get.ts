import { documentDownload, documentResponseHeaders } from '../../../lib/documentHttp'
import { fileQuery, idParams } from '../../../schemas'
import { readDocumentFile } from '../../../services/childDocuments'

export default defineServiceHandler(async (event) => {
  const viewer = await requireChildReader(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const query = await getValidatedQuery(event, fileQuery.parse)
  // Decided before the file is read: at the tablet only the in-app viewer gets it, never as a download.
  const download = documentDownload(viewer, query.download === '1', getHeader(event, 'sec-fetch-dest'))
  const file = readDocumentFile(useDb(), viewer, viewer.facilityId, id)
  setResponseHeaders(event, documentResponseHeaders(file, download))
  return file.data
})
