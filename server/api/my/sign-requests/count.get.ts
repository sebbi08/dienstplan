import type { MySignRequestCountDto } from '../../../../shared/types/api'
import { mySignRequestCount } from '../../../services/signRequests'

/** How many requests the own employee still has to sign, and how many are overdue (0 without a linked employee). */
export default defineServiceHandler(async (event): Promise<MySignRequestCountDto> => {
  const user = await requireUser(event)
  return user.employeeId === null ? { count: 0, overdue: 0 } : mySignRequestCount(useDb(), user.employeeId)
})
