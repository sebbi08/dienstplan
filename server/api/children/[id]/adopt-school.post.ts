import { todayIso } from '../../../../shared/domain/dates'
import { adoptDistrictSchoolSchema, idParams } from '../../../schemas'
import { adoptDistrictSchool } from '../../../services/children'

/** „Übernehmen“: the school of the child's school district becomes its „künftige Schule“ (only while it has none). */
export default defineServiceHandler(async (event) => {
  const actor = await requireChildPermission(event, 'children.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { contactId } = await readValidatedBody(event, adoptDistrictSchoolSchema.parse)
  adoptDistrictSchool(useDb(), actor, actor.facilityId, id, contactId, todayIso())
  return { ok: true }
})
