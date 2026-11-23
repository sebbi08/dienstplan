import { schoolDistrictListSchema } from '../../schemas'
import { saveSchoolDistrictList } from '../../services/schoolDistricts'

/** The Träger saves the street list for all facilities (a facility's own list wins over it); it replaces the stored one. */
export default defineServiceHandler(async (event) => {
  const provider = await requirePermission(event, 'settings.otherFacility', { facility: 'none' })
  saveSchoolDistrictList(useDb(), provider, null, await readValidatedBody(event, schoolDistrictListSchema.parse))
  return { ok: true }
})
