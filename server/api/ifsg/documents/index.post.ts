import { assertUploadLength, parseUploadParts } from '../../../lib/documentHttp'
import { ifsgDocumentFields } from '../../../schemas'
import { uploadIfsgDocument } from '../../../services/ifsgLocal'

/** Uploads a document of the health office (PDF/JPG/PNG, multipart: `file`, `title`); Leitung and Träger. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  // Reject before the body is read into memory.
  assertUploadLength(getRequestHeader(event, 'content-length'))
  const { file, fields } = parseUploadParts((await readMultipartFormData(event)) ?? [], ifsgDocumentFields)
  return { id: uploadIfsgDocument(useDb(), { id: admin.id, facilityId: admin.facilityId }, fields.title, file) }
})
