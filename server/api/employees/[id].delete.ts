import { checkpointWal } from '../../db/client'
import { employeeDeleteSchema, idParams } from '../../schemas'
import { deleteLeftEmployee } from '../../services/employeeDeletion'

/** Deletes a left employee for good; `confirm` in the body (never the URL, it would land in logs) must be their name. */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readBody<unknown>(event).catch(() => undefined)
  const { confirm } = employeeDeleteSchema.parse(body ?? {})
  deleteLeftEmployee(useDb(), admin, admin.facilityId, id, confirm)
  // The deleted rows must not linger in the write-ahead log.
  checkpointWal(useSqlite())
  return { ok: true }
})
