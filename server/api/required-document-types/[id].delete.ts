import { idParams } from '../../schemas'
import { deleteRequiredType } from '../../services/requiredDocuments'

/** Deletes a Pflichtdokument; its documents stay in the personnel files without the link. */
export default defineServiceHandler(async (event) => {
  const editor = await requirePermission(event, 'settings.facility')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteRequiredType(useDb(), editor, editor.facilityId, id)
  return { ok: true }
})
