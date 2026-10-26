import { cashReopenSchema, idParams } from '../../../../schemas'
import { reopenMonth } from '../../../../services/cashClosing'

/** Reopens a closed month and all later closed months of a box of the active facility (only the Träger, spec Kasse §6). */
export default defineServiceHandler(async (event) => {
  const provider = await requireProvider(event)
  const facilityId = requireFacility(event, provider)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { year, month, reason } = await readValidatedBody(event, cashReopenSchema.parse)
  return { months: reopenMonth(useDb(), provider, facilityId, id, year, month, reason) }
})
