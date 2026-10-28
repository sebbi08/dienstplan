import { listClosures } from '../../services/closures'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'closures.manage')
  return listClosures(useDb(), admin.facilityId)
})
