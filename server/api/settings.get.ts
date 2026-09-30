import { getSettings } from '../services/settings'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  return getSettings(useDb())
})
