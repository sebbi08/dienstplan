import { occupancyQuery } from '../../schemas'
import { occupancyTable } from '../../services/occupancy'

/** The occupancy of a Kita year (`?year=` = its start year) by group and month. */
export default defineServiceHandler(async (event) => {
  const manager = await requireChildPermission(event, 'children.manage')
  const { year } = await getValidatedQuery(event, occupancyQuery.parse)
  return occupancyTable(useDb(), manager.facilityId, year)
})
