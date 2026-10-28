import { listUsers } from '../../services/users'

export default defineServiceHandler(async (event) => {
  const actor = await requirePermission(event, 'users.manage')
  return listUsers(useDb(), actor)
})
