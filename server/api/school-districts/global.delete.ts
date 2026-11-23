import { deleteSchoolDistrictList } from '../../services/schoolDistricts'

/** The Träger deletes the street list for all facilities. */
export default defineServiceHandler(async (event) => {
  await requirePermission(event, 'settings.otherFacility', { facility: 'none' })
  deleteSchoolDistrictList(useDb(), null)
  return { ok: true }
})
