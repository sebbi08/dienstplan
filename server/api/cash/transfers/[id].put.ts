import { todayIso } from '../../../../shared/domain/dates'
import { cashFactsSchema, idParams } from '../../../schemas'
import { updateTransfer } from '../../../services/cashEntries'

/** Date, amount and text of both rows of a transfer; `id` is its expense row's id. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'cash.book')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, cashFactsSchema.parse)
  updateTransfer(useDb(), admin, admin.facilityId, id, body, todayIso())
  return { ok: true }
})
