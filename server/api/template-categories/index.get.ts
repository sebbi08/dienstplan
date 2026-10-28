import { listCategories } from '../../services/templateCategories'

export default defineServiceHandler(async (event) => {
  // Like the templates themselves: also the tablet without an unlock and Mitarbeiter accounts, each the categories of
  // their level (the same for every facility).
  const reader = await requirePermission(event, 'printTemplates.view', { allowTerminal: true, facility: 'active' })
  return listCategories(useDb(), reader)
})
