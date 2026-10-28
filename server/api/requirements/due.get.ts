import { todayIso } from '../../../shared/domain/dates'
import { listDueRequirements } from '../../services/requirements'

/** The notice for Leitung and Träger: what is overdue, missing or due soon in the facility they work in. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.view')
  return listDueRequirements(useDb(), admin.facilityId, todayIso())
})
