import { todayIso } from '../../../shared/domain/dates'
import { listPlanned } from '../../services/children'

/** The waitlist and the contract children who have not started yet, without the part the tablet hides from the viewer. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildReader(event)
  return listPlanned(useDb(), viewer, todayIso())
})
