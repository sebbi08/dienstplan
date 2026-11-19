import { bemStepCreateSchema, idParams } from '../../../schemas'
import { addBemStep } from '../../../services/bem'

/** Adds a talk, measure or note to a running BEM; answers its id. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.sickness')
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { kind, ...input } = await readValidatedBody(event, bemStepCreateSchema.parse)
  return { id: addBemStep(useDb(), scope, id, kind, input) }
})
