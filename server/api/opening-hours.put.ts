import { openingHoursBodySchema } from '../schemas'
import { getOpeningHours, setFacilityOpeningHours } from '../services/openingHours'

/**
 * The Leitung (or Träger) sets the opening hours of the active facility (`hours: null` removes them). Answers the
 * facility's hours and its groups' as they are afterwards.
 */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'closures.manage')
  const { hours } = await readValidatedBody(event, openingHoursBodySchema.parse)
  const db = useDb()
  setFacilityOpeningHours(db, admin.facilityId, hours)
  return getOpeningHours(db, admin.facilityId)
})
