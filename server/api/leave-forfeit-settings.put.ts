import type { LeaveForfeitSettingsDto } from '../../shared/types/api'
import { leaveForfeitSettingsSchema } from '../schemas'
import { setLeaveForfeitSettings } from '../services/leaveForfeit'

/** Leitung and Träger set the forfeiture date and text of the notice on remaining leave; answers them as stored. */
export default defineServiceHandler(async (event): Promise<LeaveForfeitSettingsDto> => {
  const admin = await requirePermission(event, 'settings.facility')
  return setLeaveForfeitSettings(useDb(), admin.facilityId, await readValidatedBody(event, leaveForfeitSettingsSchema.parse))
})
