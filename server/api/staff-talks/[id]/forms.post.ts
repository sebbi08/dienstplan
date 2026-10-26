import { idParams, talkFormAddSchema } from '../../../schemas'
import { addTalkForm } from '../../../services/staffTalks'

/** Adds a form from an active staff template to a talk. */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  // Never the manager's own talks: those are held by the Träger or another Leitung.
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { templateId } = await readValidatedBody(event, talkFormAddSchema.parse)
  return { id: addTalkForm(useDb(), admin, scope, id, templateId) }
})
