import { ifsgKeyParams, ifsgLocalRuleSchema } from '../../../schemas'
import { saveLocalRule } from '../../../services/ifsgLocal'

/** Saves the local rule of a disease (RKI or local), Leitung and Träger. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  const { key } = await getValidatedRouterParams(event, ifsgKeyParams.parse)
  saveLocalRule(useDb(), admin.facilityId, key, await readValidatedBody(event, ifsgLocalRuleSchema.parse))
  return { ok: true }
})
