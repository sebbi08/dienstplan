import { todayIso } from '../../../shared/domain/dates'
import { listBirthdays } from '../../services/children'

/** The next birthday of every active child, soonest first. */
export default defineServiceHandler(async (event) => {
  const user = await requireChildReader(event)
  return listBirthdays(useDb(), user.facilityId, todayIso())
})
