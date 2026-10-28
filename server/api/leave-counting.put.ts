import type { LeaveCountingDto } from '../../shared/types/api'
import { leaveCountingSchema } from '../schemas'
import { setLeaveCounting } from '../services/leaveCounting'

/**
 * The Träger sets whether 24 and 31 December count as half a leave day in the facility (on the settings pages: the one
 * edited there); answers the setting as stored.
 */
export default defineServiceHandler(async (event): Promise<LeaveCountingDto> => {
  const provider = await requirePermission(event, 'leave.configure')
  return setLeaveCounting(useDb(), provider.facilityId, await readValidatedBody(event, leaveCountingSchema.parse))
})
