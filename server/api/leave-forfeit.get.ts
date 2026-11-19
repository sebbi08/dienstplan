import { todayIso } from '../../shared/domain/dates'
import type { LeaveForfeitListDto } from '../../shared/types/api'
import { yearQuery } from '../schemas'
import { getLeaveForfeitList } from '../services/leaveForfeit'

/** „Hinweis auf Resturlaub ‹Jahr›“ on „Urlaubsplanung“: who has leave left and who read the notice (leave planners, Leitung, Träger). */
export default defineServiceHandler(async (event): Promise<LeaveForfeitListDto> => {
  const admin = await requirePermission(event, 'leave.overview')
  const { year } = await getValidatedQuery(event, yearQuery.parse)
  return getLeaveForfeitList(useDb(), admin.facilityId, year, todayIso())
})
