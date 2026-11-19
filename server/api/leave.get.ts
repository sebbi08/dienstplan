import { todayIso } from '../../shared/domain/dates'
import { can } from '../../shared/domain/permissions'
import { yearQuery } from '../schemas'
import { getLeaveOverview } from '../services/leave'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'leave.overview')
  const { year } = await getValidatedQuery(event, yearQuery.parse)
  // The Sonderurlaub reasons only for Leitung and Träger (the right of the sick days), never for other viewers.
  return getLeaveOverview(useDb(), admin.facilityId, year, todayIso(), can(admin.permissions, 'employees.sickness'))
})
