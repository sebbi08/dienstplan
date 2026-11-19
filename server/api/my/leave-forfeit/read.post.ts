import { todayIso } from '../../../../shared/domain/dates'
import { leaveForfeitReadSchema } from '../../../schemas'
import { markLeaveForfeitRead } from '../../../services/leaveForfeit'

/** „Gelesen“ on the own notice on remaining leave: only the employee themselves (the session's employee link). */
export default defineServiceHandler(async (event): Promise<{ readAt: string }> => {
  const user = await requireUser(event)
  const { year } = await readValidatedBody(event, leaveForfeitReadSchema.parse)
  return markLeaveForfeitRead(useDb(), user, year, todayIso())
})
