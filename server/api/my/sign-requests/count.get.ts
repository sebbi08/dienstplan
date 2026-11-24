import { mySignRequestCount } from '../../../services/signRequests'

/** How many requests the own employee still has to sign (0 without a linked employee), for the count in the menu. */
export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  return { count: user.employeeId === null ? 0 : mySignRequestCount(useDb(), user.employeeId) }
})
