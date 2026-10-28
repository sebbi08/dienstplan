import type { StaffingSettingsDto } from '../../shared/types/api'
import { staffingOverridesSchema } from '../schemas'
import { setStaffingOverrides } from '../services/staffing'

/** The Träger replaces the staffing overrides of the active facility; answers the settings as they are afterwards. */
export default defineServiceHandler(async (event): Promise<StaffingSettingsDto> => {
  const provider = await requirePermission(event, 'settings.staffing')
  const { overrides } = await readValidatedBody(event, staffingOverridesSchema.parse)
  return setStaffingOverrides(useDb(), provider, provider.facilityId, overrides)
})
