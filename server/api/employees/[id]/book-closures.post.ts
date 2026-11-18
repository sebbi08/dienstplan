import { idParams } from '../../../schemas'
import { bookMissingClosures } from '../../../services/employees'

/** „Schließzeiten nachtragen“: the facility's closures from the first weekly hours on, in empty days only. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'time.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return { booked: bookMissingClosures(useDb(), admin, admin.facilityId, id) }
})
