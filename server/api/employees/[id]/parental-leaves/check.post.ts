import { idParams, parentalLeaveCheckSchema } from '../../../../schemas'
import { checkParentalLeavePeriod } from '../../../../services/parentalLeave'

/** The dialog's check of a period before saving (stores nothing): suggested start, refusal, hints, first working day, entries. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.contractEdit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { exceptId, ...input } = await readValidatedBody(event, parentalLeaveCheckSchema.parse)
  return checkParentalLeavePeriod(useDb(), admin, admin.facilityId, id, input, exceptId)
})
