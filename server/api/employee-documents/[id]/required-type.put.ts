import { idParams, requiredDocumentLinkSchema } from '../../../schemas'
import { linkRequiredDocument } from '../../../services/requiredDocuments'

/** „Vorhandenes Dokument zuordnen“ (or the link removed): the document becomes a Pflichtdokument of its folder. */
export default defineServiceHandler(async (event) => {
  const actor = await requirePermission(event, 'employees.view')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { typeId } = await readValidatedBody(event, requiredDocumentLinkSchema.parse)
  linkRequiredDocument(useDb(), actor, actor.facilityId, id, typeId)
  return { ok: true }
})
