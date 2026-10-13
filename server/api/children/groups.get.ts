import { listChildGroups } from '../../services/groups'

/**
 * The facility's groups for everyone who may see child records (the admin list is for managers only); the places of a
 * group only go to managers.
 */
export default defineServiceHandler(async (event) => {
  const user = await requireChildReader(event)
  return listChildGroups(useDb(), user.facilityId, user.role)
})
