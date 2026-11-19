import { assertUploadLength } from '../../../../lib/documentHttp'
import { ServiceError } from '../../../../lib/errors'
import { idParams, ifsgReadmitFields } from '../../../../schemas'
import { readmitIfsgCase } from '../../../../services/ifsg'

/**
 * „Ärztliche Wiederzulassung liegt vor“ (multipart: readmittedOn, note, confirmEarly and an optional `file`, the attest
 * as photo or PDF); the service lets the child's own group and the managers.
 */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.attendance')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  // Reject before the body is read into memory.
  assertUploadLength(getRequestHeader(event, 'content-length'))
  const parts = (await readMultipartFormData(event)) ?? []
  const file = parts.find(part => part.name === 'file' && part.filename !== undefined && part.data.length > 0)
  const fields = ifsgReadmitFields.safeParse(Object.fromEntries(parts
    .filter(part => part.filename === undefined && part.name !== undefined)
    .map(part => [part.name, part.data.toString('utf8')])))
  if (!fields.success) throw new ServiceError(400, 'invalid_input')
  readmitIfsgCase(useDb(), viewer, id, fields.data, file ? { data: file.data } : null)
  return { ok: true }
})
