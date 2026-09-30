import { applyEntriesSchema } from '../../schemas'
import { applyToCells } from '../../services/entries'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const body = await readValidatedBody(event, applyEntriesSchema.parse)
  applyToCells(useDb(), admin, body.cells, body.mode, body.entry)
  return { ok: true }
})
