import { checkpointWal } from '../../db/client'
import { idParams } from '../../schemas'
import { deleteEmployeeAccidentAttachment } from '../../services/accidents'

/** Removes an attachment; whoever may change the report (checked by the service). */
export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteEmployeeAccidentAttachment(useDb(), accidentActor(event, user), id)
  checkpointWal(useSqlite())
  return { ok: true }
})
