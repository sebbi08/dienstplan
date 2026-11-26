import { todayIso } from '../../../../../shared/domain/dates'
import { requiredDocumentParams, requiredInspectionSchema } from '../../../../schemas'
import { recordInspection } from '../../../../services/requiredDocuments'

/** „Einsicht vermerken“ of a Pflichtdokument „nur Einsicht vermerken“ (§ 72a Abs. 5 SGB VIII): the day and the box, no file. */
export default defineServiceHandler(async (event) => {
  const actor = await requirePermission(event, 'employees.view')
  const { id, typeId } = await getValidatedRouterParams(event, requiredDocumentParams.parse)
  recordInspection(useDb(), actor, actor.facilityId, id, typeId, await readValidatedBody(event, requiredInspectionSchema.parse), todayIso())
  return { ok: true }
})
