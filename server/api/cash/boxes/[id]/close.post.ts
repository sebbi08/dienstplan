import { todayIso } from '../../../../../shared/domain/dates'
import { cashCloseSchema, idParams } from '../../../../schemas'
import { closeMonth } from '../../../../services/cashClosing'

/** Closes a month of a box of the active facility (Leitung and Träger). */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { year, month } = await readValidatedBody(event, cashCloseSchema.parse)
  closeMonth(useDb(), admin, admin.facilityId, id, year, month, todayIso())
  return { ok: true }
})
