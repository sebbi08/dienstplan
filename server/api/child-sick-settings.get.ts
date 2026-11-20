import { todayIso } from '../../shared/domain/dates'
import type { ChildSickSettingsDto } from '../../shared/types/api'
import { getChildSickSettings } from '../services/employeeChildren'

/** The values for the Kinderkrankentage as of today (one setting for all facilities); the Leitung reads them. */
export default defineServiceHandler(async (event): Promise<ChildSickSettingsDto> => {
  await requirePermission(event, 'settings.facility')
  return getChildSickSettings(useDb(), todayIso())
})
