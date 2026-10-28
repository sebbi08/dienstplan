import { attendanceSettingsSchema } from '../schemas'
import { getAttendanceSettings, setAttendanceSettings } from '../services/childAttendance'

/** The Leitung or Träger sets the attendance settings of the facility they work in; answers them as they are afterwards. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  setAttendanceSettings(useDb(), admin.facilityId, await readValidatedBody(event, attendanceSettingsSchema.parse))
  return getAttendanceSettings(useDb(), admin.facilityId)
})
