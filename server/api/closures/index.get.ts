import { listClosures } from '../../services/closures'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  return listClosures(useDb())
})
