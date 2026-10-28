import type { GermanState } from '../../../shared/domain/states'
import { facilityUpdateSchema, idParams } from '../../schemas'
import { facilityHolidayRules } from '../../services/holidayRules'
import { updateFacility } from '../../services/facilities'

export default defineServiceHandler(async (event) => {
  const user = await requirePermission(event, 'facilities.manage', { facility: 'none' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, facilityUpdateSchema.parse)
  const db = useDb()
  // Left out = as stored, so a plain rename never changes the holidays.
  const stored = facilityHolidayRules(db, id)
  updateFacility(db, user, id, {
    name: body.name,
    state: (body.state ?? stored.state) as GermanState,
    assumptionDay: body.assumptionDay ?? stored.assumptionDay,
  })
  return { ok: true }
})
