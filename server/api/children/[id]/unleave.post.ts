import { todayIso } from '../../../../shared/domain/dates'
import { childUnleaveSchema, idParams } from '../../../schemas'
import { unleaveChild } from '../../../services/children'

/**
 * Takes a leaving back. The body may be left out; `schoolStartDate` is the new school start a child needs whose
 * school start is already reached (400 school_start_required without it).
 */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { schoolStartDate } = await readValidatedBody(event, body => childUnleaveSchema.parse(body ?? {}))
  unleaveChild(useDb(), admin.facilityId, id, todayIso(), schoolStartDate)
  return { ok: true }
})
