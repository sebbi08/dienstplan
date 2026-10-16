import { getAttendanceSettings } from '../services/childAttendance'

/** The attendance settings of the facility the manager works in. */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  return getAttendanceSettings(useDb(), admin.facilityId)
})
