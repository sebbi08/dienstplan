import { staffTalkSchema } from '../../schemas'
import { createTalk } from '../../services/staffTalks'

/** A new talk with an employee of the active facility, with one form per chosen staff template. */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const body = await readValidatedBody(event, staffTalkSchema.parse)
  return { id: createTalk(useDb(), admin, admin.facilityId, body) }
})
