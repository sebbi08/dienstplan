import { idParams } from '../../schemas'
import { deleteCategory } from '../../services/templateCategories'

// The shared categories of „Vorlagen“ for whoever maintains the Bögen (formTemplates.manage); whoever maintains the PDF
// templates uses /api/template-categories. Same rules either way (server/services/templateCategories.ts).
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'formTemplates.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteCategory(useDb(), admin, id)
  return { ok: true }
})
