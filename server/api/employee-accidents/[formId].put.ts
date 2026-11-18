import { accidentSaveSchema, formIdParams } from '../../schemas'
import { saveEmployeeAccident } from '../../services/accidents'

/** Saves header and answers: Leitung/Träger, or the employee a report they filled in about themselves. */
export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  const body = await readValidatedBody(event, accidentSaveSchema.parse)
  return saveEmployeeAccident(useDb(), accidentActor(event, user), formId, body)
})
