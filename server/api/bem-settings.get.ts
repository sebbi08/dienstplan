import type { BemSettingsDto } from '../../shared/types/api'
import { getBemSettings } from '../services/bem'

/** The text of the BEM invitation (Leitung and Träger; on the settings pages: the facility edited there). */
export default defineServiceHandler(async (event): Promise<BemSettingsDto> => {
  const admin = await requirePermission(event, 'settings.facility')
  return getBemSettings(useDb(), admin.facilityId)
})
