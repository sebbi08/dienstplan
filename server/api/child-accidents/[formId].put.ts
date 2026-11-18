import { accidentSaveSchema, formIdParams } from '../../schemas'
import { saveChildAccident } from '../../services/accidents'

/** Saves header and answers; the service checks the edit right (author or Leitung/Träger, in the attendance's scope). */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.attendance')
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  const body = await readValidatedBody(event, accidentSaveSchema.parse)
  return saveChildAccident(useDb(), viewer, formId, body)
})
