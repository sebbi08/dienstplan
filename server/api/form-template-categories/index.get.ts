import { listCategories } from '../../services/templateCategories'

/**
 * The categories of „Vorlagen“ (shared by the Bögen and the PDF templates) for whoever manages the Bögen, to file them:
 * those of the facility the viewer's role sees, with how many Bögen lie in each. Whoever may see the PDF templates
 * reads them at /api/template-categories; this is for an account with Bögen but without that right.
 */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'formTemplates.manage')
  return listCategories(useDb(), admin)
})
