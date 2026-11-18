import { accidentCreateSchema } from '../../schemas'
import { createMyAccident } from '../../services/accidents'

/** The employee fills in an accident report about themselves (author = self); whose follows from the session alone. */
export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readValidatedBody(event, accidentCreateSchema.parse)
  return { id: createMyAccident(useDb(), accidentActor(event, user), body) }
})
