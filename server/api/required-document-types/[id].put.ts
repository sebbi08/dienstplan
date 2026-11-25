import { idParams, requiredDocumentTypeSchema } from '../../schemas'
import { updateRequiredType } from '../../services/requiredDocuments'

/** Changes a Pflichtdokument of the facility (its old and new folder usable by the editor). */
export default defineServiceHandler(async (event) => {
  const editor = await requirePermission(event, 'settings.facility')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  updateRequiredType(useDb(), editor, editor.facilityId, id, await readValidatedBody(event, requiredDocumentTypeSchema.parse))
  return { ok: true }
})
