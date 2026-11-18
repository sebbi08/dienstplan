import { childSortSchema } from '../../schemas'
import { getChildSort, setChildSort } from '../../services/childSort'

/** The Leitung or Träger sets how the child lists order the children inside a group, for the whole facility. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  setChildSort(useDb(), admin.facilityId, (await readValidatedBody(event, childSortSchema.parse)).sort)
  return { sort: getChildSort(useDb(), admin.facilityId) }
})
