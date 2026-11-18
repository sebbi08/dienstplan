import { documentDownload, documentResponseHeaders } from '../../../lib/documentHttp'
import { fileQuery, idParams } from '../../../schemas'
import { readChildAccidentAttachment } from '../../../services/accidents'

/** An attachment of a child's accident report; at the tablet only for the in-app viewer, never as a download. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.view')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const query = await getValidatedQuery(event, fileQuery.parse)
  // Decided before the file is read: at the tablet only the in-app viewer gets it.
  const download = documentDownload(viewer, query.download === '1', getHeader(event, 'sec-fetch-dest'))
  const file = readChildAccidentAttachment(useDb(), viewer, id)
  setResponseHeaders(event, documentResponseHeaders(file, download))
  return file.data
})
