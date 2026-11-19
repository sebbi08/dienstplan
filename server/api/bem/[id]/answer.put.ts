import { todayIso } from '../../../../shared/domain/dates'
import { bemAnswerSchema, idParams } from '../../../schemas'
import { answerBem } from '../../../services/bem'

/** The employee's answer (angenommen / abgelehnt / keine Antwort), dated; declined and no answer end the BEM. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.sickness')
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { answer, date } = await readValidatedBody(event, bemAnswerSchema.parse)
  answerBem(useDb(), scope, id, answer, date, todayIso())
  return { ok: true }
})
