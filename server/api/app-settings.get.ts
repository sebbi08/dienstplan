import { getAppSettings } from '../services/appSettings'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  return getAppSettings(useDb())
})
