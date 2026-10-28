import { cashReopenSchema, idParams } from '../../../../schemas'
import { reopenMonth } from '../../../../services/cashClosing'

/** Reopens a closed month and all later closed months of a box of the active facility (cash.reopen: Träger and, since the rights page, Leitung). */
export default defineServiceHandler(async (event) => {
  const actor = await requirePermission(event, 'cash.reopen')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { year, month, reason } = await readValidatedBody(event, cashReopenSchema.parse)
  return { months: reopenMonth(useDb(), actor, actor.facilityId, id, year, month, reason) }
})
