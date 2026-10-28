import { todayIso } from '../../../shared/domain/dates'
import { childDocumentSchema, idParams } from '../../schemas'
import { updateDocument } from '../../services/childDocuments'

export default defineServiceHandler(async (event) => {
  const actor = await requireChildPermission(event, 'children.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, childDocumentSchema.parse)
  updateDocument(useDb(), actor, actor.facilityId, id, body, todayIso())
  return { ok: true }
})
