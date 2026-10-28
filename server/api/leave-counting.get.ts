import type { LeaveCountingDto } from '../../shared/types/api'
import { getLeaveCounting } from '../services/leaveCounting'

/** How the facility counts 24 and 31 December as leave (the Träger on the settings pages: the facility edited there). */
export default defineServiceHandler(async (event): Promise<LeaveCountingDto> => {
  const admin = await requirePermission(event, 'settings.facility')
  return getLeaveCounting(useDb(), admin.facilityId)
})
