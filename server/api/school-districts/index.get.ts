import { withProviderSchools } from '../../services/contacts'
import { schoolDistrictSettings } from '../../services/schoolDistricts'

/** The settings „Schulbezirke“ of the facility: its own street list, the Träger's for all facilities, the schools to map. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  return schoolDistrictSettings(useDb(), admin.facilityId, withProviderSchools(admin))
})
