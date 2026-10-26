import { todayIso } from '../../../shared/domain/dates'
import { listBoxes } from '../../services/cashBoxes'

/** The cash books of the active facility with today's balance (Leitung and Träger). */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  return listBoxes(useDb(), admin.facilityId, todayIso())
})
