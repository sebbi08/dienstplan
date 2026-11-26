import { monthParams, revertSchema } from '../../../../schemas'
import { revertCells } from '../../../../services/revert'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'plan.release', { tabletPlanEdit: true })
  const { year, month } = await getValidatedRouterParams(event, monthParams.parse)
  const { keys } = await readValidatedBody(event, revertSchema.parse)
  // notPaired: the home facilities of helpers whose cells stayed (help-out not allowed by the Träger).
  return revertCells(useDb(), admin, admin.facilityId, year, month, keys)
})
