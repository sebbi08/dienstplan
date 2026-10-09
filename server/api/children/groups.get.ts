import { listGroups } from '../../services/groups'

/** The facility's groups for everyone who may see child records (the admin list is for managers only). */
export default defineServiceHandler(async (event) => {
  const user = await requireChildReader(event)
  return listGroups(useDb(), user.facilityId)
})
