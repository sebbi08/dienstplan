import { todayIso } from '../../../../shared/domain/dates'
import { childUnleaveSchema, idParams } from '../../../schemas'
import { unleaveChild } from '../../../services/children'

/**
 * Takes a leaving back. The body may be left out; `schoolStartDate` is the new school start a child needs that the
 * facility's automatic leaving would deregister again at once (400 school_start_required without it).
 */
export default defineServiceHandler(async (event) => {
  const manager = await requireChildManager(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { schoolStartDate } = await readValidatedBody(event, body => childUnleaveSchema.parse(body ?? {}))
  unleaveChild(useDb(), manager.facilityId, id, todayIso(), schoolStartDate)
  return { ok: true }
})
