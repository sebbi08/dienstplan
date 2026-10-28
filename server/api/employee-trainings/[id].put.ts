import { idParams, trainingSchema } from '../../schemas'
import { updateTraining } from '../../services/requirements'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  updateTraining(useDb(), admin.facilityId, id, await readValidatedBody(event, trainingSchema.parse))
  return { ok: true }
})
