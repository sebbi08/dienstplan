import { getReminderSettings } from '../services/reminderSettings'

/** The reminder settings of the facility the manager works in, with each group's documentation setting. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  return getReminderSettings(useDb(), admin.facilityId)
})
