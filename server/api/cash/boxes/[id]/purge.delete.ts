import { checkpointWal } from '../../../../db/client'
import { cashBoxPurgeSchema, idParams } from '../../../../schemas'
import { purgeBox } from '../../../../services/cashPurge'

/**
 * Deletes an archived box of the active facility for good once its retention period has run (spec Löschfristen §4),
 * only the Träger (deleting after a period is the Träger's, spec Löschübersicht §3); `confirm` in the body (never the
 * URL, it would land in logs) must be the box name.
 */
export default defineServiceHandler(async (event) => {
  const provider = await requirePermission(event, 'cash.purge')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readBody<unknown>(event).catch(() => undefined)
  const { confirm } = cashBoxPurgeSchema.parse(body ?? {})
  purgeBox(useDb(), provider, provider.facilityId, id, confirm)
  // The deleted rows and receipts must not linger in the write-ahead log.
  checkpointWal(useSqlite())
  return { ok: true }
})
