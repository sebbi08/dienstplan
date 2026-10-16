import { todayIso } from '../../../shared/domain/dates'
import { listBirthdays } from '../../services/children'

/** The next birthday of every active child, soonest first. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildReader(event)
  return listBirthdays(useDb(), viewer.facilityId, todayIso(), viewer.groups)
})
