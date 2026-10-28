import { getAttendanceSettings } from '../services/childAttendance'

/** The attendance settings of the facility the manager works in. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  return getAttendanceSettings(useDb(), admin.facilityId)
})
