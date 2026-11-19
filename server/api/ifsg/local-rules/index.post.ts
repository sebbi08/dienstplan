import { ifsgLocalRuleSchema } from '../../../schemas'
import { addLocalDisease } from '../../../services/ifsgLocal'

/** A local disease of the health office (e.g. COVID-19, Hand-Fuß-Mund); answers its key. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  return { key: addLocalDisease(useDb(), admin.facilityId, await readValidatedBody(event, ifsgLocalRuleSchema.parse)) }
})
