import { staffTalkSchema } from '../../schemas'
import { createTalk } from '../../services/staffTalks'

/** A new talk with an employee of the active facility, with one form per chosen staff template. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'talks.manage')
  // Never the manager's own talks: those are held by the Träger or another Leitung.
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const body = await readValidatedBody(event, staffTalkSchema.parse)
  return { id: createTalk(useDb(), admin, scope, body) }
})
