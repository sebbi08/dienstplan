import { schoolDistrictListSchema } from '../../schemas'
import { saveSchoolDistrictList } from '../../services/schoolDistricts'

/** Saves the facility's own street list; it replaces the stored one as a whole. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  saveSchoolDistrictList(useDb(), admin, admin.facilityId, await readValidatedBody(event, schoolDistrictListSchema.parse))
  return { ok: true }
})
