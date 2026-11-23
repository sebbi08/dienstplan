import { z } from 'zod'
import { SCHOOL_DISTRICT_LIMITS } from '../../../shared/domain/schoolDistricts'
import { assertUploadLength, parseUploadParts, readUploadParts } from '../../lib/documentHttp'
import { parseSchoolDistrictFile } from '../../services/schoolDistricts'

/**
 * Reads an uploaded street list (CSV or PDF, at most 10 MB – lower than other uploads, so a PDF stays inside the reading
 * process's memory budget) into rows for the preview of the settings; nothing is saved. The file is untrusted: a PDF
 * is read in a separate process with time and memory limits.
 */
export default defineServiceHandler(async (event) => {
  await requirePermission(event, 'settings.facility')
  // Reject before the body is read into memory.
  assertUploadLength(getRequestHeader(event, 'content-length'), SCHOOL_DISTRICT_LIMITS.maxBytes, 'school_district_file_too_large')
  const parts = await readUploadParts(event, SCHOOL_DISTRICT_LIMITS.maxBytes, 'school_district_file_too_large')
  const { file } = parseUploadParts(parts, z.object({}))
  return parseSchoolDistrictFile(file)
})
