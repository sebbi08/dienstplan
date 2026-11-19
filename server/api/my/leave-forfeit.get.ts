import { todayIso } from '../../../shared/domain/dates'
import type { MyLeaveForfeitDto } from '../../../shared/types/api'
import { getMyLeaveForfeitNotice } from '../../services/leaveForfeit'

/** The own notice on remaining leave (null without an employee, outside the window, without days or once read). */
export default defineServiceHandler(async (event): Promise<MyLeaveForfeitDto> => {
  const user = await requireUser(event)
  return { notice: getMyLeaveForfeitNotice(useDb(), user, todayIso()) }
})
