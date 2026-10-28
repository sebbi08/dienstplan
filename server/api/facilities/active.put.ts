import { activeFacilitySchema } from '../../schemas'
import { setActiveFacility } from '../../services/facilities'

export default defineServiceHandler(async (event) => {
  const user = await requirePermission(event, 'facilities.manage', { facility: 'none' })
  const { facilityId } = await readValidatedBody(event, activeFacilitySchema.parse)
  setActiveFacility(useDb(), user, facilityId)
  return { ok: true }
})
