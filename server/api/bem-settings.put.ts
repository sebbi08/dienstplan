import type { BemSettingsDto } from '../../shared/types/api'
import { bemSettingsSchema } from '../schemas'
import { setBemSettings } from '../services/bem'

/** Leitung and Träger set the text of the BEM invitation (empty: the default text); answers it as stored. */
export default defineServiceHandler(async (event): Promise<BemSettingsDto> => {
  const admin = await requirePermission(event, 'settings.facility')
  return setBemSettings(useDb(), admin.facilityId, await readValidatedBody(event, bemSettingsSchema.parse))
})
