import { fileQuery, idParams } from '../../../schemas'
import { readDocumentFile } from '../../../services/childDocuments'

export default defineServiceHandler(async (event) => {
  const viewer = await requireChildReader(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const query = await getValidatedQuery(event, fileQuery.parse)
  const file = readDocumentFile(useDb(), viewer, viewer.facilityId, id)
  setResponseHeaders(event, {
    'Content-Type': file.mimeType,
    'Content-Disposition': `${query.download ? 'attachment' : 'inline'}; filename="${file.fileName}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  })
  return file.data
})
