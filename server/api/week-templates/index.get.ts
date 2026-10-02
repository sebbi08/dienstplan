import { listWeekTemplates } from '../../services/weekTemplates'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  return listWeekTemplates(useDb())
})
