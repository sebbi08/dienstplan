import type { RetentionSettings } from '../../shared/domain/retention'
import { getRetentionSettings } from '../services/retentionSettings'

/** The retention periods of the facility the manager works in (the Träger on the settings pages: the one edited there). */
export default defineServiceHandler(async (event): Promise<RetentionSettings> => {
  const admin = await requirePermission(event, 'settings.facility')
  return getRetentionSettings(useDb(), admin.facilityId)
})
