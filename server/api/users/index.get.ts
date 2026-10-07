import { listUsers } from '../../services/users'

export default defineServiceHandler(async (event) => {
  const actor = await requireAdmin(event)
  return listUsers(useDb(), actor)
})
