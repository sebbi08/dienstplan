import { todayIso } from '../../../shared/domain/dates'
import { getMyRequirements } from '../../services/requirements'

/** The viewer's own mandatory appointments and trainings, read-only (403 no_employee without a linked employee). */
export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  return getMyRequirements(useDb(), user, todayIso())
})
