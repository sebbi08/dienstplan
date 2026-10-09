import { listCareTypes } from '../../services/careTypes'

/** The care types of the facility; everyone who may see child records needs them to show and pick. */
export default defineServiceHandler(async (event) => {
  const user = await requireChildReader(event)
  return listCareTypes(useDb(), user.facilityId)
})
