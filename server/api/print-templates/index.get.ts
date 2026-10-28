import { listTemplates } from '../../services/printTemplates'

export default defineServiceHandler(async (event) => {
  // Blank forms, no child data: also the facility's tablet without an unlock and Mitarbeiter accounts (read only), always
  // in the active facility; each sees the categories of their level.
  const reader = await requirePermission(event, 'printTemplates.view', { allowTerminal: true, facility: 'active' })
  return listTemplates(useDb(), reader)
})
