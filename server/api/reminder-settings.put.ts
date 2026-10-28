import { reminderSettingsSchema } from '../schemas'
import { getReminderSettings, setReminderSettings } from '../services/reminderSettings'

/** The Leitung or Träger sets the reminder settings of the facility they work in; answers them as they are afterwards. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  setReminderSettings(useDb(), admin.facilityId, await readValidatedBody(event, reminderSettingsSchema.parse))
  return getReminderSettings(useDb(), admin.facilityId)
})
