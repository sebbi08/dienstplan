import type { StaffingSettingsDto } from '../../shared/types/api'
import { getStaffingSettings } from '../services/staffing'

/** Einstellungen → Personalschlüssel of the facility the manager works in (the Leitung reads, the Träger also changes). */
export default defineServiceHandler(async (event): Promise<StaffingSettingsDto> => {
  const admin = await requirePermission(event, 'settings.facility')
  return getStaffingSettings(useDb(), admin, admin.facilityId)
})
