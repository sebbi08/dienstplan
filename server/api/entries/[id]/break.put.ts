import { entryBreakSchema, idParams } from '../../../schemas'
import { updateEntryBreak } from '../../../services/entries'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { breakStart, breakEnd } = await readValidatedBody(event, entryBreakSchema.parse)
  updateEntryBreak(useDb(), admin, id, breakStart, breakEnd)
  return { ok: true }
})
