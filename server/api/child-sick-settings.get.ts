import type { ChildSickSettingsDto } from '../../shared/types/api'
import { getChildSickSettings } from '../services/employeeChildren'

/** The Träger's values for the Kinderkrankentage (one setting for all facilities); the Leitung reads them. */
export default defineServiceHandler(async (event): Promise<ChildSickSettingsDto> => {
  await requirePermission(event, 'settings.facility')
  return getChildSickSettings(useDb())
})
