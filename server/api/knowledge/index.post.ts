import { assertUploadLength, parseOptionalUploadParts } from '../../lib/documentHttp'
import { knowledgeEntryFields } from '../../schemas'
import { createKnowledgeEntry } from '../../services/knowledge'

/** A new entry (multipart: the fields, and the PDF as `file` for a file entry). */
export default defineServiceHandler(async (event) => {
  const editor = await requirePermission(event, 'knowledge.manage', { facility: 'active' })
  // Reject before the body is read into memory.
  assertUploadLength(getRequestHeader(event, 'content-length'))
  const { file, fields } = parseOptionalUploadParts((await readMultipartFormData(event)) ?? [], knowledgeEntryFields)
  return { id: createKnowledgeEntry(useDb(), editor, fields, file) }
})
