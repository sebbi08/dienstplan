import type { FormTemplateCategoryDto } from '../../../shared/types/api'
import { listFormCategories } from '../../services/formTemplateCategories'

/** The categories and subcategories of the facility's form templates (Dokumente → Bögen), in their order. */
export default defineServiceHandler(async (event): Promise<FormTemplateCategoryDto[]> => {
  const admin = await requirePermission(event, 'formTemplates.manage')
  return listFormCategories(useDb(), admin.facilityId)
})
