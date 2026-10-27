import { checkpointWal } from '../../../../db/client'
import { cashBoxPurgeSchema, idParams } from '../../../../schemas'
import { purgeBox } from '../../../../services/cashPurge'

/**
 * Deletes an archived box for good once its retention period has run (spec Löschfristen §4); `confirm` in the body
 * (never the URL, it would land in logs) must be the box name.
 */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readBody<unknown>(event).catch(() => undefined)
  const { confirm } = cashBoxPurgeSchema.parse(body ?? {})
  purgeBox(useDb(), admin, admin.facilityId, id, confirm)
  // The deleted rows and receipts must not linger in the write-ahead log.
  checkpointWal(useSqlite())
  return { ok: true }
})
