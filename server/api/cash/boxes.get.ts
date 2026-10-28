import { todayIso } from '../../../shared/domain/dates'
import { listBoxes } from '../../services/cashBoxes'

/** The cash books of the active facility with today's balance (Leitung and Träger). */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'cash.view')
  return listBoxes(useDb(), admin.facilityId, todayIso())
})
