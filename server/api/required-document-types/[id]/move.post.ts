import { idParams, requiredDocumentMoveSchema } from '../../../schemas'
import { moveRequiredType } from '../../../services/requiredDocuments'

/** ▲/▼: a Pflichtdokument one place up or down in the facility's list. */
export default defineServiceHandler(async (event) => {
  const editor = await requirePermission(event, 'settings.facility')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { direction } = await readValidatedBody(event, requiredDocumentMoveSchema.parse)
  moveRequiredType(useDb(), editor, editor.facilityId, id, direction)
  return { ok: true }
})
