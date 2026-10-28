import { applyEntriesSchema } from '../../schemas'
import { applyToCells } from '../../services/entries'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'plan.edit')
  const body = await readValidatedBody(event, applyEntriesSchema.parse)
  applyToCells(useDb(), admin, admin.facilityId, body.cells, body.mode, body.entry)
  return { ok: true }
})
