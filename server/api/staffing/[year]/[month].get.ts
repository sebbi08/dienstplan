import type { StaffingMonthDto } from '../../../../shared/types/api'
import { monthParams } from '../../../schemas'
import { staffingMonth } from '../../../services/staffingReport'

/** The Personalschlüssel tab of a month in the facility the manager works in (Leitung and Träger). */
export default defineServiceHandler(async (event): Promise<StaffingMonthDto> => {
  const admin = await requireAdmin(event)
  const { year, month } = await getValidatedRouterParams(event, monthParams.parse)
  return staffingMonth(useDb(), admin.facilityId, year, month)
})
