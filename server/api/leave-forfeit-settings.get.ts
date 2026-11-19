import type { LeaveForfeitSettingsDto } from '../../shared/types/api'
import { getLeaveForfeitSettings } from '../services/leaveForfeit'

/** The forfeiture date and text of the notice on remaining leave (Leitung and Träger; on the settings pages: the facility edited there). */
export default defineServiceHandler(async (event): Promise<LeaveForfeitSettingsDto> => {
  const admin = await requirePermission(event, 'settings.facility')
  return getLeaveForfeitSettings(useDb(), admin.facilityId)
})
