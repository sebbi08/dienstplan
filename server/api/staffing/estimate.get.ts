import type { StaffingEstimatesDto } from '../../../shared/types/api'
import { staffingEstimate } from '../../services/staffingEstimate'

/**
 * The Personalschlüssel at full occupancy per group and for the facility, with this month's Soll („Aktuell“), for the
 * group settings of the facility the manager works in (Leitung and Träger, like the groups and their Gruppenart).
 */
export default defineServiceHandler(async (event): Promise<StaffingEstimatesDto> => {
  const admin = await requirePermission(event, 'settings.facility')
  return staffingEstimate(useDb(), admin.facilityId)
})
