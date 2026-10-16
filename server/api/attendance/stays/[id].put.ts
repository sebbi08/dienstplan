import { attendanceStaySchema, idParams } from '../../../schemas'
import { updateStay } from '../../../services/childAttendance'

/** Corrects a stay's times and, if given, its pickup person. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildReader(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, attendanceStaySchema.parse)
  updateStay(useDb(), viewer, id, body)
  return { ok: true }
})
