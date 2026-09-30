import { todayIso } from '../../../shared/domain/dates'
import { ServiceError } from '../../lib/errors'
import { yearQuery } from '../../schemas'
import { getLeaveAccount } from '../../services/leave'

export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  if (user.employeeId === null) throw new ServiceError(403, 'no_employee')
  const { year } = await getValidatedQuery(event, yearQuery.parse)
  return getLeaveAccount(useDb(), user.employeeId, year, todayIso())
})
