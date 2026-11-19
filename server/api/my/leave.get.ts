import { todayIso } from '../../../shared/domain/dates'
import { ServiceError } from '../../lib/errors'
import { yearQuery } from '../../schemas'
import { getLeaveAccount } from '../../services/leave'

export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  if (user.employeeId === null) throw new ServiceError(403, 'no_employee')
  const { year } = await getValidatedQuery(event, yearQuery.parse)
  // The own Sonderurlaub with its reasons (only the employee themselves, from the session).
  return getLeaveAccount(useDb(), user.employeeId, year, todayIso(), true)
})
