import { listTemplates } from '../../services/printTemplates'

export default defineServiceHandler(async (event) => {
  // Blank forms, no child data: also the facility's tablet without an unlock, always in the active facility.
  const reader = await requirePermission(event, 'printTemplates.view', { allowTerminal: true, facility: 'active' })
  return listTemplates(useDb(), reader)
})
