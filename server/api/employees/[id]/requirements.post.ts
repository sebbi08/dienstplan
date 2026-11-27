import { todayIso } from '../../../../shared/domain/dates'
import { idParams, requirementRecordSchema } from '../../../schemas'
import { dropLinkedRepeats } from '../../../services/eventRequirements'
import { addRequirementRecord } from '../../../services/requirements'

/** Enters a Pflichttermin by hand; one of the same day and kind from a confirmed appointment gives way to it. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, requirementRecordSchema.parse)
  return useDb().transaction((tx) => {
    const recordId = addRequirementRecord(tx, admin.facilityId, id, body, todayIso())
    dropLinkedRepeats(tx, recordId)
    return { id: recordId }
  })
})
