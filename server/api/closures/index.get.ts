import { listClosures } from '../../services/closures'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  return listClosures(useDb(), admin.facilityId)
})
