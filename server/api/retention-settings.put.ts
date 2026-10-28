import type { RetentionSettings } from '../../shared/domain/retention'
import { setRetentionSettings } from '../services/retentionSettings'

/**
 * The Träger sets the retention periods of the facility (on the settings pages: the one edited there); 400
 * retention_settings_invalid for invalid input. Answers the settings as stored.
 */
export default defineServiceHandler(async (event): Promise<RetentionSettings> => {
  const provider = await requirePermission(event, 'settings.retention')
  return setRetentionSettings(useDb(), provider.facilityId, await readBody(event))
})
