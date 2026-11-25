import { requiredDocumentTypeSchema } from '../schemas'
import { createRequiredType } from '../services/requiredDocuments'

/** A new Pflichtdokument of the facility (in a folder the editor may use). */
export default defineServiceHandler(async (event) => {
  const editor = await requirePermission(event, 'settings.facility')
  return { id: createRequiredType(useDb(), editor, editor.facilityId, await readValidatedBody(event, requiredDocumentTypeSchema.parse)) }
})
