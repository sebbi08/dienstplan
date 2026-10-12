import { idParams, requirementRecordSchema } from '../../../schemas'
import { addRequirementRecord } from '../../../services/requirements'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return { id: addRequirementRecord(useDb(), admin.facilityId, id, await readValidatedBody(event, requirementRecordSchema.parse)) }
})
