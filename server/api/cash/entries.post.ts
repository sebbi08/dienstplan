import { todayIso } from '../../../shared/domain/dates'
import { cashEntrySchema } from '../../schemas'
import { createEntry } from '../../services/cashEntries'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'cash.book')
  const body = await readValidatedBody(event, cashEntrySchema.parse)
  return { id: createEntry(useDb(), admin, admin.facilityId, body, todayIso()) }
})
