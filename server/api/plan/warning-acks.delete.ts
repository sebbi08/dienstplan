import { warningAckKeysSchema } from '../../schemas'
import { revokeWarningAcks } from '../../services/warningAcks'

/** „Rückgängig“: the Leitung or the Träger takes back acknowledgements of the active facility (none of them: 404). */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { keys } = await readValidatedBody(event, warningAckKeysSchema.parse)
  revokeWarningAcks(useDb(), admin.facilityId, keys)
  return { ok: true }
})
