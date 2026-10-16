import { listChildGroups } from '../../services/groups'

/**
 * The facility's groups for everyone who may see child records (the admin list is for managers only), each with the
 * viewer's right; groups hidden from the viewer are left out, the places of a group only go to managers.
 */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildReader(event)
  return listChildGroups(useDb(), viewer)
})
