import { formIdParams } from '../../schemas'
import { getEmployeeAccident } from '../../services/accidents'

/** One accident report about an employee: Leitung/Träger of its facility or the employee (404 for anybody else). */
export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  return getEmployeeAccident(useDb(), accidentActor(event, user), formId)
})
