import { listChildGroups } from '../../services/groups'

/**
 * The facility's groups for everyone who may see child records (the admin list is for managers only); the places of a
 * group only go to managers.
 */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildReader(event)
  return listChildGroups(useDb(), viewer.facilityId, viewer.role)
})
