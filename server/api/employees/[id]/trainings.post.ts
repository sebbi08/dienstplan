import { idParams, trainingSchema } from '../../../schemas'
import { addTraining } from '../../../services/requirements'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return { id: addTraining(useDb(), admin.facilityId, id, await readValidatedBody(event, trainingSchema.parse)) }
})
