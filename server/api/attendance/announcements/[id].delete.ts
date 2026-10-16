import { idParams } from '../../../schemas'
import { removeAnnouncement } from '../../../services/childAttendance'

/** Removes an announced pickup person. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildReader(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  removeAnnouncement(useDb(), viewer, id)
  return { ok: true }
})
