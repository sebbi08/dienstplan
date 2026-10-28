import { warningAcksSchema } from '../../schemas'
import { acknowledgeWarnings } from '../../services/warningAcks'

/** „Zur Kenntnis genommen“: the Leitung or the Träger marks plan warnings of the active facility. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'plan.edit')
  const { items } = await readValidatedBody(event, warningAcksSchema.parse)
  acknowledgeWarnings(useDb(), admin.facilityId, admin, items)
  return { ok: true }
})
