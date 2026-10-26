import { idParams, talkFormAddSchema } from '../../../schemas'
import { addTalkForm } from '../../../services/staffTalks'

/** Adds a form from an active staff template to a talk. */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { templateId } = await readValidatedBody(event, talkFormAddSchema.parse)
  return { id: addTalkForm(useDb(), admin, admin.facilityId, id, templateId) }
})
