import { deleteSchoolDistrictList } from '../../services/schoolDistricts'

/** Deletes the facility's own street list (the Träger's list then applies again, if there is one). */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  deleteSchoolDistrictList(useDb(), admin.facilityId)
  return { ok: true }
})
