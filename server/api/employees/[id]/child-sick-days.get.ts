import { idParams, yearQuery } from '../../../schemas'
import { getChildSickYear } from '../../../services/employeeChildren'

/** Kinderkrankentage of the facility's employee in a year (taken, entitlement), like the sick days: employees.sickness. */
export default defineServiceHandler(async (event) => {
  const viewer = await requirePermission(event, 'employees.sickness')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { year } = await getValidatedQuery(event, yearQuery.parse)
  return getChildSickYear(useDb(), viewer.facilityId, id, year)
})
