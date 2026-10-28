import { getSchoolSettings } from '../services/schoolChildren'

/** The school cutoff of the facility the manager works in. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  return getSchoolSettings(useDb(), admin.facilityId)
})
