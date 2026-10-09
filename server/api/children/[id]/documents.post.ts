import { todayIso } from '../../../../shared/domain/dates'
import { assertUploadLength, parseUploadForm } from '../../../lib/documentHttp'
import { idParams } from '../../../schemas'
import { uploadDocument } from '../../../services/childDocuments'

export default defineServiceHandler(async (event) => {
  const actor = await requireChildEditor(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  // Reject before the body is read into memory.
  assertUploadLength(getRequestHeader(event, 'content-length'))
  const { file, meta } = parseUploadForm((await readMultipartFormData(event)) ?? [])
  return { id: uploadDocument(useDb(), actor, actor.facilityId, id, meta, file, todayIso()) }
})
