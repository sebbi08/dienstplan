import { listUsers } from '../../services/users'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  return listUsers(useDb())
})
