import { todayIso } from '../../../../shared/domain/dates'
import { idParams, requirementRecordSchema } from '../../../schemas'
import { addRequirementRecord } from '../../../services/requirements'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, requirementRecordSchema.parse)
  return { id: addRequirementRecord(useDb(), admin.facilityId, id, body, todayIso()) }
})
