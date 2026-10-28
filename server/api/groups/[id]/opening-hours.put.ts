import { idParams, openingHoursBodySchema } from '../../../schemas'
import { getOpeningHours, setGroupOpeningHours } from '../../../services/openingHours'

/** The Leitung (or Träger) sets the own opening hours of one group of the facility (`hours: null` removes them). */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'closures.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { hours } = await readValidatedBody(event, openingHoursBodySchema.parse)
  const db = useDb()
  setGroupOpeningHours(db, admin.facilityId, id, hours)
  return getOpeningHours(db, admin.facilityId)
})
