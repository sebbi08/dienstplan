import { checkpointWal } from '../../db/client'
import { idParams } from '../../schemas'
import { deleteChildAccidentAttachment } from '../../services/accidents'

/** Removes an attachment; whoever may change the report (checked by the service). */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.attendance')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteChildAccidentAttachment(useDb(), viewer, id)
  checkpointWal(useSqlite())
  return { ok: true }
})
