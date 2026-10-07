import { listFacilities } from '../services/facilities'

export default defineServiceHandler(async (event) => {
  const user = await requireAdmin(event)
  return listFacilities(useDb(), user)
})
