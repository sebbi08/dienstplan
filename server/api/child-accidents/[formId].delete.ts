import { checkpointWal } from '../../db/client'
import { formIdParams } from '../../schemas'
import { deleteChildAccident } from '../../services/accidents'

/** Deletes an accident report with its attachments (Leitung and Träger only). */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'accidents.manage')
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  deleteChildAccident(useDb(), viewer, formId)
  checkpointWal(useSqlite())
  return { ok: true }
})
