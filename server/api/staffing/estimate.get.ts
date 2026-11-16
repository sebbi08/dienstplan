import { can } from '../../../shared/domain/permissions'
import type { StaffingEstimatesDto } from '../../../shared/types/api'
import { staffingEstimate } from '../../services/staffingEstimate'

/**
 * The Personalschlüssel at full occupancy per group and for the facility, for the group settings of the facility the
 * manager works in (Leitung and Träger, like the groups and their Gruppenart). This month's Soll („Aktuell“) and the
 * enrolled children only for whoever may see the monthly tab (plan.staffing).
 */
export default defineServiceHandler(async (event): Promise<StaffingEstimatesDto> => {
  const admin = await requirePermission(event, 'settings.facility')
  return staffingEstimate(useDb(), admin.facilityId, { withCurrent: can(admin.permissions, 'plan.staffing') })
})
