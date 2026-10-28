import { todayIso } from '../../../../shared/domain/dates'
import { cashFactsSchema, idParams } from '../../../schemas'
import { updateEntry } from '../../../services/cashEntries'

/** Date, amount and purpose of a plain entry (a transfer changes through /api/cash/transfers). */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'cash.book')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, cashFactsSchema.parse)
  updateEntry(useDb(), admin, admin.facilityId, id, body, todayIso())
  return { ok: true }
})
