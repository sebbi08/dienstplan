import { todayIso } from '../../../../shared/domain/dates'
import { confirmSectionSchema, idParams } from '../../../schemas'
import { confirmSection } from '../../../services/children'

/** Confirms a section of the record that was marked after a group change. */
export default defineServiceHandler(async (event) => {
  const actor = await requireChildPermission(event, 'children.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { section } = await readValidatedBody(event, confirmSectionSchema.parse)
  confirmSection(useDb(), actor, actor.facilityId, id, section, todayIso())
  return { ok: true }
})
