import { todayIso } from '../../../shared/domain/dates'
import { cashTransferSchema } from '../../schemas'
import { createTransfer } from '../../services/cashEntries'

/** Returns the transfer's id (that of its expense row), which names it in /api/cash/transfers/[id]. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'cash.book')
  const body = await readValidatedBody(event, cashTransferSchema.parse)
  return { id: createTransfer(useDb(), admin, admin.facilityId, body, todayIso()) }
})
