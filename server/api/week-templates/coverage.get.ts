import { weekTemplateCoverage } from '../../services/weekTemplates'

/** The Pflichtdienste and opening hours the week template editor checks a template against (as the plan's warnings). */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'plan.edit')
  return weekTemplateCoverage(useDb(), admin.facilityId)
})
