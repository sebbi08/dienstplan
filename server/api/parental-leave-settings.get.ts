import type { ParentalLeaveSettingsDto } from '../../shared/types/api'
import { getParentalLeaveSettings } from '../services/parentalLeave'

/** „Elternzeit für alle sichtbar anzeigen“ of the facility (whoever sees the contract data). */
export default defineServiceHandler(async (event): Promise<ParentalLeaveSettingsDto> => {
  const admin = await requirePermission(event, 'employees.contractView')
  return getParentalLeaveSettings(useDb(), admin, admin.facilityId)
})
