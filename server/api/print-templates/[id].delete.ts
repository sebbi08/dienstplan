import { checkpointWal } from '../../db/client'
import { idParams } from '../../schemas'
import { deleteTemplate } from '../../services/printTemplates'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'printTemplates.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteTemplate(useDb(), admin, id)
  // Like a deleted document: the file must not linger in the write-ahead log.
  checkpointWal(useSqlite())
  return { ok: true }
})
