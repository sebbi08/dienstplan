import { z } from 'zod'
import { assertUploadLength, parseUploadParts } from '../../lib/documentHttp'
import { parseSchoolDistrictFile } from '../../services/schoolDistricts'

/**
 * Reads an uploaded street list (CSV or PDF, at most 10 MB) into rows for the preview of the settings; nothing is saved.
 * The file is untrusted: a PDF is read in a worker with time and memory limits.
 */
export default defineServiceHandler(async (event) => {
  await requirePermission(event, 'settings.facility')
  // Reject before the body is read into memory.
  assertUploadLength(getRequestHeader(event, 'content-length'))
  const { file } = parseUploadParts((await readMultipartFormData(event)) ?? [], z.object({}))
  return parseSchoolDistrictFile(file)
})
