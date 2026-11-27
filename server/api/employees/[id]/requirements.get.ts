import { todayIso } from '../../../../shared/domain/dates'
import { idParams } from '../../../schemas'
import { withPlannedRequirements } from '../../../services/eventRequirements'
import { getEmployeeRequirements } from '../../../services/requirements'

/** The person's Pflichttermine, with „geplant am …“ where a Pflichttermin appointment ahead is meant for them. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.view')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const db = useDb()
  const today = todayIso()
  return withPlannedRequirements(db, admin.facilityId, id, getEmployeeRequirements(db, admin.facilityId, id, today), today)
})
