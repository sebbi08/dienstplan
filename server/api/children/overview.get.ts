import { todayIso } from '../../../shared/domain/dates'
import { childrenOverview } from '../../services/children'

/** The values of the Excel-like overview tables for the active children the viewer sees, in the order of the list. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildReader(event)
  return childrenOverview(useDb(), viewer, todayIso())
})
