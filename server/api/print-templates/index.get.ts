import { listTemplates } from '../../services/printTemplates'

export default defineServiceHandler(async (event) => {
  const reader = await requireTemplateReader(event)
  return listTemplates(useDb(), reader)
})
