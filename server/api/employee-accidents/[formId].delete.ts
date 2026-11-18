import { checkpointWal } from '../../db/client'
import { formIdParams } from '../../schemas'
import { deleteEmployeeAccident } from '../../services/accidents'

/** Deletes an accident report with its attachments (Leitung/Träger only; the employee never). */
export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  deleteEmployeeAccident(useDb(), accidentActor(event, user), formId)
  checkpointWal(useSqlite())
  return { ok: true }
})
