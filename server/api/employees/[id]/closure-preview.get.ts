import { todayIso } from '../../../../shared/domain/dates'
import { idParams } from '../../../schemas'
import { previewClosuresForEmployee } from '../../../services/closurePreview'

/** „Schließzeiten als Urlaub“ on the employee page: this year and the next from the stored hours and entitlement. */
export default defineServiceHandler(async (event) => {
  const actor = await requirePermission(event, 'employees.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return previewClosuresForEmployee(useDb(), actor.facilityId, id, todayIso())
})
