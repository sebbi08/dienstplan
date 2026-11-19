import type { ChildSickSettingsDto } from '../../shared/types/api'
import { childSickSettingsSchema } from '../schemas'
import { setChildSickSettings } from '../services/employeeChildren'

/** Only the Träger changes the values for the Kinderkrankentage (for all facilities); answers them as stored. */
export default defineServiceHandler(async (event): Promise<ChildSickSettingsDto> => {
  await requirePermission(event, 'settings.absenceCodes')
  return setChildSickSettings(useDb(), await readValidatedBody(event, childSickSettingsSchema.parse))
})
