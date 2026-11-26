import { requiredDocumentParams } from '../../../../schemas'
import { deleteInspection } from '../../../../services/requiredDocuments'

/** Removes the recorded inspection of a Pflichtdokument „nur Einsicht vermerken“ (a correction). */
export default defineServiceHandler(async (event) => {
  const actor = await requirePermission(event, 'employees.view')
  const { id, typeId } = await getValidatedRouterParams(event, requiredDocumentParams.parse)
  deleteInspection(useDb(), actor, actor.facilityId, id, typeId)
  return { ok: true }
})
