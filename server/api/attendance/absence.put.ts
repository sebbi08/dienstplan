import { attendanceAbsenceSchema } from '../../schemas'
import { setAbsence } from '../../services/childAttendance'

/** Enters (or with kind null clears) an absence for a day or a range; answers how many days changed. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildReader(event)
  const body = await readValidatedBody(event, attendanceAbsenceSchema.parse)
  return { changed: setAbsence(useDb(), viewer, body) }
})
